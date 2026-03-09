use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use dirs::home_dir;
use serde_json::Value;

use super::config;
use crate::logger::{log, verbose};
use crate::utils::{execute_script, extract_tendermint_connection_id, parse_tendermint_client_id};

const INJECTIVE_ETH_HD_PATH: &str = "m/44'/60'/0'/0/0";

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Injective local demo routing.
pub(super) fn configure_hermes_for_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    configure_hermes_for_demo_chain(
        project_root_path,
        injective_dir,
        config::LOCAL_CHAIN_ID,
        "Injective local chain used by token-swap demo",
    )
}

/// Configures Hermes keys, clients, connection, and channel for Entrypoint↔Injective testnet demo routing.
pub(super) fn configure_hermes_for_testnet_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    configure_hermes_for_demo_chain(
        project_root_path,
        injective_dir,
        config::TESTNET_CHAIN_ID,
        "Injective testnet chain used by token-swap demo",
    )
}

/// Ensures Hermes config contains an Injective testnet chain block (`injective-888`).
pub(super) fn ensure_testnet_chain_in_hermes_config(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_chain_in_hermes_config(
        project_root_path,
        injective_dir,
        config::TESTNET_CHAIN_ID,
        "Injective testnet chain used by local bootstrap node",
    )
}

fn configure_hermes_for_demo_chain(
    project_root_path: &Path,
    injective_dir: &Path,
    chain_id: &str,
    chain_block_comment: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_chain_in_hermes_config(
        project_root_path,
        injective_dir,
        chain_id,
        chain_block_comment,
    )?;

    let hermes_binary = resolve_local_hermes_binary(project_root_path, injective_dir)?;
    let cosmos_mnemonic = config::load_demo_mnemonic(
        project_root_path,
        config::ENTRYPOINT_RELAYER_MNEMONIC_ACCOUNT,
    )?;

    if has_open_transfer_channel(
        hermes_binary.as_path(),
        injective_dir,
        "entrypoint",
        chain_id,
    )? {
        log("PASS: Hermes transfer channel already open for Entrypoint↔Injective");
        return Ok(());
    }

    let hermes_binary_str = hermes_binary
        .to_str()
        .ok_or_else(|| format!("Invalid Hermes binary path: {}", hermes_binary.display()))?;
    let cosmos_mnemonic_file = write_temp_mnemonic_file("entrypoint-relayer", cosmos_mnemonic)?;
    let cosmos_mnemonic_arg = cosmos_mnemonic_file.to_string_lossy().to_string();
    let cosmos_key_result = add_hermes_key(
        injective_dir,
        hermes_binary_str,
        "entrypoint",
        None,
        cosmos_mnemonic_arg.as_str(),
        true,
    );
    let _ = fs::remove_file(cosmos_mnemonic_file.as_path());
    cosmos_key_result?;

    // For testnet, preserve existing Hermes key if present (it may be user-funded).
    // For local devnet, overwrite to keep behavior deterministic.
    let overwrite_injective_key = chain_id == config::LOCAL_CHAIN_ID;
    if overwrite_injective_key
        || !chain_has_any_keys(hermes_binary.as_path(), injective_dir, chain_id)?
    {
        let injective_mnemonic = match chain_id {
            config::LOCAL_CHAIN_ID => config::load_demo_mnemonic(
                project_root_path,
                config::LOCAL_RELAYER_MNEMONIC_ACCOUNT,
            )?,
            config::TESTNET_CHAIN_ID => {
                return Err(format!(
                    "No Hermes key configured for chain '{}'. Add one first with:\n  caribic keys add --chain {} --mnemonic-file <path> --hd-path {}",
                    chain_id,
                    chain_id,
                    INJECTIVE_ETH_HD_PATH
                )
                .into())
            }
            _ => {
                return Err(format!(
                    "Unsupported Injective chain '{}' for Hermes key setup",
                    chain_id
                )
                .into())
            }
        };
        let mnemonic_file =
            write_temp_mnemonic_file("injective-relayer", injective_mnemonic)?;
        let mnemonic_arg = mnemonic_file.to_string_lossy().to_string();
        let injective_key_result = add_hermes_key(
            injective_dir,
            hermes_binary_str,
            chain_id,
            Some(INJECTIVE_ETH_HD_PATH),
            mnemonic_arg.as_str(),
            overwrite_injective_key,
        );
        let _ = fs::remove_file(mnemonic_file.as_path());
        injective_key_result?;
    } else {
        verbose(&format!(
            "Preserving existing Hermes key(s) for chain {}",
            chain_id
        ));
    }

    let injective_client_id = create_client_with_retry(
        hermes_binary.as_path(),
        injective_dir,
        chain_id,
        "entrypoint",
        None,
    )?;
    let entrypoint_client_id = create_client_with_retry(
        hermes_binary.as_path(),
        injective_dir,
        "entrypoint",
        chain_id,
        Some("86000s"),
    )?;

    let create_connection_output = Command::new(&hermes_binary)
        .current_dir(injective_dir)
        .args([
            "create",
            "connection",
            "--a-chain",
            "entrypoint",
            "--a-client",
            entrypoint_client_id.as_str(),
            "--b-client",
            injective_client_id.as_str(),
        ])
        .output()?;
    if !create_connection_output.status.success() {
        return Err(format!(
            "Failed to create Entrypoint↔Injective connection for chain {}:\n{}",
            chain_id,
            String::from_utf8_lossy(&create_connection_output.stderr)
        )
        .into());
    }
    let connection_id = extract_tendermint_connection_id(create_connection_output)
        .ok_or("Failed to parse connection id from Hermes output")?;

    let create_channel_output = Command::new(&hermes_binary)
        .current_dir(injective_dir)
        .args([
            "create",
            "channel",
            "--a-chain",
            "entrypoint",
            "--a-connection",
            connection_id.as_str(),
            "--a-port",
            "transfer",
            "--b-port",
            "transfer",
        ])
        .output()?;
    if !create_channel_output.status.success() {
        return Err(format!(
            "Failed to create Entrypoint↔Injective transfer channel for chain {}:\n{}",
            chain_id,
            String::from_utf8_lossy(&create_channel_output.stderr)
        )
        .into());
    }

    Ok(())
}

fn add_hermes_key(
    working_dir: &Path,
    hermes_binary: &str,
    chain_id: &str,
    hd_path: Option<&str>,
    mnemonic_file: &str,
    overwrite: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut args = vec!["keys", "add"];
    if overwrite {
        args.push("--overwrite");
    }
    args.extend(["--chain", chain_id]);
    if let Some(hd_path) = hd_path {
        args.extend(["--hd-path", hd_path]);
    }
    args.extend(["--mnemonic-file", mnemonic_file]);

    execute_script(working_dir, hermes_binary, args, None)?;
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
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);
    let lower = combined.to_ascii_lowercase();
    if lower.contains("no keys found") {
        return Ok(false);
    }

    Ok(combined.contains("inj1")
        || combined.contains("cosmos1")
        || combined.contains("osmo1")
        || !combined.trim().is_empty())
}

fn create_client_with_retry(
    hermes_binary: &Path,
    working_dir: &Path,
    host_chain: &str,
    reference_chain: &str,
    trusting_period: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut last_error = String::new();

    for attempt in 1..=10 {
        let mut args = vec![
            "create",
            "client",
            "--host-chain",
            host_chain,
            "--reference-chain",
            reference_chain,
        ];
        if let Some(trusting_period) = trusting_period {
            args.push("--trusting-period");
            args.push(trusting_period);
        }

        let output: Output = Command::new(hermes_binary)
            .current_dir(working_dir)
            .args(args.as_slice())
            .output()?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if output.status.success() {
            if let Some(client_id) = parse_tendermint_client_id(stdout.as_str()) {
                return Ok(client_id);
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        last_error = format!(
            "attempt {attempt}/10 failed (status={}):\nstdout:\n{}\nstderr:\n{}",
            output.status,
            if stdout.trim().is_empty() {
                "<empty>"
            } else {
                stdout.trim()
            },
            if stderr.trim().is_empty() {
                "<empty>"
            } else {
                stderr.trim()
            }
        );

        if output.status.success() {
            // Command succeeded but output did not match expected client id pattern.
            // Retry, because some chains/indexers can delay parsable event materialization.
            verbose(&format!(
                "Hermes create client succeeded without a parseable client id on {host_chain} -> {reference_chain}; retrying..."
            ));
        }

        thread::sleep(Duration::from_secs(5));
    }

    Err(format!(
        "Failed to create Hermes client for host={} reference={}: {}",
        host_chain, reference_chain, last_error
    )
    .into())
}

fn has_open_transfer_channel(
    hermes_binary: &Path,
    working_dir: &Path,
    chain_id: &str,
    counterparty_chain_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new(hermes_binary)
        .current_dir(working_dir)
        .args([
            "--json",
            "query",
            "channels",
            "--chain",
            chain_id,
            "--counterparty-chain",
            counterparty_chain_id,
        ])
        .output()?;

    if !output.status.success() {
        verbose(&format!(
            "Hermes channel query failed for {}↔{}: {}",
            chain_id,
            counterparty_chain_id,
            String::from_utf8_lossy(&output.stderr)
        ));
        return Ok(false);
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let Some(result) = entry.get("result") else {
            continue;
        };

        if result
            .as_array()
            .is_some_and(|array| array.iter().any(is_open_transfer_channel_entry))
        {
            return Ok(true);
        }

        if is_open_transfer_channel_entry(result) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn is_open_transfer_channel_entry(value: &Value) -> bool {
    let state = value
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if state != "open" {
        return false;
    }

    let channel_id = value
        .get("channel_id")
        .and_then(Value::as_str)
        .or_else(|| value.get("channel_a").and_then(Value::as_str))
        .unwrap_or_default();
    if !channel_id.starts_with("channel-") {
        return false;
    }

    let local_port_id = value
        .get("port_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let remote_port_id = value
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    local_port_id == "transfer" || remote_port_id == "transfer"
}

fn resolve_local_hermes_binary(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let configured_candidate = project_root_path.join("relayer/target/release/hermes");
    if configured_candidate.is_file() {
        return Ok(configured_candidate);
    }

    let mut current = Some(injective_dir);
    while let Some(directory) = current {
        let candidate = directory.join("relayer/target/release/hermes");
        if candidate.is_file() {
            return Ok(candidate);
        }
        current = directory.parent();
    }

    Err(format!(
        "Local Hermes binary not found. Expected {}",
        configured_candidate.display()
    )
    .into())
}

fn write_temp_mnemonic_file(
    prefix: &str,
    mnemonic: String,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let file_path = std::env::temp_dir().join(format!(
        "caribic-{}-{}-{}.mnemonic",
        prefix,
        std::process::id(),
        timestamp
    ));
    fs::write(file_path.as_path(), mnemonic)
        .map_err(|error| format!("Failed to write temporary mnemonic file: {}", error))?;
    Ok(file_path)
}

fn ensure_chain_in_hermes_config(
    project_root_path: &Path,
    injective_dir: &Path,
    chain_id: &str,
    inserted_block_comment: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let hermes_dir = home_path.join(".hermes");
    if !hermes_dir.exists() {
        fs::create_dir_all(&hermes_dir)?;
    }

    let destination_config_path = hermes_dir.join("config.toml");
    if !destination_config_path.exists() {
        return Err(format!(
            "Hermes config not found at {}. Run relayer setup first.",
            destination_config_path.display()
        )
        .into());
    }

    let mut destination_config = fs::read_to_string(&destination_config_path).map_err(|error| {
        format!(
            "Failed to read Hermes config at {}: {}",
            destination_config_path.display(),
            error
        )
    })?;

    let source_config_path = resolve_template_config_path(project_root_path, injective_dir)
        .ok_or_else(|| {
            format!(
                "Failed to locate Injective Hermes template config. Checked:\n\
                 - {}/chains/injective/configuration/hermes/config.toml\n\
                 - {}/configuration/hermes/config.toml\n\
                 - {}/scripts/hermes/config.toml",
                project_root_path.display(),
                injective_dir.display(),
                injective_dir.display()
            )
        })?;

    let source_config = fs::read_to_string(&source_config_path).map_err(|error| {
        format!(
            "Failed to read Injective Hermes config at {}: {}",
            source_config_path.display(),
            error
        )
    })?;

    let chain_block = extract_chain_block(&source_config, chain_id).ok_or_else(|| {
        format!(
            "Failed to find chain '{}' block in {}",
            chain_id,
            source_config_path.display()
        )
    })?;

    if let Some(existing_block) = extract_chain_block(&destination_config, chain_id) {
        if existing_block.trim() == chain_block.trim() {
            return Ok(());
        }

        destination_config = replace_chain_block(&destination_config, chain_id, &chain_block)
            .ok_or_else(|| {
                format!(
                    "Failed to update chain '{}' block in {}",
                    chain_id,
                    destination_config_path.display()
                )
            })?;

        fs::write(&destination_config_path, destination_config).map_err(|error| {
            format!(
                "Failed to update Hermes config at {}: {}",
                destination_config_path.display(),
                error
            )
        })?;

        verbose(&format!(
            "Updated '{}' chain block in Hermes config at {}",
            chain_id,
            destination_config_path.display(),
        ));

        return Ok(());
    }

    if !destination_config.ends_with('\n') {
        destination_config.push('\n');
    }
    destination_config.push('\n');
    destination_config.push_str("# ");
    destination_config.push_str(inserted_block_comment);
    destination_config.push('\n');
    destination_config.push_str(&chain_block);
    destination_config.push('\n');

    fs::write(&destination_config_path, destination_config).map_err(|error| {
        format!(
            "Failed to update Hermes config at {}: {}",
            destination_config_path.display(),
            error
        )
    })?;

    verbose(&format!(
        "Added '{}' chain to Hermes config at {}",
        chain_id,
        destination_config_path.display(),
    ));

    Ok(())
}

fn resolve_template_config_path(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Option<std::path::PathBuf> {
    let candidates = [
        project_root_path.join("chains/injective/configuration/hermes/config.toml"),
        injective_dir.join("configuration/hermes/config.toml"),
        injective_dir.join("scripts/hermes/config.toml"),
    ];

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn replace_chain_block(
    config: &str,
    target_chain_id: &str,
    replacement_block: &str,
) -> Option<String> {
    let lines: Vec<&str> = config.lines().collect();
    let (block_start, block_end) = find_chain_block_bounds(&lines, target_chain_id)?;

    let mut updated_lines: Vec<&str> = Vec::with_capacity(
        lines.len() - (block_end - block_start) + replacement_block.lines().count(),
    );
    updated_lines.extend_from_slice(&lines[..block_start]);
    updated_lines.extend(replacement_block.lines());
    updated_lines.extend_from_slice(&lines[block_end..]);

    let mut updated = updated_lines.join("\n");
    if !updated.ends_with('\n') {
        updated.push('\n');
    }

    Some(updated)
}

fn find_chain_block_bounds(lines: &[&str], target_chain_id: &str) -> Option<(usize, usize)> {
    let target_id_single_quote = format!("id = '{}'", target_chain_id);
    let target_id_double_quote = format!("id = \"{}\"", target_chain_id);
    let mut index = 0;

    while index < lines.len() {
        if lines[index].trim() != "[[chains]]" {
            index += 1;
            continue;
        }

        let block_start = index;
        let mut block_end = index + 1;
        while block_end < lines.len() && lines[block_end].trim() != "[[chains]]" {
            block_end += 1;
        }

        let block_lines = &lines[block_start..block_end];
        if block_lines.iter().any(|line| {
            let line = line.trim();
            line == target_id_single_quote || line == target_id_double_quote
        }) {
            return Some((block_start, block_end));
        }

        index = block_end;
    }

    None
}

fn extract_chain_block(config: &str, target_chain_id: &str) -> Option<String> {
    let lines: Vec<&str> = config.lines().collect();
    let (block_start, block_end) = find_chain_block_bounds(&lines, target_chain_id)?;
    Some(lines[block_start..block_end].join("\n"))
}
