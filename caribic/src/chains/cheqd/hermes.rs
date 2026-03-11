use std::fs;
use std::path::Path;
use std::process::Command;

use super::config;
use crate::chains::hermes_support;
use crate::utils::execute_script;

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
    let source_config_path = project_root_path.join("chains/cheqd/configuration/hermes/config.toml");
    hermes_support::ensure_chain_in_hermes_config(
        source_config_path.as_path(),
        config::LOCAL_CHAIN_ID,
        "Local cheqd chain managed by caribic",
        "cheqd Hermes config",
    )?;
    let _ = cheqd_dir;
    Ok(())
}

fn ensure_local_key_in_hermes_keyring(
    project_root_path: &Path,
    cheqd_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let hermes_binary = resolve_local_hermes_binary(project_root_path, cheqd_dir)?;
    if chain_has_any_keys(hermes_binary.as_path(), cheqd_dir, config::LOCAL_CHAIN_ID)? {
        return Ok(());
    }

    let mnemonic = config::load_demo_mnemonic(project_root_path, config::LOCAL_RELAYER_MNEMONIC_ACCOUNT)?;
    let mnemonic_file = write_temp_mnemonic_file("cheqd-local-relayer", mnemonic)?;
    let mnemonic_arg = mnemonic_file.to_string_lossy().to_string();
    let hermes_binary_str = hermes_binary
        .to_str()
        .ok_or_else(|| format!("Invalid Hermes binary path: {}", hermes_binary.display()))?;

    let add_key_result = execute_script(
        cheqd_dir,
        hermes_binary_str,
        Vec::from([
            "keys",
            "add",
            "--overwrite",
            "--chain",
            config::LOCAL_CHAIN_ID,
            "--mnemonic-file",
            mnemonic_arg.as_str(),
        ]),
        None,
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
    let output = Command::new(hermes_binary)
        .current_dir(working_dir)
        .args(["keys", "list", "--chain", chain_id])
        .output()?;
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
            project_root_path.join("relayer/target/release/hermes").display()
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
