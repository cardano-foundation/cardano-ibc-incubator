use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use dirs::home_dir;

use crate::logger::verbose;

pub fn hermes_config_path() -> Option<PathBuf> {
    let home_path = home_dir()?;
    let path = home_path.join(".hermes/config.toml");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

pub fn resolve_local_hermes_binary(project_root_path: &Path, search_root: &Path) -> Option<PathBuf> {
    let configured_candidate = project_root_path.join("relayer/target/release/hermes");
    if configured_candidate.is_file() {
        return Some(configured_candidate);
    }

    let mut current = Some(search_root);
    while let Some(directory) = current {
        let candidate = directory.join("relayer/target/release/hermes");
        if candidate.is_file() {
            return Some(candidate);
        }
        current = directory.parent();
    }

    None
}

pub fn write_temp_mnemonic_file(
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

pub fn ensure_chain_in_hermes_config(
    source_config_path: &Path,
    chain_id: &str,
    inserted_block_comment: &str,
    source_label: &str,
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

    let source_config = fs::read_to_string(source_config_path).map_err(|error| {
        format!(
            "Failed to read {} at {}: {}",
            source_label,
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
