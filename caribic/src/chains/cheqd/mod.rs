use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;

pub struct CheqdChainAdapter;

pub static CHEQD_CHAIN_ADAPTER: CheqdChainAdapter = CheqdChainAdapter;

const CHEQD_NETWORKS: [ChainNetwork; 1] = [ChainNetwork {
    name: config::NETWORK_TESTNET_NAME,
    description: config::NETWORK_TESTNET_DESCRIPTION,
    managed_by_caribic: false,
}];

const CHEQD_TESTNET_FLAGS: [ChainFlagSpec; 3] = [
    ChainFlagSpec {
        name: config::FLAG_CHAIN_ID_NAME,
        description: config::FLAG_CHAIN_ID_DESCRIPTION,
        required: false,
    },
    ChainFlagSpec {
        name: config::FLAG_RPC_URL_NAME,
        description: config::FLAG_RPC_URL_DESCRIPTION,
        required: false,
    },
    ChainFlagSpec {
        name: config::FLAG_GRPC_URL_NAME,
        description: config::FLAG_GRPC_URL_DESCRIPTION,
        required: false,
    },
];

#[async_trait]
impl ChainAdapter for CheqdChainAdapter {
    fn id(&self) -> &'static str {
        config::DISPLAY_NAME
    }

    fn display_name(&self) -> &'static str {
        config::DISPLAY_NAME
    }

    fn default_network(&self) -> &'static str {
        config::NETWORK_TESTNET_NAME
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
            id: config::DISPLAY_NAME,
            label: "Cheqd",
            healthy: false,
            status: "Not implemented for cheqd.".to_string(),
        }])
    }
}
