use std::fs;
use std::path::Path;

use serde::Deserialize;

pub(super) const LOCAL_DOCKER_IMAGE: &str = "local:injective-cardano-probabilistic";
pub(super) const LOCAL_CONFIGURATION_FILE: &str = "chains/injective/configuration/config.yml";
pub(super) const SOURCE_ZIP_URL: &str =
    "https://github.com/InjectiveFoundation/injective-core/archive/refs/tags/v1.18.0-1770939123.zip";

pub(super) const LOCAL_CHAIN_ID: &str = "injective-777";
pub(super) const LOCAL_MONIKER: &str = "caribic-injective-local";
pub(super) const LOCAL_STATUS_URL: &str = "http://127.0.0.1:26660/status";
pub(super) const LOCAL_RPC_PORT: u16 = 26660;
pub(super) const LOCAL_GRPC_PORT: u16 = 9097;
pub(super) const LOCAL_HOME_DIR: &str = ".injectived-local";
pub(super) const LOCAL_VALIDATOR_KEY: &str = "validator";
pub(super) const LOCAL_VALIDATOR_MNEMONIC_ACCOUNT: &str = "injective-local-validator";
pub(super) const LOCAL_RELAYER_MNEMONIC_ACCOUNT: &str = "injective-local-relayer";
pub(super) const ENTRYPOINT_RELAYER_MNEMONIC_ACCOUNT: &str = "entrypoint-relayer";
pub(super) const LOCAL_GENESIS_ACCOUNT_AMOUNT: &str =
    "100000000000000000000stake,100000000000000000000inj";
pub(super) const LOCAL_GENTX_AMOUNT: &str = "50000000000000000000stake";

pub(super) const TESTNET_CHAIN_ID: &str = "injective-888";
pub(super) const TESTNET_RPC_URL: &str = "https://injective-testnet-rpc.polkachu.com:443";
pub(super) const TESTNET_GRPC_URL: &str = "http://injective-grpc.polkachu.com:14390";
pub(super) const TESTNET_GRPC_HOST: &str = "injective-grpc.polkachu.com";
pub(super) const TESTNET_GRPC_PORT: u16 = 14390;
pub(super) const TESTNET_STATUS_URL: &str = "https://injective-testnet-rpc.polkachu.com/status";
pub(super) const TESTNET_HOME_DIR: &str = ".injectived-testnet";

#[derive(Debug, Deserialize)]
struct InjectiveConfigFile {
    accounts: Vec<AccountEntry>,
}

#[derive(Debug, Deserialize)]
struct AccountEntry {
    name: String,
    mnemonic: Option<String>,
}

/// Load a deterministic local-demo mnemonic by account name from chains/injective/configuration/config.yml.
pub(super) fn load_demo_mnemonic(
    project_root_path: &Path,
    account_name: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let config_path = project_root_path.join(LOCAL_CONFIGURATION_FILE);
    if !config_path.is_file() {
        return Err(format!(
            "Injective config file not found at {}",
            config_path.display()
        )
        .into());
    }

    let file_contents = fs::read_to_string(config_path.as_path()).map_err(|error| {
        format!(
            "Failed to read Injective config file {}: {}",
            config_path.display(),
            error
        )
    })?;

    let parsed: InjectiveConfigFile =
        serde_yaml::from_str(file_contents.as_str()).map_err(|error| {
            format!(
                "Failed to parse Injective config file {}: {}",
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
                "Missing mnemonic for Injective account '{}' in {}",
                account_name,
                config_path.display()
            )
            .into()
        })
}
