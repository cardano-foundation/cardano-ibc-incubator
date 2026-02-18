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

struct OsmosisNetworkRuntime {
    status_url: &'static str,
    default_status_port: u16,
    source_zip_url: Option<&'static str>,
}

const OSMOSIS_LOCAL_SOURCE_ZIP_URL: &str =
    "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v30.0.1.zip";
const OSMOSIS_LOCAL_RUNTIME: OsmosisNetworkRuntime = OsmosisNetworkRuntime {
    status_url: "http://127.0.0.1:26658/status",
    default_status_port: 26658,
    source_zip_url: Some(OSMOSIS_LOCAL_SOURCE_ZIP_URL),
};
const OSMOSIS_TESTNET_RUNTIME: OsmosisNetworkRuntime = OsmosisNetworkRuntime {
    status_url: "https://rpc-test.osmosis.zone/status",
    default_status_port: 443,
    source_zip_url: None,
};

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
        let runtime = osmosis_network_runtime(request.network)?;

        match request.network {
            "local" => {
                let stateful = parse_bool_flag(request.flags, "stateful", false)?;
                if stateful {
                    warn(
                        "Local Osmosis 'stateful=true' was requested, but this mode is not wired yet. Proceeding with clean local setup.",
                    );
                }

                let osmosis_dir = workspace_dir(project_root_path);
                lifecycle::prepare_local(
                    osmosis_dir.as_path(),
                    runtime.source_zip_url.ok_or_else(|| {
                        "Missing Osmosis source zip URL for local network".to_string()
                    })?,
                )
                .await
                .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                lifecycle::start_local(osmosis_dir.as_path(), runtime.status_url)
                    .await
                    .map_err(|error| format!("Failed to start Osmosis appchain: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let rpc_url = request
                    .flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| runtime.status_url.to_string());
                let status = check_rpc_health(
                    "osmosis",
                    rpc_url.as_str(),
                    runtime.default_status_port,
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
        let runtime = osmosis_network_runtime(network)?;

        match network {
            "local" => Ok(vec![
                check_rpc_health(
                    "osmosis",
                    runtime.status_url,
                    runtime.default_status_port,
                    "Osmosis appchain (RPC)",
                ),
                check_port_health("redis", 6379, "Osmosis Redis sidecar"),
            ]),
            "testnet" => {
                let rpc_url = flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| runtime.status_url.to_string());
                Ok(vec![check_rpc_health(
                    "osmosis",
                    rpc_url.as_str(),
                    runtime.default_status_port,
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

fn osmosis_network_runtime(network: &str) -> Result<&'static OsmosisNetworkRuntime, String> {
    match network {
        "local" => Ok(&OSMOSIS_LOCAL_RUNTIME),
        "testnet" => Ok(&OSMOSIS_TESTNET_RUNTIME),
        _ => Err(format!(
            "Unsupported network '{}' for chain 'osmosis'",
            network
        )),
    }
}
