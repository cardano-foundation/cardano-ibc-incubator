use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use dirs::home_dir;
use serde_json::Value;

use super::config;
use crate::chains::cosmos_node::{
    add_directory_to_process_path, command_exists, fetch_statesync_params, find_node_pids_for_home,
    is_process_alive, locate_binary_in_path_or_go_bin, read_log_tail, read_pid_file, stop_process,
};
use crate::logger::{verbose, warn};
use crate::utils::wait_for_health_check;

pub(super) async fn prepare_local(stateful: bool) -> Result<(), Box<dyn std::error::Error>> {
    ensure_injectived_available()?;

    let local_home_dir = local_home_dir()?;
    if !stateful && local_home_dir.exists() {
        fs::remove_dir_all(local_home_dir.as_path())?;
    }

    initialize_local_home(local_home_dir.as_path())?;
    Ok(())
}

pub(super) async fn start_local() -> Result<(), Box<dyn std::error::Error>> {
    let local_home_dir = local_home_dir()?;
    let pid_path = local_pid_path()?;
    let log_path = local_log_path()?;

    if let Some(existing_pid) = read_pid_file(pid_path.as_path()) {
        if is_process_alive(existing_pid) {
            return Err(format!(
                "Injective local node is already running (pid {})",
                existing_pid
            )
            .into());
        }
    }

    if let Some(parent) = pid_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let stdout_file = File::create(log_path.as_path())?;
    let stderr_file = stdout_file.try_clone()?;

    let child = Command::new("injectived")
        .args([
            "start",
            "--home",
            local_home_dir
                .to_str()
                .ok_or("Invalid local home directory path")?,
            "--rpc.laddr",
            config::LOCAL_RPC_LADDR,
            "--grpc.address",
            config::LOCAL_GRPC_ADDRESS,
            "--api.address",
            config::LOCAL_API_ADDRESS,
        ])
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()?;

    fs::write(pid_path.as_path(), child.id().to_string())?;
    thread::sleep(Duration::from_millis(500));
    if !is_process_alive(child.id()) {
        let log_tail = read_log_tail(log_path.as_path(), 120)
            .unwrap_or_else(|_| "Unable to read Injective local log file".to_string());
        return Err(format!("Injective local node exited early.\n{}", log_tail).into());
    }

    let is_healthy = wait_for_health_check(
        config::LOCAL_STATUS_URL,
        120,
        3000,
        Some(|response_body: &String| {
            let json: Value = serde_json::from_str(response_body).unwrap_or_default();
            json["result"]["sync_info"]["latest_block_height"]
                .as_str()
                .and_then(|height| height.parse::<u64>().ok())
                .is_some_and(|height| height > 0)
        }),
    )
    .await;

    if is_healthy.is_ok() {
        return Ok(());
    }

    let _ = stop_local();
    let log_tail = read_log_tail(log_path.as_path(), 120)
        .unwrap_or_else(|_| "Unable to read Injective local log file".to_string());
    Err(format!(
        "Timed out while waiting for local Injective node at {}.\n{}",
        config::LOCAL_STATUS_URL,
        log_tail
    )
    .into())
}

pub(super) fn stop_local() -> Result<(), Box<dyn std::error::Error>> {
    let local_home_dir = local_home_dir()?;
    let pid_path = local_pid_path()?;

    let pid = read_pid_file(pid_path.as_path()).or_else(|| {
        find_node_pids_for_home("injectived", local_home_dir.as_path())
            .into_iter()
            .next()
    });

    if let Some(pid) = pid {
        stop_process(pid, "Injective local")?;
    }

    if pid_path.exists() {
        fs::remove_file(pid_path)?;
    }

    Ok(())
}

pub(super) async fn prepare_testnet(stateful: bool) -> Result<(), Box<dyn std::error::Error>> {
    ensure_injectived_available()?;

    let testnet_home_dir = testnet_home_dir()?;
    if !stateful && testnet_home_dir.exists() {
        fs::remove_dir_all(testnet_home_dir.as_path())?;
    }

    initialize_testnet_home(testnet_home_dir.as_path()).await?;
    Ok(())
}

pub(super) async fn start_testnet(
    trust_rpc_url: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let testnet_home_dir = testnet_home_dir()?;
    let pid_path = testnet_pid_path()?;
    let log_path = testnet_log_path()?;

    if let Some(existing_pid) = read_pid_file(pid_path.as_path()) {
        if is_process_alive(existing_pid) {
            return Err(format!(
                "Injective testnet node is already running (pid {})",
                existing_pid
            )
            .into());
        }
    }

    let trust_rpc_url = trust_rpc_url.unwrap_or(config::TESTNET_TRUST_RPC_URL);
    let (rpc_servers, trust_height, trust_hash) = fetch_statesync_params(
        trust_rpc_url,
        config::TESTNET_TRUST_OFFSET,
        "Injective",
    )
    .await?;

    if let Some(parent) = pid_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let stdout_file = File::create(log_path.as_path())?;
    let stderr_file = stdout_file.try_clone()?;

    let child = Command::new("injectived")
        .args([
            "start",
            "--home",
            testnet_home_dir
                .to_str()
                .ok_or("Invalid testnet home directory path")?,
            "--rpc.laddr",
            config::TESTNET_RPC_LADDR,
            "--grpc.address",
            config::TESTNET_GRPC_ADDRESS,
            "--api.address",
            config::TESTNET_API_ADDRESS,
        ])
        .env("INJECTIVED_STATESYNC_ENABLE", "true")
        .env("INJECTIVED_STATESYNC_RPC_SERVERS", rpc_servers)
        .env(
            "INJECTIVED_STATESYNC_TRUST_HEIGHT",
            trust_height.to_string(),
        )
        .env("INJECTIVED_STATESYNC_TRUST_HASH", trust_hash)
        .env("INJECTIVED_P2P_SEEDS", config::TESTNET_SEEDS)
        .env(
            "INJECTIVED_P2P_PERSISTENT_PEERS",
            config::TESTNET_PERSISTENT_PEERS,
        )
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()?;

    fs::write(pid_path.as_path(), child.id().to_string())?;
    thread::sleep(Duration::from_millis(500));
    if !is_process_alive(child.id()) {
        let log_tail = read_log_tail(log_path.as_path(), 120)
            .unwrap_or_else(|_| "Unable to read Injective testnet log file".to_string());
        return Err(format!("Injective testnet node exited early.\n{}", log_tail).into());
    }

    let is_healthy = wait_for_health_check(
        config::TESTNET_STATUS_URL,
        180,
        3000,
        Some(|response_body: &String| {
            let json: Value = serde_json::from_str(response_body).unwrap_or_default();
            json["result"]["sync_info"]["latest_block_height"]
                .as_str()
                .and_then(|height| height.parse::<u64>().ok())
                .is_some_and(|height| height > 0)
        }),
    )
    .await;

    if is_healthy.is_ok() {
        return Ok(());
    }

    let _ = stop_testnet();
    let log_tail = read_log_tail(log_path.as_path(), 120)
        .unwrap_or_else(|_| "Unable to read Injective testnet log file".to_string());
    Err(format!(
        "Timed out while waiting for local Injective testnet node at {}.\n{}",
        config::TESTNET_STATUS_URL,
        log_tail
    )
    .into())
}

pub(super) fn stop_testnet() -> Result<(), Box<dyn std::error::Error>> {
    let testnet_home_dir = testnet_home_dir()?;
    let pid_path = testnet_pid_path()?;

    let pid = read_pid_file(pid_path.as_path()).or_else(|| {
        find_node_pids_for_home("injectived", testnet_home_dir.as_path())
            .into_iter()
            .next()
    });

    if let Some(pid) = pid {
        stop_process(pid, "Injective testnet")?;
    }

    if pid_path.exists() {
        fs::remove_file(pid_path)?;
    }

    Ok(())
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

fn initialize_local_home(home_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;
    let home_path_str = home_path
        .to_str()
        .ok_or("Invalid local home directory path")?;

    let init_output = Command::new("injectived")
        .args([
            "init",
            config::LOCAL_MONIKER,
            "--chain-id",
            config::LOCAL_CHAIN_ID,
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

    let add_key_output = Command::new("injectived")
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

    let validator_address_output = Command::new("injectived")
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

    let add_genesis_output = Command::new("injectived")
        .args([
            "genesis",
            "add-genesis-account",
            validator_address.as_str(),
            config::LOCAL_GENESIS_ACCOUNT_AMOUNT,
            "--chain-id",
            config::LOCAL_CHAIN_ID,
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

    let gentx_output = Command::new("injectived")
        .args([
            "genesis",
            "gentx",
            config::LOCAL_VALIDATOR_KEY,
            config::LOCAL_GENTX_AMOUNT,
            "--chain-id",
            config::LOCAL_CHAIN_ID,
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

    let collect_gentxs_output = Command::new("injectived")
        .args(["genesis", "collect-gentxs", "--home", home_path_str])
        .output()?;
    if !collect_gentxs_output.status.success() {
        return Err(format!(
            "Failed to collect Injective local gentxs: {}",
            String::from_utf8_lossy(&collect_gentxs_output.stderr).trim()
        )
        .into());
    }

    let validate_genesis_output = Command::new("injectived")
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
    home_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;

    let output = Command::new("injectived")
        .args([
            "init",
            config::TESTNET_MONIKER,
            "--chain-id",
            config::TESTNET_CHAIN_ID,
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

fn local_home_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::LOCAL_HOME_DIR)
}

fn local_pid_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::LOCAL_PID_FILE)
}

fn local_log_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::LOCAL_LOG_FILE)
}

fn testnet_home_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::TESTNET_HOME_DIR)
}

fn testnet_pid_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::TESTNET_PID_FILE)
}

fn testnet_log_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    resolve_home_relative_path(config::TESTNET_LOG_FILE)
}

fn resolve_home_relative_path(relative_path: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(relative_path))
        .ok_or_else(|| "Unable to resolve home directory".into())
}
