use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use dirs::home_dir;

use super::config;
use crate::logger::verbose;
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
    if hermes_config_path().is_none() {
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
    let destination_config_path = hermes_config_path().ok_or("Hermes config path not found")?;
    let mut destination_config = fs::read_to_string(&destination_config_path).map_err(|error| {
        format!(
            "Failed to read Hermes config at {}: {}",
            destination_config_path.display(),
            error
        )
    })?;

    let source_config_path = project_root_path.join("chains/cheqd/configuration/hermes/config.toml");
    let source_config = fs::read_to_string(&source_config_path).map_err(|error| {
        format!(
            "Failed to read cheqd Hermes config at {}: {}",
            source_config_path.display(),
            error
        )
    })?;

    let chain_block = extract_chain_block(&source_config, config::LOCAL_CHAIN_ID).ok_or_else(|| {
        format!(
            "Failed to find chain '{}' block in {}",
            config::LOCAL_CHAIN_ID,
            source_config_path.display()
        )
    })?;

    if let Some(existing_block) = extract_chain_block(&destination_config, config::LOCAL_CHAIN_ID) {
        if existing_block.trim() == chain_block.trim() {
            return Ok(());
        }

        destination_config = replace_chain_block(&destination_config, config::LOCAL_CHAIN_ID, &chain_block)
            .ok_or_else(|| {
                format!(
                    "Failed to update chain '{}' block in {}",
                    config::LOCAL_CHAIN_ID,
                    destination_config_path.display()
                )
            })?;
    } else {
        if !destination_config.ends_with('\n') {
            destination_config.push('\n');
        }
        destination_config.push('\n');
        destination_config.push_str("# Local cheqd chain managed by caribic\n");
        destination_config.push_str(&chain_block);
        destination_config.push('\n');
    }

    fs::write(&destination_config_path, destination_config)?;
    verbose(&format!(
        "Ensured '{}' chain block exists in Hermes config at {}",
        config::LOCAL_CHAIN_ID,
        destination_config_path.display()
    ));
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
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let configured_candidate = project_root_path.join("relayer/target/release/hermes");
    if configured_candidate.is_file() {
        return Ok(configured_candidate);
    }

    let mut current = Some(cheqd_dir);
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

fn hermes_config_path() -> Option<PathBuf> {
    let home_path = home_dir()?;
    let path = home_path.join(".hermes/config.toml");
    if path.exists() {
        Some(path)
    } else {
        None
    }
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
    fs::write(file_path.as_path(), mnemonic)?;
    Ok(file_path)
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
