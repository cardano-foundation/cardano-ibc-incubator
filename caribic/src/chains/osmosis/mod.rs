use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::chains::{
    check_port_health, check_rpc_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};
use crate::logger::warn;

mod hermes;
mod lifecycle;

pub struct OsmosisChainAdapter;

pub static OSMOSIS_CHAIN_ADAPTER: OsmosisChainAdapter = OsmosisChainAdapter;

const OSMOSIS_TESTNET_STATUS_URL: &str = "https://rpc-test.osmosis.zone/status";
const OSMOSIS_LOCAL_STATUS_URL: &str = "http://127.0.0.1:26658/status";

const OSMOSIS_NETWORKS: [ChainNetwork; 2] = [
    ChainNetwork {
        name: "local",
        description: "Local Docker-based appchain and Redis sidecar",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "testnet",
        description: "Public Osmosis testnet endpoint",
        managed_by_caribic: false,
    },
];

const OSMOSIS_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description: "Keep local Osmosis state instead of resetting it",
    required: false,
}];

const OSMOSIS_TESTNET_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "rpc-url",
    description: "Osmosis testnet RPC status endpoint URL",
    required: false,
}];

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

        match request.network {
            "local" => {
                let stateful = parse_bool_flag(request.flags, "stateful", false)?;
                if stateful {
                    warn(
                        "Local Osmosis 'stateful=true' was requested, but this mode is not wired yet. Proceeding with clean local setup.",
                    );
                }

                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::prepare_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                lifecycle::start_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to start Osmosis appchain: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let rpc_url = request
                    .flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| OSMOSIS_TESTNET_STATUS_URL.to_string());
                let status = check_rpc_health(
                    "osmosis",
                    rpc_url.as_str(),
                    443,
                    "Osmosis testnet RPC endpoint (external)",
                );
                if !status.healthy {
                    return Err(format!(
                        "Osmosis testnet endpoint is unreachable: {}",
                        status.status
                    ));
                }
                Ok(())
            }
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                request.network,
                self.id()
            )),
        }
    }

    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;

        match network {
            "local" => {
                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::stop_local(osmosis_dir.as_path());
                Ok(())
            }
            "testnet" => Ok(()),
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
            "local" => Ok(vec![
                check_rpc_health(
                    "osmosis",
                    OSMOSIS_LOCAL_STATUS_URL,
                    26658,
                    "Osmosis appchain (RPC)",
                ),
                check_port_health("redis", 6379, "Osmosis Redis sidecar"),
            ]),
            "testnet" => {
                let rpc_url = flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| OSMOSIS_TESTNET_STATUS_URL.to_string());
                Ok(vec![check_rpc_health(
                    "osmosis",
                    rpc_url.as_str(),
                    443,
                    "Osmosis testnet RPC endpoint (external)",
                )])
            }
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
        }
    }
}

/// Returns the local workspace directory used by Osmosis scripts and docker compose.
pub fn workspace_dir(project_root: &Path) -> PathBuf {
    project_root
        .join("chains")
        .join("osmosis")
        .join("osmosis")
        .to_path_buf()
}

/// Stops local Osmosis containers if they exist.
pub fn stop_local(osmosis_path: &Path) {
    lifecycle::stop_local(osmosis_path);
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Osmosis.
pub fn configure_hermes_for_demo(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_demo(osmosis_dir)
}
