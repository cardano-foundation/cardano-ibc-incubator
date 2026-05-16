use std::path::Path;

use super::config;
use crate::chains::hermes_support::{
    self, HermesAddressType, HermesCosmosChainProfile, HermesEventSource, HermesGasPrice,
    HermesTrustThreshold,
};

pub(super) fn configure_hermes_for_demo(
    _project_root_path: &Path,
    _injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    Err(
        "Injective local demo route setup is disabled because the intermediary-chain route has been phased out. Direct Cardano-to-Injective routes are not implemented yet."
            .into(),
    )
}

pub(super) fn configure_hermes_for_testnet_demo(
    _project_root_path: &Path,
    _injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    Err(
        "Injective testnet demo route setup is disabled because the intermediary-chain route has been phased out. Direct Cardano-to-Injective routes are not implemented yet."
            .into(),
    )
}

pub(super) fn ensure_testnet_chain_in_hermes_config(
    _project_root_path: &Path,
    _injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &testnet_chain_profile(),
        "Injective testnet chain using external public endpoints",
    )
}

fn testnet_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: config::TESTNET_CHAIN_ID.to_string(),
        rpc_addr: config::TESTNET_RPC_URL.to_string(),
        grpc_addr: config::TESTNET_GRPC_URL.to_string(),
        event_source: HermesEventSource::Push {
            url: format!(
                "{}/websocket",
                config::TESTNET_RPC_URL.trim_end_matches('/')
            ),
            batch_delay: "200ms",
        },
        rpc_timeout: "10s",
        trusted_node: None,
        account_prefix: "inj",
        key_name: format!("{}-relayer", config::TESTNET_CHAIN_ID),
        address_type: Some(HermesAddressType::Ethermint {
            pk_type: "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
        }),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "500000000",
            denom: "inj",
        },
        gas_multiplier: "1.8",
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
