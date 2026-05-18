use std::path::Path;

use super::config;
use crate::chains::hermes_support::{
    self, HermesAddressType, HermesCosmosChainProfile, HermesEventSource, HermesGasPrice,
    HermesTrustThreshold,
};
use crate::process::hermes::HermesCli;

const INJECTIVE_ETH_HD_PATH: &str = "m/44'/60'/0'/0/0";

pub(super) fn configure_hermes_for_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &local_chain_profile(),
        "Local Injective chain used by direct Cardano token-transfer routes",
    )?;
    ensure_local_key(project_root_path, injective_dir)
}

pub(super) fn configure_hermes_for_testnet_demo(
    _project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_testnet_chain_in_hermes_config(_project_root_path, injective_dir)?;
    if !chain_has_any_keys(injective_dir, config::TESTNET_CHAIN_ID)? {
        return Err(format!(
            "No Hermes key configured for chain '{}'. Add one first with:\n  caribic keys add --chain {} --mnemonic-file <path> --hd-path {}",
            config::TESTNET_CHAIN_ID,
            config::TESTNET_CHAIN_ID,
            INJECTIVE_ETH_HD_PATH
        )
        .into());
    }
    Ok(())
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
            url: config::TESTNET_WEBSOCKET_URL.to_string(),
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

fn local_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: config::LOCAL_CHAIN_ID.to_string(),
        rpc_addr: format!("http://127.0.0.1:{}", config::LOCAL_RPC_PORT),
        grpc_addr: format!("http://127.0.0.1:{}", config::LOCAL_GRPC_PORT),
        event_source: HermesEventSource::Push {
            url: format!("ws://127.0.0.1:{}/websocket", config::LOCAL_RPC_PORT),
            batch_delay: "200ms",
        },
        rpc_timeout: "10s",
        trusted_node: Some(true),
        account_prefix: "inj",
        key_name: format!("{}-relayer", config::LOCAL_CHAIN_ID),
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

fn ensure_local_key(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mnemonic =
        config::load_demo_mnemonic(project_root_path, config::LOCAL_RELAYER_MNEMONIC_ACCOUNT)?;
    let mnemonic_file =
        hermes_support::write_temp_mnemonic_file("injective-local-relayer", mnemonic)?;
    let result = add_hermes_key(
        injective_dir,
        config::LOCAL_CHAIN_ID,
        Some(INJECTIVE_ETH_HD_PATH),
        mnemonic_file
            .to_str()
            .ok_or("Invalid Injective mnemonic file path")?,
        true,
    );
    let _ = std::fs::remove_file(mnemonic_file.as_path());
    result
}

fn add_hermes_key(
    working_dir: &Path,
    chain_id: &str,
    hd_path: Option<&str>,
    mnemonic_file: &str,
    overwrite: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = resolve_local_hermes_binary(working_dir)?;
    let mut args = vec!["keys", "add"];
    if overwrite {
        args.push("--overwrite");
    }
    args.extend(["--chain", chain_id]);
    if let Some(hd_path) = hd_path {
        args.extend(["--hd-path", hd_path]);
    }
    args.extend(["--mnemonic-file", mnemonic_file]);

    HermesCli::new(hermes_binary.as_path())
        .output(Some(working_dir), args.as_slice())
        .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
    Ok(())
}

fn chain_has_any_keys(
    working_dir: &Path,
    chain_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let hermes_binary = resolve_local_hermes_binary(working_dir)?;
    let output = HermesCli::new(hermes_binary.as_path())
        .output(Some(working_dir), &["keys", "list", "--chain", chain_id]);
    let Ok(output) = output else {
        return Ok(false);
    };
    if !output.status.success() {
        return Ok(false);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(stdout.contains(chain_id) || stderr.contains(chain_id))
}

fn resolve_local_hermes_binary(search_root: &Path) -> Result<std::path::PathBuf, String> {
    let project_root = Path::new(&crate::config::get_config().project_root).to_path_buf();
    hermes_support::resolve_local_hermes_binary(project_root.as_path(), search_root).ok_or_else(
        || {
            "Local Hermes binary not found. Run: cd relayer && cargo build --release --bin hermes"
                .to_string()
        },
    )
}
