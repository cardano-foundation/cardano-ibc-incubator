use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, check_rpc_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;
mod lifecycle;

pub struct InjectiveChainAdapter;

pub static INJECTIVE_CHAIN_ADAPTER: InjectiveChainAdapter = InjectiveChainAdapter;

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
                lifecycle::prepare_local(stateful)
                    .await
                    .map_err(|error| format!("Failed to prepare Injective local node: {}", error))?;
                lifecycle::start_local()
                    .await
                    .map_err(|error| format!("Failed to start Injective local node: {}", error))?;
                Ok(())
            }
            "testnet" => {
                let stateful = parse_bool_flag(request.flags, "stateful", true)?;
                let trust_rpc_url = request.flags.get("trust-rpc-url").cloned();

                lifecycle::prepare_testnet(stateful)
                    .await
                    .map_err(|error| {
                        format!("Failed to prepare Injective testnet node: {}", error)
                    })?;
                lifecycle::start_testnet(trust_rpc_url.as_deref())
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
            "local" => {
                let local = config::local_runtime();
                Ok(vec![combined_health_status(
                    local.status_url.as_str(),
                    local.grpc_address.as_str(),
                )?])
            }
            "testnet" => {
                let testnet = config::testnet_runtime();
                Ok(vec![combined_health_status(
                    testnet.status_url.as_str(),
                    testnet.grpc_address.as_str(),
                )?])
            }
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

fn combined_health_status(
    status_url: &str,
    grpc_address: &str,
) -> Result<ChainHealthStatus, String> {
    let default_rpc_port = config::parse_port_from_url(status_url, "status_url")?;
    let grpc_port = config::parse_port_from_socket_address(grpc_address, "grpc_address")?;

    let rpc_ready = check_rpc_health(
        "injective",
        status_url,
        default_rpc_port,
        "Injective node (RPC)",
    )
    .healthy;
    let grpc_ready = check_port_health("injective", grpc_port, "Injective node").healthy;

    Ok(ChainHealthStatus {
        id: "injective",
        label: "Injective node",
        healthy: rpc_ready && grpc_ready,
        status: format!(
            "RPC ({}): {}; gRPC ({}): {}",
            default_rpc_port,
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
    })
}
