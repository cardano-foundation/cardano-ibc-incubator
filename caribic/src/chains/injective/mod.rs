use std::path::{Path, PathBuf};

use async_trait::async_trait;
use dirs::home_dir;

use crate::chains::{
    check_port_health, check_rpc_health,
    cosmos_node::{
        managed_node_health, CosmosChainOptions, CosmosNetworkKind, CosmosNodeSpec,
        CosmosStateSyncSpec,
    },
    ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;
mod hermes;
mod lifecycle;

pub struct InjectiveChainAdapter;

pub static INJECTIVE_CHAIN_ADAPTER: InjectiveChainAdapter = InjectiveChainAdapter;

const INJECTIVE_NETWORKS: [ChainNetwork; 3] = [
    ChainNetwork {
        name: "local",
        description: "Local Docker-based Injective devnet",
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
    description: "Keep local Injective Docker state in ~/.injectived-local between runs",
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

const INJECTIVE_TESTNET_STATE_SYNC_SPEC: CosmosStateSyncSpec = CosmosStateSyncSpec {
    default_trust_rpc_url: config::TESTNET_TRUST_RPC_URL,
    trust_offset: config::TESTNET_TRUST_OFFSET,
    seeds: config::TESTNET_SEEDS,
    persistent_peers: config::TESTNET_PERSISTENT_PEERS,
};

const INJECTIVE_TESTNET_NODE_SPEC: CosmosNodeSpec = CosmosNodeSpec {
    chain_name: "Injective",
    binary: "injectived",
    chain_id: config::TESTNET_CHAIN_ID,
    moniker: config::TESTNET_MONIKER,
    status_url: config::TESTNET_STATUS_URL,
    rpc_laddr: config::TESTNET_RPC_LADDR,
    grpc_address: config::TESTNET_GRPC_ADDRESS,
    grpc_web_address: None,
    api_address: config::TESTNET_API_ADDRESS,
    home_dir: config::TESTNET_HOME_DIR,
    pid_file: config::TESTNET_PID_FILE,
    log_file: config::TESTNET_LOG_FILE,
    state_sync: Some(INJECTIVE_TESTNET_STATE_SYNC_SPEC),
};

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
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;
        let network = CosmosNetworkKind::parse(request.network)?;
        let options = CosmosChainOptions::from_flags(request.flags)?;

        match network {
            CosmosNetworkKind::Local => {
                let injective_dir = workspace_dir(project_root_path);
                lifecycle::prepare_local(
                    project_root_path,
                    injective_dir.as_path(),
                    options.stateful_or(false),
                )
                .await
                .map_err(|error| format!("Failed to prepare Injective local node: {}", error))?;
                lifecycle::start_local(project_root_path, injective_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to start Injective local node: {}", error))?;
                Ok(())
            }
            CosmosNetworkKind::Testnet => {
                let injective_dir = workspace_dir(project_root_path);
                lifecycle::prepare_testnet(&INJECTIVE_TESTNET_NODE_SPEC, options.stateful_or(true))
                    .await
                    .map_err(|error| {
                        format!("Failed to prepare Injective testnet node: {}", error)
                    })?;

                hermes::ensure_testnet_chain_in_hermes_config(
                    project_root_path,
                    injective_dir.as_path(),
                )
                .map_err(|error| {
                    format!(
                        "Failed to update Hermes config for Injective testnet: {}",
                        error
                    )
                })?;

                lifecycle::start_testnet(
                    &INJECTIVE_TESTNET_NODE_SPEC,
                    options.trust_rpc_url(INJECTIVE_TESTNET_STATE_SYNC_SPEC.default_trust_rpc_url),
                )
                .await
                .map_err(|error| format!("Failed to start Injective testnet node: {}", error))?;
                Ok(())
            }
            CosmosNetworkKind::Mainnet => Err(
                "Injective network 'mainnet' is not implemented yet. Supported networks: local, testnet."
                    .to_string(),
            ),
        }
    }

    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        match CosmosNetworkKind::parse(network)? {
            CosmosNetworkKind::Local => {
                let injective_dir = workspace_dir(project_root_path);
                lifecycle::stop_local(injective_dir.as_path());
                Ok(())
            }
            CosmosNetworkKind::Testnet => lifecycle::stop_testnet(&INJECTIVE_TESTNET_NODE_SPEC)
                .map_err(|error| format!("Failed to stop local Injective testnet node: {}", error)),
            CosmosNetworkKind::Mainnet => Ok(()),
        }
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;
        match CosmosNetworkKind::parse(network)? {
            CosmosNetworkKind::Local => {
                let rpc_status = check_rpc_health(
                    "injective",
                    config::LOCAL_STATUS_URL,
                    config::LOCAL_RPC_PORT,
                    "Injective local node",
                );
                let grpc_status =
                    check_port_health("injective", config::LOCAL_GRPC_PORT, "Injective local node");

                Ok(vec![ChainHealthStatus {
                    id: "injective",
                    label: "Injective local node",
                    healthy: rpc_status.healthy && grpc_status.healthy,
                    status: format!(
                        "RPC ({}): {}; gRPC ({}): {}",
                        config::LOCAL_RPC_PORT,
                        if rpc_status.healthy {
                            "reachable"
                        } else {
                            "not reachable"
                        },
                        config::LOCAL_GRPC_PORT,
                        if grpc_status.healthy {
                            "reachable"
                        } else {
                            "not reachable"
                        }
                    ),
                }])
            }
            CosmosNetworkKind::Testnet => Ok(vec![managed_node_health(
                "injective",
                "Injective node",
                &INJECTIVE_TESTNET_NODE_SPEC,
            )?]),
            CosmosNetworkKind::Mainnet => Ok(vec![ChainHealthStatus {
                id: "injective",
                label: "Injective mainnet",
                healthy: false,
                status: "Not implemented yet. Start with --network local or --network testnet."
                    .to_string(),
            }]),
        }
    }
}

/// Returns the local runtime workspace used by Injective scripts and docker compose.
pub fn workspace_dir(project_root: &Path) -> PathBuf {
    if let Some(home) = home_dir() {
        return home
            .join(".caribic")
            .join("injective")
            .join("workspace")
            .join("injective");
    }

    project_root
        .join(".caribic")
        .join("injective")
        .join("workspace")
        .join("injective")
}

/// Stops local Injective containers if they exist.
pub fn stop_local(injective_path: &Path) {
    lifecycle::stop_local(injective_path);
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Injective.
pub fn configure_hermes_for_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_demo(project_root_path, injective_dir)
}
