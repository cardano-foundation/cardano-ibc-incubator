use std::path::{Path, PathBuf};

use async_trait::async_trait;
use dirs::home_dir;

use crate::chains::{
    check_host_port_health, check_port_health, check_rpc_health, cosmos_node::CosmosNetworkKind,
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
        description:
            "External Injective testnet RPC/gRPC endpoints used by Hermes and health checks",
        managed_by_caribic: false,
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

const INJECTIVE_TESTNET_FLAGS: [ChainFlagSpec; 0] = [];

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
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;
        let network = CosmosNetworkKind::parse(request.network)?;

        match network {
            CosmosNetworkKind::Local => {
                let options = InjectiveChainOptions::from_flags(request.flags)?;
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
                lifecycle::prepare_testnet(
                    project_root_path,
                    injective_dir.as_path(),
                    true,
                )
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
            CosmosNetworkKind::Testnet => Ok(()),
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
            CosmosNetworkKind::Testnet => {
                let rpc_status = check_rpc_health(
                    "injective",
                    config::TESTNET_STATUS_URL,
                    443,
                    "Injective testnet RPC",
                );
                let grpc_status = check_host_port_health(
                    "injective",
                    config::TESTNET_GRPC_HOST,
                    config::TESTNET_GRPC_PORT,
                    "Injective testnet gRPC",
                );

                Ok(vec![ChainHealthStatus {
                    id: "injective",
                    label: "Injective testnet endpoints",
                    healthy: rpc_status.healthy && grpc_status.healthy,
                    status: format!(
                        "RPC ({}): {}; gRPC ({}): {}",
                        443,
                        if rpc_status.healthy {
                            "reachable"
                        } else {
                            "not reachable"
                        },
                        config::TESTNET_GRPC_PORT,
                        if grpc_status.healthy {
                            "reachable"
                        } else {
                            "not reachable"
                        }
                    ),
                }])
            }
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

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct InjectiveChainOptions {
    stateful: Option<bool>,
    snapshot_url: Option<String>,
}

impl InjectiveChainOptions {
    fn from_flags(flags: &ChainFlags) -> Result<Self, String> {
        let mut options = Self::default();

        for (flag_name, raw_value) in flags {
            match flag_name.as_str() {
                "stateful" => {
                    options.stateful = Some(parse_bool_flag("stateful", raw_value)?);
                }
                "snapshot-url" => {
                    options.snapshot_url = Some(raw_value.clone());
                }
                // Backward compatibility for older commands that still pass trust-rpc-url.
                "trust-rpc-url" => {
                    if let Some(snapshot_url) = &options.snapshot_url {
                        if snapshot_url != raw_value {
                            return Err(
                                "Conflicting Injective values for snapshot-url and trust-rpc-url"
                                    .to_string(),
                            );
                        }
                    } else {
                        options.snapshot_url = Some(raw_value.clone());
                    }
                }
                _ => {
                    return Err(format!(
                        "Unsupported Injective flag '{}'. Allowed options: stateful, snapshot-url",
                        flag_name
                    ));
                }
            }
        }

        Ok(options)
    }

    fn stateful_or(&self, default_value: bool) -> bool {
        self.stateful.unwrap_or(default_value)
    }

    fn snapshot_url(&self) -> Option<&str> {
        self.snapshot_url.as_deref()
    }
}

fn parse_bool_flag(flag_name: &str, raw_value: &str) -> Result<bool, String> {
    match raw_value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" => Ok(false),
        _ => Err(format!(
            "Option '{}' expects a boolean value (true/false), got '{}'",
            flag_name, raw_value
        )),
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

/// Stops Injective testnet container if it exists.
pub fn stop_testnet(injective_path: &Path) {
    lifecycle::stop_testnet(injective_path);
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Injective.
pub fn configure_hermes_for_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_demo(project_root_path, injective_dir)
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Injective testnet.
pub fn configure_hermes_for_testnet_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_testnet_demo(project_root_path, injective_dir)
}

/// Returns the Injective testnet chain id used by Caribic.
pub fn testnet_chain_id() -> &'static str {
    config::TESTNET_CHAIN_ID
}

/// Returns the Injective testnet status URL used by Caribic.
pub fn testnet_status_url() -> &'static str {
    config::TESTNET_STATUS_URL
}

/// Returns the Injective local chain id used by Caribic.
pub fn local_chain_id() -> &'static str {
    config::LOCAL_CHAIN_ID
}
