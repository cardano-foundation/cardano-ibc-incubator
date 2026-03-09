use std::path::{Path, PathBuf};

use async_trait::async_trait;
use dirs::home_dir;

use crate::chains::{
    check_port_health, check_rpc_health, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;
mod hermes;
mod lifecycle;

pub struct CheqdChainAdapter;

pub static CHEQD_CHAIN_ADAPTER: CheqdChainAdapter = CheqdChainAdapter;

const CHEQD_NETWORKS: [ChainNetwork; 1] = [ChainNetwork {
    name: config::NETWORK_LOCAL_NAME,
    description: config::NETWORK_LOCAL_DESCRIPTION,
    managed_by_caribic: true,
}];

const CHEQD_LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: config::FLAG_STATEFUL_NAME,
    description: config::FLAG_STATEFUL_DESCRIPTION,
    required: false,
}];

#[async_trait]
impl ChainAdapter for CheqdChainAdapter {
    fn id(&self) -> &'static str {
        config::DISPLAY_NAME
    }

    fn display_name(&self) -> &'static str {
        config::DISPLAY_NAME
    }

    fn default_network(&self) -> &'static str {
        config::NETWORK_LOCAL_NAME
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &CHEQD_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        match network {
            "local" => &CHEQD_LOCAL_FLAGS,
            _ => &[],
        }
    }

    async fn start(
        &self,
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;
        let stateful = request
            .flags
            .get(config::FLAG_STATEFUL_NAME)
            .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "y"))
            .unwrap_or(false);

        let cheqd_dir = workspace_dir(project_root_path);
        // Local cheqd is generated into a workspace under ~/.caribic so we can reuse the same
        // compose layout and node home across start/stop commands, just like the other managed
        // optional chains.
        lifecycle::prepare_local(project_root_path, cheqd_dir.as_path(), stateful)
            .await
            .map_err(|error| format!("Failed to prepare local cheqd node: {}", error))?;

        // Hermes needs the chain block and deterministic relayer key before users can target
        // cheqd-local with generic `caribic create-*` commands after startup succeeds.
        hermes::sync_local_chain_with_hermes(project_root_path, cheqd_dir.as_path())
            .map_err(|error| format!("Failed to sync cheqd into Hermes config: {}", error))?;

        lifecycle::start_local(cheqd_dir.as_path())
            .await
            .map_err(|error| format!("Failed to start local cheqd node: {}", error))?;

        Ok(())
    }

    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        let cheqd_dir = workspace_dir(project_root_path);
        lifecycle::stop_local(cheqd_dir.as_path());
        Ok(())
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;

        let rpc_status = check_rpc_health(
            "cheqd",
            config::LOCAL_STATUS_URL,
            config::LOCAL_RPC_PORT,
            "cheqd local node",
        );
        let grpc_status = check_port_health("cheqd", config::LOCAL_GRPC_PORT, "cheqd local node");

        Ok(vec![ChainHealthStatus {
            id: "cheqd",
            label: "cheqd local node",
            healthy: rpc_status.healthy && grpc_status.healthy,
            status: format!(
                "RPC ({}): {}; gRPC ({}): {}",
                config::LOCAL_RPC_PORT,
                if rpc_status.healthy { "reachable" } else { "not reachable" },
                config::LOCAL_GRPC_PORT,
                if grpc_status.healthy { "reachable" } else { "not reachable" },
            ),
        }])
    }
}

pub fn workspace_dir(project_root: &Path) -> PathBuf {
    if let Some(home) = home_dir() {
        return home
            .join(".caribic")
            .join("cheqd")
            .join("workspace")
            .join("cheqd");
    }

    project_root
        .join(".caribic")
        .join("cheqd")
        .join("workspace")
        .join("cheqd")
}
