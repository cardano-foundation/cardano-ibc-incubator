use std::path::{Path, PathBuf};

use async_trait::async_trait;
use dirs::home_dir;

use crate::chains::{
    check_host_port_health, check_port_health, check_rpc_health,
    ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus, ChainNetwork, ChainStartRequest,
};
use crate::chains::cosmos_node::CosmosNetworkKind;

mod config;
mod hermes;
mod lifecycle;

pub struct OsmosisChainAdapter;

pub static OSMOSIS_CHAIN_ADAPTER: OsmosisChainAdapter = OsmosisChainAdapter;

const OSMOSIS_NETWORKS: [ChainNetwork; 2] = [
    ChainNetwork {
        name: "local",
        description: "Local Docker-based appchain and Redis sidecar",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "testnet",
        description: "External Osmosis testnet RPC/gRPC endpoints used by Hermes and health checks",
        managed_by_caribic: false,
    },
];

const OSMOSIS_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description: "Keep local Osmosis state instead of resetting it",
    required: false,
}];

const OSMOSIS_TESTNET_FLAGS: [ChainFlagSpec; 0] = [];

#[async_trait]
impl ChainAdapter for OsmosisChainAdapter {
    fn id(&self) -> &'static str {
        "osmosis"
    }

    fn display_name(&self) -> &'static str {
        "Osmosis"
    }

    fn default_network(&self) -> &'static str {
        "local"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &OSMOSIS_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
            "local" => &OSMOSIS_LOCAL_FLAGS,
            "testnet" => &OSMOSIS_TESTNET_FLAGS,
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
                let options = OsmosisChainOptions::from_flags(request.flags)?;
                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::prepare_local(
                    project_root_path,
                    osmosis_dir.as_path(),
                    options.stateful_or(false),
                )
                    .await
                    .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                lifecycle::start_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to start Osmosis appchain: {}", error))?;
                Ok(())
            }
            CosmosNetworkKind::Testnet => {
                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::sync_workspace_assets(project_root_path, osmosis_dir.as_path()).map_err(
                    |error| format!("Failed to refresh Osmosis workspace assets: {}", error),
                )?;
                hermes::ensure_testnet_chain_in_hermes_config(osmosis_dir.as_path()).map_err(
                    |error| format!("Failed to update Hermes config for Osmosis testnet: {}", error),
                )?;
                Ok(())
            }
            CosmosNetworkKind::Mainnet => Err(
                "Osmosis network 'mainnet' is not implemented yet. Supported networks: local, testnet."
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
                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::stop_local(osmosis_dir.as_path());
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
            CosmosNetworkKind::Local => Ok(vec![
                check_rpc_health(
                    "osmosis",
                    config::LOCAL_STATUS_URL,
                    26658,
                    "Osmosis appchain (RPC)",
                ),
                check_port_health("redis", 6379, "Osmosis Redis sidecar"),
            ]),
            CosmosNetworkKind::Testnet => Ok(vec![
                check_rpc_health(
                    "osmosis",
                    config::TESTNET_RPC_URL,
                    443,
                    "Osmosis testnet RPC",
                ),
                check_host_port_health(
                    "osmosis",
                    config::TESTNET_GRPC_HOST,
                    config::TESTNET_GRPC_PORT,
                    "Osmosis testnet gRPC",
                ),
            ]),
            CosmosNetworkKind::Mainnet => Ok(vec![ChainHealthStatus {
                id: "osmosis",
                label: "Osmosis mainnet",
                healthy: false,
                status: "Not implemented yet. Start with --network local or --network testnet."
                    .to_string(),
            }]),
        }
    }
}

/// Returns the local runtime workspace used by Osmosis scripts and docker compose.
pub fn workspace_dir(project_root: &Path) -> PathBuf {
    if let Some(home) = home_dir() {
        return home
            .join(".caribic")
            .join("osmosis")
            .join("workspace")
            .join("osmosis");
    }

    project_root
        .join(".caribic")
        .join("osmosis")
        .join("workspace")
        .join("osmosis")
}

pub fn sync_workspace_assets(
    project_root_path: &Path,
    osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    lifecycle::sync_workspace_assets(project_root_path, osmosis_dir)
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Osmosis.
pub fn configure_hermes_for_demo(
    osmosis_dir: &Path,
    network: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_demo(osmosis_dir, network)
}

pub fn demo_chain_id(network: &str) -> Result<&'static str, String> {
    match CosmosNetworkKind::parse(network)? {
        CosmosNetworkKind::Local => Ok(config::LOCAL_CHAIN_ID),
        CosmosNetworkKind::Testnet => Ok(config::TESTNET_CHAIN_ID),
        CosmosNetworkKind::Mainnet => Err(
            "Osmosis token-swap demo is not implemented for network 'mainnet'.".to_string(),
        ),
    }
}

pub fn demo_node_rpc_url(network: &str) -> Result<&'static str, String> {
    match CosmosNetworkKind::parse(network)? {
        CosmosNetworkKind::Local => Ok(config::LOCAL_RPC_URL),
        CosmosNetworkKind::Testnet => Ok(config::TESTNET_RPC_URL),
        CosmosNetworkKind::Mainnet => Err(
            "Osmosis token-swap demo is not implemented for network 'mainnet'.".to_string(),
        ),
    }
}

pub fn stop_for_network(osmosis_path: &Path, network: &str) -> Result<(), String> {
    match CosmosNetworkKind::parse(network)? {
        CosmosNetworkKind::Local => {
            lifecycle::stop_local(osmosis_path);
            Ok(())
        }
        CosmosNetworkKind::Testnet | CosmosNetworkKind::Mainnet => Ok(()),
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct OsmosisChainOptions {
    stateful: Option<bool>,
}

impl OsmosisChainOptions {
    fn from_flags(flags: &ChainFlags) -> Result<Self, String> {
        let mut options = Self::default();

        for (flag_name, raw_value) in flags {
            match flag_name.as_str() {
                "stateful" => {
                    options.stateful = Some(parse_bool_flag("stateful", raw_value)?);
                }
                _ => {
                    return Err(format!(
                        "Unsupported Osmosis flag '{}'. Allowed options: stateful",
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
