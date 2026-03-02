use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use super::config;
use crate::chains::cosmos_node::{
    add_directory_to_process_path, command_exists, locate_binary_in_path_or_go_bin,
    resolve_home_relative_path, start_managed_node, stop_managed_node, CosmosNodeSpec,
};
use crate::logger::{verbose, warn};

pub(super) async fn prepare_local(
    spec: &CosmosNodeSpec,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_injectived_available()?;

    let paths = spec.paths()?;
    if !stateful && paths.home_dir.exists() {
        fs::remove_dir_all(paths.home_dir.as_path())?;
    }

    initialize_local_home(spec, paths.home_dir.as_path())?;
    Ok(())
}

pub(super) async fn start_local(spec: &CosmosNodeSpec) -> Result<(), Box<dyn std::error::Error>> {
    start_managed_node(spec, None, 120, 3000, "Injective local node").await
}

pub(super) fn stop_local(spec: &CosmosNodeSpec) -> Result<(), Box<dyn std::error::Error>> {
    stop_managed_node(spec, "Injective local node")
}

pub(super) async fn prepare_testnet(
    spec: &CosmosNodeSpec,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_injectived_available()?;

    let paths = spec.paths()?;
    if !stateful && paths.home_dir.exists() {
        fs::remove_dir_all(paths.home_dir.as_path())?;
    }

    initialize_testnet_home(spec, paths.home_dir.as_path()).await?;
    Ok(())
}

pub(super) async fn start_testnet(
    spec: &CosmosNodeSpec,
    trust_rpc_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    start_managed_node(
        spec,
        Some(trust_rpc_url),
        180,
        3000,
        "Injective testnet node",
    )
    .await
}

pub(super) fn stop_testnet(spec: &CosmosNodeSpec) -> Result<(), Box<dyn std::error::Error>> {
    stop_managed_node(spec, "Injective testnet node")
}

fn ensure_injectived_available() -> Result<(), Box<dyn std::error::Error>> {
    let mut injectived_location = locate_binary_in_path_or_go_bin("injectived");
    if injectived_location.is_none() {
        let should_continue = prompt_and_install_injectived()?;
        if !should_continue {
            return Err("injectived is required for Injective local/testnet startup".into());
        }
        injectived_location = locate_binary_in_path_or_go_bin("injectived");
    }

    let (injectived_binary, path_visible) = injectived_location.ok_or(
        "injectived is still not available after install step. Install injectived and retry.",
    )?;

    match Command::new(&injectived_binary).arg("version").output() {
        Ok(output) if output.status.success() => {
            let stdout_version = String::from_utf8_lossy(&output.stdout);
            let stderr_version = String::from_utf8_lossy(&output.stderr);
            let version_line = stdout_version
                .lines()
                .next()
                .or_else(|| stderr_version.lines().next())
                .unwrap_or("version unavailable");

            verbose(&format!(
                "PASS: injectived {} ({})",
                version_line,
                injectived_binary.display()
            ));

            if !path_visible {
                if let Some(binary_dir) = injectived_binary.parent() {
                    add_directory_to_process_path(binary_dir);
                }
                warn(&format!(
                    "injectived is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH for direct shell usage.",
                    injectived_binary.display()
                ));
            }
        }
        Ok(output) => {
            return Err(format!(
                "injectived exists at {} but 'injectived version' failed (exit code {})",
                injectived_binary.display(),
                output.status.code().unwrap_or(-1)
            )
            .into());
        }
        Err(error) => {
            return Err(format!(
                "Failed to run injectived at {}: {}",
                injectived_binary.display(),
                error
            )
            .into());
        }
    }

    Ok(())
}

fn prompt_and_install_injectived() -> Result<bool, Box<dyn std::error::Error>> {
    let question = "injectived is missing. Do you want to install it now from source? (yes/no): ";
    print!("{}", question);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();
    if !(input == "yes" || input == "y") {
        return Ok(false);
    }

    install_injectived_from_source()?;
    Ok(true)
}

fn install_injectived_from_source() -> Result<(), Box<dyn std::error::Error>> {
    if !command_exists("go") {
        return Err("`go` is required to install injectived. Run `caribic install` first.".into());
    }
    if !command_exists("git") {
        return Err("`git` is required to install injectived from source.".into());
    }
    if !command_exists("make") {
        return Err("`make` is required to install injectived from source.".into());
    }

    let source_path = injective_source_path()?;
    let parent_path = source_path
        .parent()
        .ok_or("Failed to resolve parent directory for Injective source checkout")?;
    fs::create_dir_all(parent_path)?;

    if source_path.exists() {
        let fetch_status = Command::new("git")
            .current_dir(source_path.as_path())
            .args(["fetch", "--all", "--tags"])
            .status()?;
        if !fetch_status.success() {
            return Err("Failed to refresh Injective source repository".into());
        }

        let reset_status = Command::new("git")
            .current_dir(source_path.as_path())
            .args(["reset", "--hard", "origin/master"])
            .status()?;
        if !reset_status.success() {
            return Err("Failed to reset Injective source repository to origin/master".into());
        }
    } else {
        let clone_status = Command::new("git")
            .args([
                "clone",
                "--depth",
                "1",
                config::SOURCE_REPO_URL,
                source_path
                    .to_str()
                    .ok_or("Invalid injective source path")?,
            ])
            .status()?;
        if !clone_status.success() {
            return Err("Failed to clone Injective source repository".into());
        }
    }

    let make_status = Command::new("make")
        .current_dir(source_path.as_path())
        .arg("install")
        .status()?;

    if !make_status.success() {
        return Err("Failed to build/install injectived via `make install`".into());
    }

    Ok(())
}

fn initialize_local_home(
    spec: &CosmosNodeSpec,
    home_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;
    let home_path_str = home_path
        .to_str()
        .ok_or("Invalid local home directory path")?;

    let init_output = Command::new(spec.binary)
        .args([
            "init",
            spec.moniker,
            "--chain-id",
            spec.chain_id,
            "--home",
            home_path_str,
        ])
        .output()?;
    if !init_output.status.success() {
        return Err(format!(
            "Failed to initialize Injective local home: {}",
            String::from_utf8_lossy(&init_output.stderr).trim()
        )
        .into());
    }

    let add_key_output = Command::new(spec.binary)
        .args([
            "keys",
            "add",
            config::LOCAL_VALIDATOR_KEY,
            "--keyring-backend",
            "test",
            "--home",
            home_path_str,
        ])
        .output()?;
    if !add_key_output.status.success() {
        return Err(format!(
            "Failed to create Injective local validator key: {}",
            String::from_utf8_lossy(&add_key_output.stderr).trim()
        )
        .into());
    }

    let validator_address_output = Command::new(spec.binary)
        .args([
            "keys",
            "show",
            config::LOCAL_VALIDATOR_KEY,
            "-a",
            "--keyring-backend",
            "test",
            "--home",
            home_path_str,
        ])
        .output()?;
    if !validator_address_output.status.success() {
        return Err(format!(
            "Failed to resolve Injective local validator address: {}",
            String::from_utf8_lossy(&validator_address_output.stderr).trim()
        )
        .into());
    }
    let validator_address = String::from_utf8_lossy(&validator_address_output.stdout)
        .trim()
        .to_string();
    if validator_address.is_empty() {
        return Err("Injective local validator address is empty".into());
    }

    let add_genesis_output = Command::new(spec.binary)
        .args([
            "genesis",
            "add-genesis-account",
            validator_address.as_str(),
            config::LOCAL_GENESIS_ACCOUNT_AMOUNT,
            "--chain-id",
            spec.chain_id,
            "--home",
            home_path_str,
        ])
        .output()?;
    if !add_genesis_output.status.success() {
        return Err(format!(
            "Failed to add Injective local genesis account: {}",
            String::from_utf8_lossy(&add_genesis_output.stderr).trim()
        )
        .into());
    }

    let gentx_output = Command::new(spec.binary)
        .args([
            "genesis",
            "gentx",
            config::LOCAL_VALIDATOR_KEY,
            config::LOCAL_GENTX_AMOUNT,
            "--chain-id",
            spec.chain_id,
            "--keyring-backend",
            "test",
            "--home",
            home_path_str,
        ])
        .output()?;
    if !gentx_output.status.success() {
        return Err(format!(
            "Failed to create Injective local gentx: {}",
            String::from_utf8_lossy(&gentx_output.stderr).trim()
        )
        .into());
    }

    let collect_gentxs_output = Command::new(spec.binary)
        .args(["genesis", "collect-gentxs", "--home", home_path_str])
        .output()?;
    if !collect_gentxs_output.status.success() {
        return Err(format!(
            "Failed to collect Injective local gentxs: {}",
            String::from_utf8_lossy(&collect_gentxs_output.stderr).trim()
        )
        .into());
    }

    let validate_genesis_output = Command::new(spec.binary)
        .args(["genesis", "validate", "--home", home_path_str])
        .output()?;
    if !validate_genesis_output.status.success() {
        return Err(format!(
            "Failed to validate Injective local genesis: {}",
            String::from_utf8_lossy(&validate_genesis_output.stderr).trim()
        )
        .into());
    }

    Ok(())
}

async fn initialize_testnet_home(
    spec: &CosmosNodeSpec,
    home_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;

    let output = Command::new(spec.binary)
        .args([
            "init",
            spec.moniker,
            "--chain-id",
            spec.chain_id,
            "--home",
            home_path
                .to_str()
                .ok_or("Invalid testnet home directory path")?,
        ])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to initialize Injective testnet home: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }

    let genesis_response = reqwest::get(config::TESTNET_GENESIS_URL).await?;
    if !genesis_response.status().is_success() {
        return Err(format!(
            "Failed to download Injective testnet genesis from {} (HTTP {})",
            config::TESTNET_GENESIS_URL,
            genesis_response.status()
        )
        .into());
    }

    let genesis_bytes = genesis_response.bytes().await?;
    fs::write(genesis_path.as_path(), genesis_bytes.as_ref())?;
    Ok(())
}

fn injective_source_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::SOURCE_DIR)
}
