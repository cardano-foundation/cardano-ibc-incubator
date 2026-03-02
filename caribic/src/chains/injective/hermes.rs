use std::fs;
use std::path::Path;

use dirs::home_dir;

use super::config;
use crate::logger::verbose;

/// Ensures Hermes config contains an Injective testnet chain block (`injective-888`).
pub(super) fn ensure_testnet_chain_in_hermes_config(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_chain_in_hermes_config(
        project_root_path,
        injective_dir,
        config::TESTNET_CHAIN_ID,
        "Injective testnet chain used by local state-sync node",
    )
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
