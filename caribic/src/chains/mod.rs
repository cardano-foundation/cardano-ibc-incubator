use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use async_trait::async_trait;

pub mod cheqd;
pub(crate) mod cosmos_node;
pub mod injective;
pub mod osmosis;

pub use cheqd::CHEQD_CHAIN_ADAPTER;
pub use injective::INJECTIVE_CHAIN_ADAPTER;
pub use osmosis::OSMOSIS_CHAIN_ADAPTER;

pub type ChainFlags = HashMap<String, String>;

#[derive(Clone, Copy)]
pub struct ChainNetwork {
    pub name: &'static str,
    pub description: &'static str,
    pub managed_by_caribic: bool,
}

#[derive(Clone, Copy)]
pub struct ChainFlagSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub required: bool,
}

pub struct ChainStartRequest<'a> {
    pub network: &'a str,
    pub flags: &'a ChainFlags,
}

pub struct ChainHealthStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub healthy: bool,
    pub status: String,
}

#[async_trait]
pub trait ChainAdapter: Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn default_network(&self) -> &'static str;
    fn supported_networks(&self) -> &'static [ChainNetwork];
    fn supported_flags(&self, _network: &str) -> &'static [ChainFlagSpec] {
        &[]
    }

    async fn start(
        &self,
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String>;
    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String>;
    fn health(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String>;

    fn resolve_network(&self, requested_network: Option<&str>) -> Result<String, String> {
        let network = requested_network.unwrap_or(self.default_network()).trim();
        if network.is_empty() {
            return Err(format!(
                "Empty network was provided for chain '{}'",
                self.id()
            ));
        }

        if self
            .supported_networks()
            .iter()
            .any(|supported| supported.name == network)
        {
            return Ok(network.to_string());
        }

        let supported = self
            .supported_networks()
            .iter()
            .map(|entry| entry.name)
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!(
            "Unsupported network '{}' for chain '{}'. Supported: {}",
            network,
            self.id(),
            supported
        ))
    }

    fn validate_flags(&self, network: &str, flags: &ChainFlags) -> Result<(), String> {
        let supported = self.supported_flags(network);

        for flag in flags.keys() {
            if !supported
                .iter()
                .any(|supported_flag| supported_flag.name == flag)
            {
                let allowed = if supported.is_empty() {
                    "none".to_string()
                } else {
                    supported
                        .iter()
                        .map(|spec| spec.name)
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                return Err(format!(
                    "Unsupported flag '{}' for chain '{}' network '{}'. Allowed: {}",
                    flag,
                    self.id(),
                    network,
                    allowed
                ));
            }
        }

        for required_flag in supported.iter().filter(|spec| spec.required) {
            if !flags.contains_key(required_flag.name) {
                return Err(format!(
                    "Missing required flag '{}' for chain '{}' network '{}'",
                    required_flag.name,
                    self.id(),
                    network
                ));
            }
        }

        Ok(())
    }
}

pub fn registered_chain_adapters() -> Vec<&'static dyn ChainAdapter> {
    vec![
        &OSMOSIS_CHAIN_ADAPTER,
        &CHEQD_CHAIN_ADAPTER,
        &INJECTIVE_CHAIN_ADAPTER,
    ]
}

pub fn get_chain_adapter(chain_id: &str) -> Option<&'static dyn ChainAdapter> {
    registered_chain_adapters()
        .into_iter()
        .find(|adapter| adapter.id() == chain_id)
}

pub fn parse_chain_flags(raw_flags: &[String]) -> Result<ChainFlags, String> {
    let mut parsed_flags = ChainFlags::new();

    for raw_flag in raw_flags {
        let (key, value) = raw_flag.split_once('=').ok_or_else(|| {
            format!(
                "Invalid --chain-flag '{}'. Expected KEY=VALUE format",
                raw_flag
            )
        })?;
        let normalized_key = key.trim();
        let normalized_value = value.trim();

        if normalized_key.is_empty() {
            return Err(format!(
                "Invalid --chain-flag '{}'. Key cannot be empty",
                raw_flag
            ));
        }
        if normalized_value.is_empty() {
            return Err(format!(
                "Invalid --chain-flag '{}'. Value cannot be empty",
                raw_flag
            ));
        }

        if parsed_flags
            .insert(normalized_key.to_string(), normalized_value.to_string())
            .is_some()
        {
            return Err(format!(
                "Duplicate --chain-flag key '{}' was provided",
                normalized_key
            ));
        }
    }

    Ok(parsed_flags)
}

pub fn parse_bool_flag(
    flags: &ChainFlags,
    flag_name: &str,
    default_value: bool,
) -> Result<bool, String> {
    let Some(raw_value) = flags.get(flag_name) else {
        return Ok(default_value);
    };

    match raw_value.to_lowercase().as_str() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" => Ok(false),
        _ => Err(format!(
            "Flag '{}' expects a boolean value (true/false), got '{}'",
            flag_name, raw_value
        )),
    }
}

pub fn check_port_health(id: &'static str, port: u16, label: &'static str) -> ChainHealthStatus {
    let is_healthy = Command::new("nc")
        .args(["-z", "localhost", &port.to_string()])
        .output()
        .ok()
        .is_some_and(|output| output.status.success());

    if is_healthy {
        ChainHealthStatus {
            id,
            label,
            healthy: true,
            status: format!("Running on port {}", port),
        }
    } else {
        ChainHealthStatus {
            id,
            label,
            healthy: false,
            status: format!("Not running (port {} not accessible)", port),
        }
    }
}

pub fn check_rpc_health(
    id: &'static str,
    url: &str,
    default_port: u16,
    label: &'static str,
) -> ChainHealthStatus {
    let parsed_url = reqwest::Url::parse(url).ok();
    let parsed_port = parsed_url
        .as_ref()
        .and_then(|parsed_url| parsed_url.port_or_known_default())
        .unwrap_or(default_port);
    let host = parsed_url
        .as_ref()
        .and_then(|parsed_url| parsed_url.host_str())
        .unwrap_or("localhost");
    let local_host = matches!(host, "localhost" | "127.0.0.1" | "::1");

    if local_host {
        let port_status = check_port_health(id, parsed_port, label);
        if !port_status.healthy {
            return port_status;
        }
    }

    let rpc_response_ok = Command::new("curl")
        .args(["-sS", "--connect-timeout", "3", "--max-time", "8", url])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("result"))
        .unwrap_or(false);

    if rpc_response_ok {
        ChainHealthStatus {
            id,
            label,
            healthy: true,
            status: format!("RPC reachable at {} (port {})", host, parsed_port),
        }
    } else {
        ChainHealthStatus {
            id,
            label,
            healthy: false,
            status: format!(
                "RPC endpoint did not return a valid status response: {}",
                url
            ),
        }
    }
}
