use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, check_rpc_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};
use crate::config;
use crate::logger;
use crate::start;
use crate::stop;
use crate::utils;

pub struct OsmosisChainAdapter;

pub static OSMOSIS_CHAIN_ADAPTER: OsmosisChainAdapter = OsmosisChainAdapter;

const OSMOSIS_TESTNET_STATUS_URL: &str = "https://rpc-test.osmosis.zone/status";

const OSMOSIS_NETWORKS: [ChainNetwork; 2] = [
    ChainNetwork {
        name: "local",
        description: "Local Docker-based appchain and Redis sidecar",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "testnet",
        description: "Public Osmosis testnet endpoint (external process)",
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
                    logger::warn(
                        "Local Osmosis 'stateful=true' was requested, but this mode is not wired yet. Proceeding with clean local setup.",
                    );
                }

                let osmosis_dir = utils::get_osmosis_dir(project_root_path);
                start::prepare_osmosis(osmosis_dir.as_path())
                    .await
                    .map_err(|error| format!("Failed to prepare Osmosis appchain: {}", error))?;
                start::start_osmosis(osmosis_dir.as_path())
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
                let osmosis_dir = utils::get_osmosis_dir(project_root_path);
                stop::stop_osmosis(osmosis_dir.as_path());
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
            "local" => {
                let osmosis_status_url = config::get_config().health.osmosis_status_url;
                Ok(vec![
                    check_rpc_health(osmosis_status_url.as_str(), 26658, "Osmosis appchain (RPC)"),
                    check_port_health(6379, "Osmosis Redis sidecar"),
                ])
            }
            "testnet" => {
                let rpc_url = flags
                    .get("rpc-url")
                    .cloned()
                    .unwrap_or_else(|| OSMOSIS_TESTNET_STATUS_URL.to_string());
                Ok(vec![check_rpc_health(
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
