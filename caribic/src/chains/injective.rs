use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, parse_bool_flag, ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus,
    ChainNetwork, ChainStartRequest,
};

mod lifecycle;

pub struct InjectiveChainAdapter;

pub static INJECTIVE_CHAIN_ADAPTER: InjectiveChainAdapter = InjectiveChainAdapter;

const INJECTIVE_NETWORKS: [ChainNetwork; 2] = [
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
        "testnet"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &INJECTIVE_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
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
                "Injective network 'mainnet' is not implemented yet. Only 'testnet' is currently supported."
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
            "testnet" => {
                let rpc_ready = check_port_health("injective", 26659, "Injective node").healthy;
                let grpc_ready = check_port_health("injective", 9096, "Injective node").healthy;

                Ok(vec![ChainHealthStatus {
                    id: "injective",
                    label: "Injective node",
                    healthy: rpc_ready && grpc_ready,
                    status: format!(
                        "RPC (26659): {}; gRPC (9096): {}",
                        if rpc_ready {
                            "reachable"
                        } else {
                            "not reachable"
                        },
                        if grpc_ready {
                            "reachable"
                        } else {
                            "not reachable"
                        }
                    ),
                }])
            }
            "mainnet" => Ok(vec![ChainHealthStatus {
                id: "injective",
                label: "Injective mainnet",
                healthy: false,
                status: "Not implemented yet. Start with --network testnet for managed local mode."
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
