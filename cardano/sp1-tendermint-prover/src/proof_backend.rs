use anyhow::{ensure, Context};
use sp1_sdk::{
    network::{get_default_rpc_url_for_mode, signer::NetworkSigner, NetworkMode, B256},
    CpuProver, NetworkProver, ProveRequest, Prover, SP1ProofMode, SP1ProofWithPublicValues,
    SP1ProvingKey, SP1Stdin,
};
use std::{
    collections::HashMap, env, fs, path::PathBuf, str::FromStr, sync::Mutex, time::Duration,
};

// SP1 6.1 logs this value after multiplying it by 1e9 in a u64. Keep the
// configured ceiling inside that implementation's safe range.
pub const MAX_NETWORK_PRICE_PER_PGU: u64 = u64::MAX / 1_000_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BackendKind {
    #[default]
    Cpu,
    Network,
}

impl FromStr for BackendKind {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "cpu" => Ok(Self::Cpu),
            "network" => Ok(Self::Network),
            _ => {
                anyhow::bail!("SP1_TENDERMINT_PROVER_BACKEND must be cpu or network, got {value:?}")
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct NetworkSettings {
    pub mode: NetworkMode,
    pub rpc_url: Option<String>,
    pub proof_timeout: Duration,
    pub auction_timeout: Duration,
    pub min_auction_period_seconds: u64,
    pub max_price_per_pgu: Option<u64>,
}

impl NetworkSettings {
    pub(crate) fn validate(&self, kind: BackendKind) -> anyhow::Result<()> {
        if kind != BackendKind::Network {
            return Ok(());
        }
        if self.mode == NetworkMode::Mainnet {
            ensure!(
                self.min_auction_period_seconds < self.auction_timeout.as_secs(),
                "SP1_TENDERMINT_NETWORK_MIN_AUCTION_PERIOD_SECS must be shorter than SP1_TENDERMINT_NETWORK_AUCTION_TIMEOUT_SECS"
            );
            ensure!(
                self.auction_timeout <= self.proof_timeout,
                "SP1_TENDERMINT_NETWORK_AUCTION_TIMEOUT_SECS must not exceed SP1_TENDERMINT_NETWORK_PROOF_TIMEOUT_SECS"
            );
            let max_price = self
                .max_price_per_pgu
                .context("SP1_TENDERMINT_NETWORK_MAX_PRICE_PER_PGU is required in mainnet mode")?;
            ensure!(
                max_price <= MAX_NETWORK_PRICE_PER_PGU,
                "SP1_TENDERMINT_NETWORK_MAX_PRICE_PER_PGU must not exceed {MAX_NETWORK_PRICE_PER_PGU} with SP1 6.1"
            );
        }
        Ok(())
    }
}

pub(crate) struct NetworkBackend {
    prover: NetworkProver,
    settings: NetworkSettings,
    jobs: Mutex<NetworkJobs>,
}

#[derive(Default)]
struct NetworkJobs {
    request_ids: HashMap<String, B256>,
}

pub(crate) enum ProofBackend {
    Cpu,
    Network(Box<NetworkBackend>),
}

impl ProofBackend {
    pub(crate) async fn initialize(
        kind: BackendKind,
        settings: NetworkSettings,
    ) -> anyhow::Result<Self> {
        settings.validate(kind)?;
        match kind {
            BackendKind::Cpu => Ok(Self::Cpu),
            BackendKind::Network => {
                let private_key = load_private_key()?;
                let signer = NetworkSigner::local(&private_key)
                    .context("parse NETWORK_PRIVATE_KEY for the network prover backend")?;
                let rpc_url = settings
                    .rpc_url
                    .clone()
                    .unwrap_or_else(|| get_default_rpc_url_for_mode(settings.mode));
                let prover = NetworkProver::new(signer, &rpc_url, settings.mode).await;
                let balance = prover
                    .get_balance()
                    .await
                    .context("check Succinct network RPC and signer balance")?;
                if settings.mode == NetworkMode::Mainnet {
                    ensure!(
                        !balance.is_zero(),
                        "Succinct network signer has zero proving-credit balance"
                    );
                }
                tracing::info!(
                    mode = network_mode_name(settings.mode),
                    custom_rpc = settings.rpc_url.is_some(),
                    proof_timeout_seconds = settings.proof_timeout.as_secs(),
                    "initialized Succinct network proof backend"
                );
                Ok(Self::Network(Box::new(NetworkBackend {
                    prover,
                    settings,
                    jobs: Mutex::new(NetworkJobs::default()),
                })))
            }
        }
    }

    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Cpu => "cpu",
            Self::Network(backend) if backend.settings.mode == NetworkMode::Mainnet => {
                "network-mainnet"
            }
            Self::Network(_) => "network-reserved",
        }
    }

    pub(crate) async fn prove(
        &self,
        logical_request_id: &str,
        cpu: &CpuProver,
        proving_key: &SP1ProvingKey,
        stdin: SP1Stdin,
        instruction_limit: u64,
        gas_limit: u64,
    ) -> anyhow::Result<SP1ProofWithPublicValues> {
        ensure!(
            instruction_limit > 0,
            "SP1 execution reported zero instructions"
        );
        ensure!(gas_limit > 0, "SP1 execution reported zero prover gas");
        match self {
            Self::Cpu => cpu
                .prove(proving_key, stdin)
                .mode(SP1ProofMode::Groth16)
                .await
                .context("generate SP1 Groth16 proof on the local CPU"),
            Self::Network(backend) => {
                let existing_request_id = {
                    let jobs = backend
                        .jobs
                        .lock()
                        .map_err(|_| anyhow::anyhow!("SP1 network job cache lock is poisoned"))?;
                    jobs.request_ids.get(logical_request_id).copied()
                };

                let network_request_id = if let Some(request_id) = existing_request_id {
                    tracing::info!(
                        request_id = logical_request_id,
                        network_request_id = %format!("{request_id:#x}"),
                        "resuming SP1 network proof request"
                    );
                    request_id
                } else {
                    let mut request = backend
                        .prover
                        .prove(proving_key, stdin)
                        .mode(SP1ProofMode::Groth16)
                        .timeout(backend.settings.proof_timeout)
                        .cycle_limit(instruction_limit)
                        .gas_limit(gas_limit)
                        .skip_simulation(true);
                    if backend.settings.mode == NetworkMode::Mainnet {
                        request = request
                            .min_auction_period(backend.settings.min_auction_period_seconds)
                            .max_price_per_pgu(
                                backend
                                    .settings
                                    .max_price_per_pgu
                                    .expect("validated mainnet price ceiling"),
                            );
                    }

                    // Submit one application-level request. SP1's RPC client can still retry an
                    // ambiguous transport failure internally before returning the network ID.
                    let request_id = request
                        .request()
                        .await
                        .context("submit SP1 proof request to the Succinct network")?;
                    backend
                        .jobs
                        .lock()
                        .map_err(|_| anyhow::anyhow!("SP1 network job cache lock is poisoned"))?
                        .request_ids
                        .insert(logical_request_id.to_owned(), request_id);
                    tracing::info!(
                        request_id = logical_request_id,
                        network_request_id = %format!("{request_id:#x}"),
                        instruction_limit,
                        gas_limit,
                        "submitted SP1 network proof request"
                    );
                    request_id
                };

                backend
                    .prover
                    .wait_proof(
                        network_request_id,
                        Some(backend.settings.proof_timeout),
                        (backend.settings.mode == NetworkMode::Mainnet)
                            .then_some(backend.settings.auction_timeout),
                    )
                    .await
                    .with_context(|| format!("wait for SP1 network proof {network_request_id:#x}"))
            }
        }
    }
}

fn load_private_key() -> anyhow::Result<String> {
    let inline = env::var("NETWORK_PRIVATE_KEY")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let file = env::var("NETWORK_PRIVATE_KEY_FILE")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    ensure!(
        inline.is_none() || file.is_none(),
        "set only one of NETWORK_PRIVATE_KEY or NETWORK_PRIVATE_KEY_FILE"
    );
    if let Some(private_key) = inline {
        return Ok(private_key);
    }
    if let Some(path) = file {
        let metadata = fs::metadata(&path).with_context(|| {
            format!("read NETWORK_PRIVATE_KEY_FILE metadata {}", path.display())
        })?;
        ensure!(
            metadata.is_file() && metadata.len() <= 1_024,
            "NETWORK_PRIVATE_KEY_FILE must be a regular file no larger than 1024 bytes"
        );
        let private_key = fs::read_to_string(&path)
            .with_context(|| format!("read NETWORK_PRIVATE_KEY_FILE {}", path.display()))?
            .trim()
            .to_owned();
        ensure!(!private_key.is_empty(), "NETWORK_PRIVATE_KEY_FILE is empty");
        return Ok(private_key);
    }
    anyhow::bail!(
        "NETWORK_PRIVATE_KEY or NETWORK_PRIVATE_KEY_FILE is required for the network prover backend"
    )
}

fn network_mode_name(mode: NetworkMode) -> &'static str {
    match mode {
        NetworkMode::Mainnet => "mainnet",
        NetworkMode::Reserved => "reserved",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_parser_is_explicit() {
        assert_eq!(BackendKind::from_str("cpu").unwrap(), BackendKind::Cpu);
        assert_eq!(
            BackendKind::from_str("NETWORK").unwrap(),
            BackendKind::Network
        );
        assert!(BackendKind::from_str("cuda").is_err());
    }

    fn settings(mode: NetworkMode) -> NetworkSettings {
        NetworkSettings {
            mode,
            rpc_url: None,
            proof_timeout: Duration::from_secs(600),
            auction_timeout: Duration::from_secs(30),
            min_auction_period_seconds: 1,
            max_price_per_pgu: Some(1),
        }
    }

    #[test]
    fn validates_mainnet_timeout_relationships_and_price_range() {
        settings(NetworkMode::Mainnet)
            .validate(BackendKind::Network)
            .unwrap();

        let mut invalid = settings(NetworkMode::Mainnet);
        invalid.min_auction_period_seconds = 30;
        assert!(invalid.validate(BackendKind::Network).is_err());

        let mut invalid = settings(NetworkMode::Mainnet);
        invalid.proof_timeout = Duration::from_secs(10);
        assert!(invalid.validate(BackendKind::Network).is_err());

        let mut invalid = settings(NetworkMode::Mainnet);
        invalid.max_price_per_pgu = Some(MAX_NETWORK_PRICE_PER_PGU + 1);
        assert!(invalid.validate(BackendKind::Network).is_err());
    }

    #[test]
    fn cpu_and_reserved_do_not_require_mainnet_auction_settings() {
        let mut cpu = settings(NetworkMode::Mainnet);
        cpu.max_price_per_pgu = None;
        cpu.validate(BackendKind::Cpu).unwrap();

        let mut reserved = settings(NetworkMode::Reserved);
        reserved.max_price_per_pgu = None;
        reserved.validate(BackendKind::Network).unwrap();
    }
}
