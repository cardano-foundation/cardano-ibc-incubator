use std::env;
use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use dirs::home_dir;
use serde_json::Value;

use crate::logger::{verbose, warn};
use crate::utils::wait_for_health_check;

const INJECTIVE_SOURCE_REPO_URL: &str = "https://github.com/InjectiveFoundation/injective-core.git";
const INJECTIVE_SOURCE_DIR: &str = ".caribic/injective/injective-core";

const INJECTIVE_LOCAL_CHAIN_ID: &str = "injective-777";
const INJECTIVE_LOCAL_MONIKER: &str = "caribic-injective-local";
const INJECTIVE_LOCAL_STATUS_URL: &str = "http://127.0.0.1:26660/status";
const INJECTIVE_LOCAL_HOME_DIR: &str = ".injectived-local";
const INJECTIVE_LOCAL_PID_FILE: &str = ".caribic/injective-local.pid";
const INJECTIVE_LOCAL_LOG_FILE: &str = ".caribic/injective-local.log";
const INJECTIVE_LOCAL_VALIDATOR_KEY: &str = "validator";
const INJECTIVE_LOCAL_GENESIS_ACCOUNT_AMOUNT: &str = "100000000000000000000stake";
const INJECTIVE_LOCAL_GENTX_AMOUNT: &str = "50000000000000000000stake";

const INJECTIVE_TESTNET_CHAIN_ID: &str = "injective-888";
const INJECTIVE_TESTNET_MONIKER: &str = "caribic-injective-testnet";
const INJECTIVE_TESTNET_TRUST_RPC_URL: &str = "https://testnet.sentry.tm.injective.network";
const INJECTIVE_TESTNET_STATUS_URL: &str = "http://127.0.0.1:26659/status";
const INJECTIVE_TESTNET_GENESIS_URL: &str =
    "https://raw.githubusercontent.com/InjectiveLabs/testnet/main/testnet-1/genesis.json";
const INJECTIVE_TESTNET_HOME_DIR: &str = ".injectived-testnet";
const INJECTIVE_TESTNET_PID_FILE: &str = ".caribic/injective-testnet.pid";
const INJECTIVE_TESTNET_LOG_FILE: &str = ".caribic/injective-testnet.log";
const INJECTIVE_TESTNET_TRUST_OFFSET: u64 = 1500;
const INJECTIVE_TESTNET_SEEDS: &str =
    "20a548c1ede8f31d13309171f76e0f4624e126b8@seed.testnet.injective.network:26656";
const INJECTIVE_TESTNET_PERSISTENT_PEERS: &str = "3f472746f46493309650e5a033076689996c8881@testnet-seed.injective.network:26656,dacd5d0afce07bd5e43f33b1f5be4ad2f7f9f273@134.209.251.247:26656,8e7a64daa7793f36f68f4cb1ee2f9744a10f94ac@143.198.139.33:26656,e265d636f4f7731207a70f9fcf7b51532aae5820@68.183.176.90:26656,fc86277053c2e045790d44591e8f375f16d991f2@143.198.29.21:26656";

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
            "tcp://0.0.0.0:26660",
            "--grpc.address",
            "0.0.0.0:9097",
            "--api.address",
            "tcp://0.0.0.0:1320",
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
        INJECTIVE_LOCAL_STATUS_URL,
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
        INJECTIVE_LOCAL_STATUS_URL, log_tail
    )
    .into())
}

pub(super) fn stop_local() -> Result<(), Box<dyn std::error::Error>> {
    let local_home_dir = local_home_dir()?;
    let pid_path = local_pid_path()?;

    let pid = read_pid_file(pid_path.as_path()).or_else(|| {
        find_node_pids_for_home(local_home_dir.as_path())
            .into_iter()
            .next()
    });

    if let Some(pid) = pid {
        stop_process(pid)?;
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

    let trust_rpc_url = trust_rpc_url.unwrap_or(INJECTIVE_TESTNET_TRUST_RPC_URL);
    let (rpc_servers, trust_height, trust_hash) = fetch_statesync_params(trust_rpc_url).await?;

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
            "tcp://0.0.0.0:26659",
            "--grpc.address",
            "0.0.0.0:9096",
            "--api.address",
            "tcp://0.0.0.0:1319",
        ])
        .env("INJECTIVED_STATESYNC_ENABLE", "true")
        .env("INJECTIVED_STATESYNC_RPC_SERVERS", rpc_servers)
        .env(
            "INJECTIVED_STATESYNC_TRUST_HEIGHT",
            trust_height.to_string(),
        )
        .env("INJECTIVED_STATESYNC_TRUST_HASH", trust_hash)
        .env("INJECTIVED_P2P_SEEDS", INJECTIVE_TESTNET_SEEDS)
        .env(
            "INJECTIVED_P2P_PERSISTENT_PEERS",
            INJECTIVE_TESTNET_PERSISTENT_PEERS,
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
        INJECTIVE_TESTNET_STATUS_URL,
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
        INJECTIVE_TESTNET_STATUS_URL, log_tail
    )
    .into())
}

pub(super) fn stop_testnet() -> Result<(), Box<dyn std::error::Error>> {
    let testnet_home_dir = testnet_home_dir()?;
    let pid_path = testnet_pid_path()?;

    let pid = read_pid_file(pid_path.as_path()).or_else(|| {
        find_node_pids_for_home(testnet_home_dir.as_path())
            .into_iter()
            .next()
    });

    if let Some(pid) = pid {
        stop_process(pid)?;
    }

    if pid_path.exists() {
        fs::remove_file(pid_path)?;
    }

    Ok(())
}

fn ensure_injectived_available() -> Result<(), Box<dyn std::error::Error>> {
    let mut injectived_location = locate_injectived_binary();
    if injectived_location.is_none() {
        let should_continue = prompt_and_install_injectived()?;
        if !should_continue {
            return Err("injectived is required for Injective local/testnet startup".into());
        }
        injectived_location = locate_injectived_binary();
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
                INJECTIVE_SOURCE_REPO_URL,
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
            INJECTIVE_LOCAL_MONIKER,
            "--chain-id",
            INJECTIVE_LOCAL_CHAIN_ID,
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
            INJECTIVE_LOCAL_VALIDATOR_KEY,
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
            INJECTIVE_LOCAL_VALIDATOR_KEY,
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
            INJECTIVE_LOCAL_GENESIS_ACCOUNT_AMOUNT,
            "--chain-id",
            INJECTIVE_LOCAL_CHAIN_ID,
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
            INJECTIVE_LOCAL_VALIDATOR_KEY,
            INJECTIVE_LOCAL_GENTX_AMOUNT,
            "--chain-id",
            INJECTIVE_LOCAL_CHAIN_ID,
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

async fn initialize_testnet_home(home_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;

    let output = Command::new("injectived")
        .args([
            "init",
            INJECTIVE_TESTNET_MONIKER,
            "--chain-id",
            INJECTIVE_TESTNET_CHAIN_ID,
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

    let genesis_response = reqwest::get(INJECTIVE_TESTNET_GENESIS_URL).await?;
    if !genesis_response.status().is_success() {
        return Err(format!(
            "Failed to download Injective testnet genesis from {} (HTTP {})",
            INJECTIVE_TESTNET_GENESIS_URL,
            genesis_response.status()
        )
        .into());
    }

    let genesis_bytes = genesis_response.bytes().await?;
    fs::write(genesis_path.as_path(), genesis_bytes.as_ref())?;
    Ok(())
}

async fn fetch_statesync_params(
    trust_rpc_url: &str,
) -> Result<(String, u64, String), Box<dyn std::error::Error>> {
    let trust_rpc_base_url = normalize_trust_rpc_url(trust_rpc_url)?;
    let status_url = trust_rpc_base_url.join("status")?;

    let status_response = reqwest::get(status_url.as_str()).await?;
    if !status_response.status().is_success() {
        return Err(format!(
            "Failed to fetch status from trusted Injective RPC {} (HTTP {})",
            status_url,
            status_response.status()
        )
        .into());
    }

    let status_payload: Value = status_response.json().await?;
    let latest_height = status_payload["result"]["sync_info"]["latest_block_height"]
        .as_str()
        .and_then(|height| height.parse::<u64>().ok())
        .ok_or("Unable to parse latest_block_height from trusted Injective RPC status response")?;

    if latest_height <= INJECTIVE_TESTNET_TRUST_OFFSET {
        return Err(format!(
            "Latest Injective testnet height {} is too low to compute trust height with offset {}",
            latest_height, INJECTIVE_TESTNET_TRUST_OFFSET
        )
        .into());
    }

    let trust_height = latest_height - INJECTIVE_TESTNET_TRUST_OFFSET;
    let block_url = trust_rpc_base_url.join(format!("block?height={}", trust_height).as_str())?;

    let block_response = reqwest::get(block_url.as_str()).await?;
    if !block_response.status().is_success() {
        return Err(format!(
            "Failed to fetch trusted block at height {} from {} (HTTP {})",
            trust_height,
            block_url,
            block_response.status()
        )
        .into());
    }

    let block_payload: Value = block_response.json().await?;
    let trust_hash = block_payload["result"]["block_id"]["hash"]
        .as_str()
        .ok_or("Unable to parse trusted block hash from Injective RPC block response")?
        .to_string();

    let rpc_server = format_rpc_server_address(&trust_rpc_base_url)?;
    let rpc_servers = format!("{},{}", rpc_server, rpc_server);

    Ok((rpc_servers, trust_height, trust_hash))
}

fn normalize_trust_rpc_url(raw_url: &str) -> Result<reqwest::Url, Box<dyn std::error::Error>> {
    let normalized = raw_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/status")
        .to_string();

    if normalized.is_empty() {
        return Err("Trusted RPC URL cannot be empty".into());
    }

    let parsed = reqwest::Url::parse(normalized.as_str())?;
    if parsed.host_str().is_none() {
        return Err(format!("Trusted RPC URL must include a host: {}", normalized).into());
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err(format!(
            "Trusted RPC URL must be a base RPC URL without extra path segments: {}",
            normalized
        )
        .into());
    }

    Ok(parsed)
}

fn format_rpc_server_address(url: &reqwest::Url) -> Result<String, Box<dyn std::error::Error>> {
    let host = url
        .host_str()
        .ok_or("Trusted RPC URL is missing a host name")?;
    let port = url
        .port_or_known_default()
        .ok_or("Trusted RPC URL is missing a known port")?;
    Ok(format!("{}://{}:{}", url.scheme(), host, port))
}

fn locate_injectived_binary() -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join("injectived");
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    home_dir().and_then(|home| {
        let candidate = home.join("go/bin/injectived");
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}

fn add_directory_to_process_path(directory: &Path) {
    let current_path = env::var_os("PATH").unwrap_or_default();
    let mut path_entries: Vec<PathBuf> = env::split_paths(&current_path).collect();
    if path_entries.iter().any(|entry| entry == directory) {
        return;
    }

    path_entries.insert(0, directory.to_path_buf());
    if let Ok(updated_path) = env::join_paths(path_entries) {
        env::set_var("PATH", updated_path);
    }
}

fn injective_source_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_SOURCE_DIR))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn command_exists(binary: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path_var).any(|directory| directory.join(binary).is_file())
}

fn local_home_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_LOCAL_HOME_DIR))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn local_pid_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_LOCAL_PID_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn local_log_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_LOCAL_LOG_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn testnet_home_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_TESTNET_HOME_DIR))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn testnet_pid_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_TESTNET_PID_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn testnet_log_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(INJECTIVE_TESTNET_LOG_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn read_pid_file(pid_file_path: &Path) -> Option<u32> {
    fs::read_to_string(pid_file_path)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
}

fn stop_process(pid: u32) -> Result<(), Box<dyn std::error::Error>> {
    if !is_process_alive(pid) {
        return Ok(());
    }

    let terminate_status = Command::new("kill")
        .args(["-TERM", pid.to_string().as_str()])
        .status()?;
    if !terminate_status.success() {
        return Err(format!("Failed to send SIGTERM to Injective testnet pid {}", pid).into());
    }

    for _ in 0..15 {
        if !is_process_alive(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }

    let kill_status = Command::new("kill")
        .args(["-KILL", pid.to_string().as_str()])
        .status()?;
    if !kill_status.success() {
        return Err(format!("Failed to send SIGKILL to Injective testnet pid {}", pid).into());
    }

    for _ in 0..10 {
        if !is_process_alive(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "Injective testnet pid {} is still running after stop attempt",
        pid
    )
    .into())
}

fn is_process_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", pid.to_string().as_str()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some_and(|status| status.success())
}

fn find_node_pids_for_home(node_home_path: &Path) -> Vec<u32> {
    let expected_home = node_home_path.to_string_lossy();

    let output = Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output();

    match output {
        Ok(raw_output) if raw_output.status.success() => {
            String::from_utf8_lossy(&raw_output.stdout)
                .lines()
                .filter_map(parse_pid_and_command)
                .filter_map(|(pid, command)| {
                    if command.contains("injectived")
                        && command.contains("start")
                        && command.contains("--home")
                        && command.contains(expected_home.as_ref())
                    {
                        Some(pid)
                    } else {
                        None
                    }
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

fn parse_pid_and_command(line: &str) -> Option<(u32, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let pid = parts.next()?.trim().parse::<u32>().ok()?;
    let command = parts.next()?.trim().to_string();
    Some((pid, command))
}

fn read_log_tail(log_path: &Path, max_lines: usize) -> Result<String, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(log_path)?;
    let mut lines: Vec<&str> = content.lines().rev().take(max_lines).collect();
    lines.reverse();
    Ok(lines.join("\n"))
}
