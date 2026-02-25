use std::path::Path;
use std::process::Command;

use async_trait::async_trait;
use reqwest::Url;

use crate::chains::{
    check_rpc_health, ChainAdapter, ChainFlagSpec, ChainFlags, ChainHealthStatus, ChainNetwork,
    ChainStartRequest,
};

pub struct InjectiveChainAdapter;

pub static INJECTIVE_CHAIN_ADAPTER: InjectiveChainAdapter = InjectiveChainAdapter;

const INJECTIVE_NETWORKS: [ChainNetwork; 2] = [
    ChainNetwork {
        name: "testnet",
        description: "Public Injective testnet endpoints",
        managed_by_caribic: false,
    },
    ChainNetwork {
        name: "mainnet",
        description: "Public Injective mainnet endpoints",
        managed_by_caribic: false,
    },
];

const INJECTIVE_TESTNET_CHAIN_ID: &str = "injective-888";
const INJECTIVE_TESTNET_RPC_URL: &str = "https://testnet.sentry.tm.injective.network/status";
const INJECTIVE_TESTNET_GRPC_URL: &str = "https://testnet.sentry.chain.grpc.injective.network:443";

const INJECTIVE_MAINNET_CHAIN_ID: &str = "injective-1";
const INJECTIVE_MAINNET_RPC_URL: &str = "https://sentry.tm.injective.network/status";
const INJECTIVE_MAINNET_GRPC_URL: &str = "https://sentry.chain.grpc.injective.network:443";

const INJECTIVE_FLAGS: [ChainFlagSpec; 3] = [
    ChainFlagSpec {
        name: "chain-id",
        description: "Injective chain id override",
        required: false,
    },
    ChainFlagSpec {
        name: "rpc-url",
        description: "Injective RPC /status endpoint URL override",
        required: false,
    },
    ChainFlagSpec {
        name: "grpc-url",
        description: "Injective gRPC endpoint URL override",
        required: false,
    },
];

struct InjectiveDefaults {
    chain_id: &'static str,
    rpc_url: &'static str,
    grpc_url: &'static str,
    rpc_label: &'static str,
    grpc_label: &'static str,
}

struct InjectiveRuntimeConfig {
    chain_id: String,
    rpc_url: String,
    grpc_url: String,
    rpc_label: &'static str,
    grpc_label: &'static str,
}

fn defaults_for_network(network: &str) -> Result<InjectiveDefaults, String> {
    match network {
        "testnet" => Ok(InjectiveDefaults {
            chain_id: INJECTIVE_TESTNET_CHAIN_ID,
            rpc_url: INJECTIVE_TESTNET_RPC_URL,
            grpc_url: INJECTIVE_TESTNET_GRPC_URL,
            rpc_label: "Injective testnet (RPC)",
            grpc_label: "Injective testnet (gRPC)",
        }),
        "mainnet" => Ok(InjectiveDefaults {
            chain_id: INJECTIVE_MAINNET_CHAIN_ID,
            rpc_url: INJECTIVE_MAINNET_RPC_URL,
            grpc_url: INJECTIVE_MAINNET_GRPC_URL,
            rpc_label: "Injective mainnet (RPC)",
            grpc_label: "Injective mainnet (gRPC)",
        }),
        _ => Err(format!("Unsupported Injective network '{}'", network)),
    }
}

fn config_for_network(network: &str, flags: &ChainFlags) -> Result<InjectiveRuntimeConfig, String> {
    let defaults = defaults_for_network(network)?;
    Ok(InjectiveRuntimeConfig {
        chain_id: flags
            .get("chain-id")
            .cloned()
            .unwrap_or_else(|| defaults.chain_id.to_string()),
        rpc_url: flags
            .get("rpc-url")
            .cloned()
            .unwrap_or_else(|| defaults.rpc_url.to_string()),
        grpc_url: flags
            .get("grpc-url")
            .cloned()
            .unwrap_or_else(|| defaults.grpc_url.to_string()),
        rpc_label: defaults.rpc_label,
        grpc_label: defaults.grpc_label,
    })
}

fn check_grpc_endpoint(id: &'static str, label: &'static str, grpc_url: &str) -> ChainHealthStatus {
    let parsed_url = match Url::parse(grpc_url) {
        Ok(parsed_url) => parsed_url,
        Err(error) => {
            return ChainHealthStatus {
                id,
                label,
                healthy: false,
                status: format!("Invalid gRPC endpoint URL '{}': {}", grpc_url, error),
            }
        }
    };

    let host = parsed_url.host_str().unwrap_or_default();
    let port = parsed_url
        .port_or_known_default()
        .unwrap_or_else(|| if parsed_url.scheme() == "https" { 443 } else { 80 });

    if host.is_empty() {
        return ChainHealthStatus {
            id,
            label,
            healthy: false,
            status: format!("gRPC endpoint URL '{}' has no host", grpc_url),
        };
    }

    let reachable = Command::new("nc")
        .args(["-z", "-w", "3", host, &port.to_string()])
        .output()
        .ok()
        .is_some_and(|output| output.status.success());

    if reachable {
        ChainHealthStatus {
            id,
            label,
            healthy: true,
            status: format!("gRPC reachable at {}:{}", host, port),
        }
    } else {
        ChainHealthStatus {
            id,
            label,
            healthy: false,
            status: format!("gRPC endpoint not reachable at {}:{}", host, port),
        }
    }
}

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
            "testnet" | "mainnet" => &INJECTIVE_FLAGS,
            _ => &[],
        }
    }

    async fn start(
        &self,
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;

        let statuses = self.health(project_root_path, request.network, request.flags)?;
        let failing = statuses
            .iter()
            .filter(|status| !status.healthy)
            .map(|status| format!("{}: {}", status.label, status.status))
            .collect::<Vec<_>>();

        if failing.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Injective '{}' endpoints are not reachable:\n  - {}",
                request.network,
                failing.join("\n  - ")
            ))
        }
    }

    fn stop(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        Ok(())
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;
        let config = config_for_network(network, flags)?;

        let mut rpc_status = check_rpc_health("injective", config.rpc_url.as_str(), 443, config.rpc_label);
        rpc_status.status = format!("chain-id={} | {}", config.chain_id, rpc_status.status);

        let mut grpc_status =
            check_grpc_endpoint("injective-grpc", config.grpc_label, config.grpc_url.as_str());
        grpc_status.status = format!("chain-id={} | {}", config.chain_id, grpc_status.status);

        Ok(vec![rpc_status, grpc_status])
    }
}
