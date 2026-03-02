use std::path::{Path, PathBuf};

use async_trait::async_trait;
use dirs::home_dir;

use crate::chains::{
    check_port_health, check_rpc_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};
use crate::logger::warn;

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
        description: "Local osmosisd node synced to Osmosis testnet via state sync",
        managed_by_caribic: true,
    },
];

const OSMOSIS_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description: "Keep local Osmosis state instead of resetting it",
    required: false,
}];

const OSMOSIS_TESTNET_FLAGS: [ChainFlagSpec; 2] = [
    ChainFlagSpec {
        name: "stateful",
        description: "Keep local testnet node state in ~/.osmosisd-testnet between runs",
        required: false,
    },
    ChainFlagSpec {
        name: "trust-rpc-url",
        description: "Trusted Osmosis testnet RPC base URL used for state sync bootstrap",
        required: false,
    },
];

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
                lifecycle::prepare_local(project_root_path, osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                lifecycle::start_local(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to start Osmosis appchain: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let stateful = parse_bool_flag(request.flags, "stateful", true)?;
                let trust_rpc_url = request.flags.get("trust-rpc-url").cloned();
                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::prepare_testnet(project_root_path, osmosis_dir.as_path(), stateful)
                    .await
                    .map_err(|error| {
                        format!("Failed to prepare Osmosis testnet node: {}", error)
                    })?;
                hermes::ensure_testnet_chain_in_hermes_config(osmosis_dir.as_path()).map_err(
                    |error| {
                        format!(
                            "Failed to update Hermes config for Osmosis testnet: {}",
                            error
                        )
                    },
                )?;
                lifecycle::start_testnet(osmosis_dir.as_path(), trust_rpc_url.as_deref())
                    .await
                    .map_err(|error| format!("Failed to start Osmosis testnet node: {}", error))?;
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
            "testnet" => {
                lifecycle::stop_testnet().map_err(|error| {
                    format!("Failed to stop local Osmosis testnet node: {}", error)
                })?;
                Ok(())
            }
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
                    config::LOCAL_STATUS_URL,
                    26658,
                    "Osmosis appchain (RPC)",
                ),
                check_port_health("redis", 6379, "Osmosis Redis sidecar"),
            ]),
            "testnet" => Ok(vec![check_rpc_health(
                "osmosis",
                config::TESTNET_LOCAL_STATUS_URL,
                26658,
                "Osmosis testnet node (RPC)",
            )]),
            _ => Err(format!(
                "Unsupported network '{}' for chain '{}'",
                network,
                self.id()
            )),
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

/// Stops local Osmosis containers if they exist.
pub fn stop_local(osmosis_path: &Path) {
    lifecycle::stop_local(osmosis_path);
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Osmosis.
pub fn configure_hermes_for_demo(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    hermes::configure_hermes_for_demo(osmosis_dir)
}
