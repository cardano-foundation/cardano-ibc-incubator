use std::fs;
use std::path::Path;

use super::config;
use crate::chains::hermes_support;
use crate::chains::hermes_support::{
    HermesAddressType, HermesCosmosChainProfile, HermesGasPrice, HermesTrustThreshold,
};
use crate::process::hermes::HermesCli;

/// Best-effort sync of the local cheqd chain block and deterministic relayer key into Hermes.
///
/// Local chain startup should not fail just because Hermes has not been initialized yet, so this
/// function quietly returns when ~/.hermes/config.toml does not exist. Once the relayer exists, we
/// keep the cheqd-local chain block and key aligned with the local chain defaults so generic
/// `caribic create-client`/`create-connection` commands can target cheqd-local without an extra
/// manual config step.
pub(super) fn sync_local_chain_with_hermes(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if hermes_support::hermes_config_path().is_none() {
        return Ok(());
    }

    ensure_local_chain_in_hermes_config(project_root_path, cheqd_dir)?;
    ensure_local_key_in_hermes_keyring(project_root_path, cheqd_dir)?;
    Ok(())
}

fn ensure_local_chain_in_hermes_config(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let _ = project_root_path;
    hermes_support::ensure_cosmos_chain_in_hermes_config(
        &local_chain_profile(),
        "Local cheqd chain managed by caribic",
    )?;
    let _ = cheqd_dir;
    Ok(())
}

fn local_chain_profile() -> HermesCosmosChainProfile {
    HermesCosmosChainProfile {
        id: config::LOCAL_CHAIN_ID.to_string(),
        rpc_addr: format!("http://127.0.0.1:{}", config::LOCAL_RPC_PORT),
        grpc_addr: format!("http://127.0.0.1:{}", config::LOCAL_GRPC_PORT),
        event_source_url: format!("ws://127.0.0.1:{}/websocket", config::LOCAL_RPC_PORT),
        rpc_timeout: "10s",
        trusted_node: Some(true),
        account_prefix: "cheqd",
        key_name: config::LOCAL_RELAYER_MNEMONIC_ACCOUNT.to_string(),
        address_type: Some(HermesAddressType::Cosmos),
        store_prefix: "ibc",
        default_gas: 5_000_000,
        max_gas: 15_000_000,
        gas_price: HermesGasPrice {
            price: "50",
            denom: "ncheq",
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
        compat_mode: Some("0.38"),
    }
}

fn ensure_local_key_in_hermes_keyring(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = resolve_local_hermes_binary(project_root_path, cheqd_dir)?;
    if chain_has_any_keys(hermes_binary.as_path(), cheqd_dir, config::LOCAL_CHAIN_ID)? {
        return Ok(());
    }

    let mnemonic =
        config::load_demo_mnemonic(project_root_path, config::LOCAL_RELAYER_MNEMONIC_ACCOUNT)?;
    let mnemonic_file = write_temp_mnemonic_file("cheqd-local-relayer", mnemonic)?;
    let mnemonic_arg = mnemonic_file.to_string_lossy().to_string();
    let add_key_result = run_hermes_output(
        hermes_binary.as_path(),
        cheqd_dir,
        &[
            "keys",
            "add",
            "--overwrite",
            "--chain",
            config::LOCAL_CHAIN_ID,
            "--mnemonic-file",
            mnemonic_arg.as_str(),
        ],
    );
    let _ = fs::remove_file(mnemonic_file.as_path());
    add_key_result?;

    Ok(())
}

fn chain_has_any_keys(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = run_hermes_output(
        hermes_binary,
        working_dir,
        &["keys", "list", "--chain", chain_id],
    )?;
    if !output.status.success() {
        return Ok(false);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.to_ascii_lowercase().contains("no keys found") {
        return Ok(false);
    }

    // Hermes always logs startup information on stderr, even when a chain has no keys. Treat
    // stdout as the source of truth so log noise does not suppress the initial key import.
    Ok(stdout.contains("cheqd1"))
}

fn resolve_local_hermes_binary(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    hermes_support::resolve_local_hermes_binary(project_root_path, cheqd_dir).ok_or_else(|| {
        format!(
            "Local Hermes binary not found. Expected {}",
            project_root_path
                .join("relayer/target/release/hermes")
                .display()
        )
        .into()
    })
}

fn write_temp_mnemonic_file(
    prefix: &str,
    mnemonic: String,
) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    hermes_support::write_temp_mnemonic_file(prefix, mnemonic)
}

fn run_hermes_output(
    hermes_binary: &Path,
    working_dir: &Path,
    args: &[&str],
) -> Result<std::process::Output, Box<dyn std::error::Error>> {
    HermesCli::new(hermes_binary)
        .output(Some(working_dir), args)
        .map_err(Into::into)
}
