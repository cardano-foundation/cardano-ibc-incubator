use std::path::Path;

use crate::chains::hermes_support::{
    self, HermesAddressType, HermesCosmosChainProfile, HermesEventSource, HermesGasPrice,
    HermesTrustThreshold,
};
use crate::chains::osmosis::config as osmosis_config;

pub(super) fn configure_hermes_for_demo(
    _osmosis_dir: &Path,
    network: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    Err(format!(
        "Osmosis {network} demo route setup is disabled because the intermediary-chain route has been phased out. Direct Cardano-to-Osmosis routes are not implemented yet."
    )
    .into())
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
