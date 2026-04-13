use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, ChainAdapter, ChainFlags, ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;
mod hermes;
mod lifecycle;

pub struct StellarChainAdapter;

pub static STELLAR_CHAIN_ADAPTER: StellarChainAdapter = StellarChainAdapter;

const STELLAR_NETWORKS: [ChainNetwork; 1] = [ChainNetwork {
    name: config::NETWORK_LOCAL_NAME,
    description: config::NETWORK_LOCAL_DESCRIPTION,
    managed_by_caribic: true,
}];

#[async_trait]
impl ChainAdapter for StellarChainAdapter {
    fn id(&self) -> &'static str {
        config::DISPLAY_NAME
    }

    fn display_name(&self) -> &'static str {
        "Stellar"
    }

    fn default_network(&self) -> &'static str {
        config::NETWORK_LOCAL_NAME
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &STELLAR_NETWORKS
    }

    async fn start(
        &self,
        _project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;

        lifecycle::start_local()
            .await
            .map_err(|error| format!("Failed to start Stellar quickstart container: {}", error))?;

        // Best-effort: insert the Stellar chain block into ~/.hermes/config.toml if it exists.
        // This is a no-op when Hermes is not yet set up.
        hermes::sync_local_chain_with_hermes()
            .map_err(|error| format!("Failed to sync Stellar chain into Hermes config: {}", error))?;

        Ok(())
    }

    fn stop(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        lifecycle::stop_local();
        Ok(())
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;

        Ok(vec![check_port_health(
            "stellar",
            config::LOCAL_PORT,
            "Stellar (Soroban RPC + Horizon on port 8000)",
        )])
    }
}
