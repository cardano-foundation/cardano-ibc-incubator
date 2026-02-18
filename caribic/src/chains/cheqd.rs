use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

pub struct CheqdChainAdapter;

pub static CHEQD_CHAIN_ADAPTER: CheqdChainAdapter = CheqdChainAdapter;

const CHEQD_NETWORKS: [ChainNetwork; 1] = [ChainNetwork {
    name: "testnet",
    description: "Public cheqd testnet endpoint",
    managed_by_caribic: false,
}];

const CHEQD_TESTNET_FLAGS: [ChainFlagSpec; 3] = [
    ChainFlagSpec {
        name: "chain-id",
        description: "cheqd chain id (for example: cheqd-testnet-6)",
        required: false,
    },
    ChainFlagSpec {
        name: "rpc-url",
        description: "cheqd RPC status endpoint URL",
        required: false,
    },
    ChainFlagSpec {
        name: "grpc-url",
        description: "cheqd gRPC endpoint URL",
        required: false,
    },
];

#[async_trait]
impl ChainAdapter for CheqdChainAdapter {
    fn id(&self) -> &'static str {
        "cheqd"
    }

    fn display_name(&self) -> &'static str {
        "cheqd"
    }

    fn default_network(&self) -> &'static str {
        "testnet"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &CHEQD_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
            "testnet" => &CHEQD_TESTNET_FLAGS,
            _ => &[],
        }
    }

    async fn start(
        &self,
        _project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;
        Err("Not implemented for cheqd.".to_string())
    }

    fn stop(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        Err("Not implemented for cheqd.".to_string())
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;
        Ok(vec![ChainHealthStatus {
            id: "cheqd",
            label: "Cheqd",
            healthy: false,
            status: "Not implemented for cheqd.".to_string(),
        }])
    }
}
