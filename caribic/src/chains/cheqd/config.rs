use std::fs;
use std::path::Path;

use serde::Deserialize;

pub(super) const DISPLAY_NAME: &str = "cheqd";
pub(super) const LOCAL_CONFIGURATION_FILE: &str = "chains/cheqd/configuration/config.yml";
pub(super) const LOCAL_DOCKER_IMAGE: &str = "ghcr.io/cheqd/cheqd-node:4.1.6";

pub(super) const NETWORK_LOCAL_NAME: &str = "local";
pub(super) const NETWORK_LOCAL_DESCRIPTION: &str = "Local Docker-based cheqd node";

pub(super) const FLAG_STATEFUL_NAME: &str = "stateful";
pub(super) const FLAG_STATEFUL_DESCRIPTION: &str =
    "Keep local cheqd state in ~/.caribic/cheqd/workspace/cheqd/configuration/network-config between runs";

pub(super) const LOCAL_CHAIN_ID: &str = "cheqd-local";
pub(super) const LOCAL_MONIKER: &str = "caribic-cheqd-local";
pub(super) const LOCAL_STATUS_URL: &str = "http://127.0.0.1:27257/status";
pub(super) const LOCAL_RPC_PORT: u16 = 27257;
pub(super) const LOCAL_GRPC_PORT: u16 = 9690;
pub(super) const LOCAL_RELAYER_MNEMONIC_ACCOUNT: &str = "cheqd-local-relayer";
pub(super) const LOCAL_VALIDATOR_MNEMONIC_ACCOUNT: &str = "cheqd-local-validator";

#[derive(Debug, Deserialize)]
struct CheqdConfigFile {
    accounts: Vec<AccountEntry>,
}

#[derive(Debug, Deserialize)]
struct AccountEntry {
    name: String,
    mnemonic: Option<String>,
}

/// Load a deterministic local cheqd mnemonic by account name from chains/cheqd/configuration/config.yml.
pub(super) fn load_demo_mnemonic(
    project_root_path: &Path,
    account_name: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let config_path = project_root_path.join(LOCAL_CONFIGURATION_FILE);
    if !config_path.is_file() {
        return Err(format!("Cheqd config file not found at {}", config_path.display()).into());
    }

    let file_contents = fs::read_to_string(config_path.as_path()).map_err(|error| {
        format!(
            "Failed to read cheqd config file {}: {}",
            config_path.display(),
            error
        )
    })?;

    let parsed: CheqdConfigFile =
        serde_yaml::from_str(file_contents.as_str()).map_err(|error| {
            format!(
                "Failed to parse cheqd config file {}: {}",
                config_path.display(),
                error
            )
        })?;

    parsed
        .accounts
        .iter()
        .find(|account| account.name == account_name)
        .and_then(|account| account.mnemonic.as_ref())
        .map(|mnemonic| mnemonic.trim().to_string())
        .filter(|mnemonic| !mnemonic.is_empty())
        .ok_or_else(|| {
            format!(
                "Missing mnemonic for cheqd account '{}' in {}",
                account_name,
                config_path.display()
            )
            .into()
        })
}
