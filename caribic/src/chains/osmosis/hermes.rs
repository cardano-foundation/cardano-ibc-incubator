use std::path::Path;

use crate::chains::hermes_support::{
    self, HermesAddressType, HermesCosmosChainProfile, HermesEventSource, HermesGasPrice,
    HermesTrustThreshold,
};
use crate::chains::osmosis::config as osmosis_config;
use crate::process::hermes::HermesCli;

pub(super) fn configure_hermes_for_demo(
    osmosis_dir: &Path,
    network: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    match network {
        "local" => configure_local_hermes_for_demo(osmosis_dir),
        "testnet" => ensure_testnet_chain_in_hermes_config(osmosis_dir),
        other => Err(format!(
            "Unsupported Osmosis network '{}' for Hermes demo configuration",
            other
        )
        .into()),
    }
}

pub(super) fn ensure_testnet_chain_in_hermes_config(
    _osmosis_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &testnet_chain_profile(),
        "Osmosis testnet chain using external public endpoints",
    )
}

fn testnet_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: osmosis_config::TESTNET_CHAIN_ID.to_string(),
        rpc_addr: osmosis_config::TESTNET_RPC_URL.to_string(),
        grpc_addr: osmosis_config::TESTNET_GRPC_URL.to_string(),
        event_source: HermesEventSource::Push {
            url: osmosis_config::TESTNET_EVENT_SOURCE_URL.to_string(),
            batch_delay: "200ms",
        },
        rpc_timeout: "10s",
        trusted_node: None,
        account_prefix: "osmo",
        key_name: format!("{}-relayer", osmosis_config::TESTNET_CHAIN_ID),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "0.1",
            denom: "uosmo",
        },
        gas_multiplier: "2.0",
        max_msg_num: 20,
        max_tx_size: 209_715,
        clock_drift: "20s",
        max_block_time: "10s",
        trusting_period: "10days",
        memo_prefix: Some("Osmosis Docs Rocks"),
        trust_threshold: HermesTrustThreshold {
            numerator: "1",
            denominator: "3",
        },
        compat_mode: None,
    }
}

fn configure_local_hermes_for_demo(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &local_chain_profile(),
        "Local Osmosis chain used by direct Cardano token-transfer routes",
    )?;

    let hermes_binary = resolve_local_hermes_binary(osmosis_dir)?;
    let mnemonic_file = osmosis_dir.join("scripts/hermes/osmosis");
    if !mnemonic_file.is_file() {
        return Err(format!(
            "Osmosis Hermes mnemonic file not found at {}. Start or prepare the local Osmosis chain first.",
            mnemonic_file.display()
        )
        .into());
    }

    HermesCli::new(hermes_binary.as_path())
        .output(
            Some(osmosis_dir.join("scripts").as_path()),
            &[
                "keys",
                "add",
                "--overwrite",
                "--chain",
                osmosis_config::LOCAL_CHAIN_ID,
                "--mnemonic-file",
                mnemonic_file
                    .to_str()
                    .ok_or("Invalid Osmosis mnemonic file path")?,
            ],
        )
        .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;

    Ok(())
}

fn local_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: osmosis_config::LOCAL_CHAIN_ID.to_string(),
        rpc_addr: osmosis_config::LOCAL_RPC_URL.to_string(),
        grpc_addr: "http://127.0.0.1:9096".to_string(),
        event_source: HermesEventSource::Push {
            url: "ws://127.0.0.1:26658/websocket".to_string(),
            batch_delay: "200ms",
        },
        rpc_timeout: "10s",
        trusted_node: Some(true),
        account_prefix: "osmo",
        key_name: "osmosis".to_string(),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "0.1",
            denom: "uosmo",
        },
        gas_multiplier: "2.0",
        max_msg_num: 20,
        max_tx_size: 209_715,
        clock_drift: "20s",
        max_block_time: "10s",
        trusting_period: "10days",
        memo_prefix: Some("Caribic"),
        trust_threshold: HermesTrustThreshold {
            numerator: "1",
            denominator: "3",
        },
        compat_mode: None,
    }
}

fn resolve_local_hermes_binary(osmosis_dir: &Path) -> Result<std::path::PathBuf, String> {
    let project_root = Path::new(&crate::config::get_config().project_root).to_path_buf();
    hermes_support::resolve_local_hermes_binary(project_root.as_path(), osmosis_dir).ok_or_else(
        || {
            "Local Hermes binary not found. Run: cd relayer && cargo build --release --bin hermes"
                .to_string()
        },
    )
}
