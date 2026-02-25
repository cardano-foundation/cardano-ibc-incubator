use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus,
    ChainNetwork, ChainStartRequest,
};

mod lifecycle;

pub struct InjectiveChainAdapter;

pub static INJECTIVE_CHAIN_ADAPTER: InjectiveChainAdapter = InjectiveChainAdapter;

pub(super) struct InjectiveInstallRuntime {
    source_repo_url: &'static str,
    source_dir_relative: &'static str,
}

pub(super) struct InjectiveLocalRuntime {
    status_url: &'static str,
    rpc_port: u16,
    grpc_port: u16,
    api_port: u16,
}

pub(super) struct InjectiveTestnetRuntime {
    status_url: &'static str,
    rpc_port: u16,
    grpc_port: u16,
    api_port: u16,
    trust_rpc_url: &'static str,
    genesis_url: &'static str,
    trust_offset: u64,
    seeds: &'static str,
    persistent_peers: &'static str,
}

const INJECTIVE_INSTALL_RUNTIME: InjectiveInstallRuntime = InjectiveInstallRuntime {
    source_repo_url: "https://github.com/InjectiveFoundation/injective-core.git",
    source_dir_relative: ".caribic/injective/injective-core",
};

const INJECTIVE_LOCAL_RUNTIME: InjectiveLocalRuntime = InjectiveLocalRuntime {
    status_url: "http://127.0.0.1:26660/status",
    rpc_port: 26660,
    grpc_port: 9097,
    api_port: 1320,
};

const INJECTIVE_TESTNET_RUNTIME: InjectiveTestnetRuntime = InjectiveTestnetRuntime {
    status_url: "http://127.0.0.1:26659/status",
    rpc_port: 26659,
    grpc_port: 9096,
    api_port: 1319,
    trust_rpc_url: "https://testnet.sentry.tm.injective.network",
    genesis_url: "https://raw.githubusercontent.com/InjectiveLabs/testnet/main/testnet-1/genesis.json",
    trust_offset: 1500,
    seeds: "20a548c1ede8f31d13309171f76e0f4624e126b8@seed.testnet.injective.network:26656",
    persistent_peers: "3f472746f46493309650e5a033076689996c8881@testnet-seed.injective.network:26656,dacd5d0afce07bd5e43f33b1f5be4ad2f7f9f273@134.209.251.247:26656,8e7a64daa7793f36f68f4cb1ee2f9744a10f94ac@143.198.139.33:26656,e265d636f4f7731207a70f9fcf7b51532aae5820@68.183.176.90:26656,fc86277053c2e045790d44591e8f375f16d991f2@143.198.29.21:26656",
};

const INJECTIVE_NETWORKS: [ChainNetwork; 3] = [
    ChainNetwork {
        name: "local",
        description: "Local single-node Injective devnet",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "testnet",
        description: "Local injectived node synced to Injective testnet via state sync",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "mainnet",
        description: "Reserved for local Injective mainnet support (not implemented)",
        managed_by_caribic: true,
    },
];

const INJECTIVE_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description: "Keep local Injective devnet state in ~/.injectived-local between runs",
    required: false,
}];

const INJECTIVE_TESTNET_FLAGS: [ChainFlagSpec; 2] = [
    ChainFlagSpec {
        name: "stateful",
        description: "Keep local Injective testnet state in ~/.injectived-testnet between runs",
        required: false,
    },
    ChainFlagSpec {
        name: "trust-rpc-url",
        description: "Trusted Injective testnet RPC base URL used for state sync bootstrap",
        required: false,
    },
];

const INJECTIVE_MAINNET_FLAGS: [ChainFlagSpec; 0] = [];

#[async_trait]
impl ChainAdapter for InjectiveChainAdapter {
    fn id(&self) -> &'static str {
        "injective"
    }

    fn display_name(&self) -> &'static str {
        "Injective"
    }

    fn default_network(&self) -> &'static str {
        "local"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &INJECTIVE_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
            "local" => &INJECTIVE_LOCAL_FLAGS,
            "testnet" => &INJECTIVE_TESTNET_FLAGS,
            "mainnet" => &INJECTIVE_MAINNET_FLAGS,
            _ => &[],
        }
    }

    async fn start(
        &self,
        _project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;

        match request.network {
            "local" => {
                let stateful = parse_bool_flag(request.flags, "stateful", false)?;
                lifecycle::prepare_local(stateful, &INJECTIVE_INSTALL_RUNTIME)
                    .await
                    .map_err(|error| format!("Failed to prepare Injective local node: {}", error))?;
                lifecycle::start_local(&INJECTIVE_LOCAL_RUNTIME)
                    .await
                    .map_err(|error| format!("Failed to start Injective local node: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let stateful = parse_bool_flag(request.flags, "stateful", true)?;
                let trust_rpc_url = request.flags.get("trust-rpc-url").cloned();

                lifecycle::prepare_testnet(
                    stateful,
                    &INJECTIVE_INSTALL_RUNTIME,
                    INJECTIVE_TESTNET_RUNTIME.genesis_url,
                )
                    .await
                    .map_err(|error| {
                        format!("Failed to prepare Injective testnet node: {}", error)
                    })?;
                lifecycle::start_testnet(trust_rpc_url.as_deref(), &INJECTIVE_TESTNET_RUNTIME)
                    .await
                    .map_err(|error| {
                        format!("Failed to start Injective testnet node: {}", error)
                    })?;
                Ok(())
            }
            "mainnet" => Err(
                "Injective network 'mainnet' is not implemented yet. Supported networks: local, testnet."
                    .to_string(),
            ),
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                request.network,
                self.id()
            )),
        }
    }

    fn stop(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;

        match network {
            "local" => lifecycle::stop_local()
                .map_err(|error| format!("Failed to stop local Injective node: {}", error)),
            "testnet" => lifecycle::stop_testnet()
                .map_err(|error| format!("Failed to stop local Injective testnet node: {}", error)),
            "mainnet" => Ok(()),
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
        }
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;

        match network {
            "local" => Ok(vec![combined_health_status(
                INJECTIVE_LOCAL_RUNTIME.rpc_port,
                INJECTIVE_LOCAL_RUNTIME.grpc_port,
            )]),
            "testnet" => Ok(vec![combined_health_status(
                INJECTIVE_TESTNET_RUNTIME.rpc_port,
                INJECTIVE_TESTNET_RUNTIME.grpc_port,
            )]),
            "mainnet" => Ok(vec![ChainHealthStatus {
                id: "injective",
                label: "Injective mainnet",
                healthy: false,
                status: "Not implemented yet. Start with --network local or --network testnet."
                    .to_string(),
            }]),
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
        }
    }
}

fn combined_health_status(rpc_port: u16, grpc_port: u16) -> ChainHealthStatus {
    let rpc_ready = check_port_health("injective", rpc_port, "Injective node").healthy;
    let grpc_ready = check_port_health("injective", grpc_port, "Injective node").healthy;

    ChainHealthStatus {
        id: "injective",
        label: "Injective node",
        healthy: rpc_ready && grpc_ready,
        status: format!(
            "RPC ({}): {}; gRPC ({}): {}",
            rpc_port,
            if rpc_ready {
                "reachable"
            } else {
                "not reachable"
            },
            grpc_port,
            if grpc_ready {
                "reachable"
            } else {
                "not reachable"
            }
        ),
    }
}
