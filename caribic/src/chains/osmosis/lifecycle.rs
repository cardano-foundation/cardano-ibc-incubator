use std::env;
use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use console::style;
use dirs::home_dir;
use fs_extra::{copy_items, file::copy};
use indicatif::{ProgressBar, ProgressStyle};
use serde_json::Value;

use crate::logger::{self, log, log_or_show_progress, verbose, warn};
use crate::setup::download_repository;
use crate::utils::{execute_script, execute_script_interactive, wait_for_health_check};

const OSMOSIS_SOURCE_ZIP_URL: &str =
    "https://github.com/osmosis-labs/osmosis/archive/refs/tags/v30.0.1.zip";
const OSMOSIS_LOCAL_STATUS_URL: &str = "http://127.0.0.1:26658/status";
const OSMOSIS_TESTNET_RPC_URL: &str = "https://rpc.osmotest5.osmosis.zone";
const OSMOSIS_TESTNET_STATUS_URL: &str = "http://127.0.0.1:26658/status";
const OSMOSIS_TESTNET_CHAIN_ID: &str = "osmo-test-5";
const OSMOSIS_TESTNET_MONIKER: &str = "caribic-osmosis-testnet";
const OSMOSIS_TESTNET_HOME_DIR: &str = ".osmosisd-testnet";
const OSMOSIS_TESTNET_PID_FILE: &str = ".caribic/osmosis-testnet.pid";
const OSMOSIS_TESTNET_LOG_FILE: &str = ".caribic/osmosis-testnet.log";
const OSMOSIS_TESTNET_TRUST_OFFSET: u64 = 1500;
const OSMOSIS_TESTNET_SEEDS: &str = "bb197876fd952d245ef6377e3651c157e3d7ed81@157.245.26.231:26656,7c2b9e76be5c2142c76b429d9c29e902599ceb44@157.245.21.183:26656";
const OSMOSIS_TESTNET_PERSISTENT_PEERS: &str = "51084fccec1c309a415e89d39e6f0881c49493ed@95.217.144.107:12556,a5c34bdd777dd418ff7152a8646fd2f31f53f8a5@46.232.248.117:2000";

pub(super) async fn prepare_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    ensure_osmosisd_available(osmosis_dir).await?;
    copy_local_config_files(osmosis_dir)?;
    verbose("PASS: Osmosis configuration files copied successfully");
    init_local_network(osmosis_dir)?;
    Ok(())
}

pub(super) async fn start_local(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let optional_progress_bar = match logger::get_verbosity() {
        logger::Verbosity::Verbose => None,
        _ => Some(ProgressBar::new_spinner()),
    };

    if let Some(progress_bar) = &optional_progress_bar {
        progress_bar.set_style(ProgressStyle::with_template("{prefix:.bold} {wide_msg}").unwrap());
        progress_bar.set_prefix("Starting Osmosis appchain ...".to_owned());
    } else {
        log("Starting Osmosis appchain ...");
    }

    let status = execute_script(
        osmosis_dir,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "tests/localosmosis/docker-compose.yml",
            "up",
            "-d",
        ]),
        Some(Vec::from([(
            "OSMOSISD_CONTAINER_NAME",
            "localosmosis-osmosisd-1",
        )])),
    );

    if status.is_ok() {
        log_or_show_progress(
            "Waiting for the Osmosis appchain to become healthy ...",
            &optional_progress_bar,
        );

        let osmosis_status_url = OSMOSIS_LOCAL_STATUS_URL;
        let is_healthy = wait_for_health_check(
            osmosis_status_url,
            30,
            3000,
            Some(|response_body: &String| {
                let json: Value = serde_json::from_str(&response_body).unwrap_or_default();

                if let Some(height) = json["result"]["sync_info"]["latest_block_height"]
                    .as_str()
                    .and_then(|h| h.parse::<u64>().ok())
                {
                    verbose(&format!("Current block height: {}", height));
                    return height > 0;
                }

                verbose(&format!(
                    "Failed to get the current block height from the response {}",
                    response_body,
                ));

                false
            }),
        )
        .await;

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }
        if is_healthy.is_ok() {
            Ok(())
        } else {
            Err(format!("Run into timeout while checking {}", osmosis_status_url).into())
        }
    } else {
        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        Err(status.unwrap_err().into())
    }
}

pub(super) fn stop_local(osmosis_path: &Path) {
    let _ = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
}

pub(super) async fn prepare_testnet(
    osmosis_dir: &Path,
    stateful: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    ensure_osmosisd_available(osmosis_dir).await?;

    let testnet_home_dir = testnet_home_dir()?;
    if !stateful && testnet_home_dir.exists() {
        fs::remove_dir_all(testnet_home_dir.as_path())?;
    }

    initialize_testnet_home(testnet_home_dir.as_path())?;
    Ok(())
}

pub(super) async fn start_testnet(
    _osmosis_dir: &Path,
    trust_rpc_url: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let testnet_home_dir = testnet_home_dir()?;
    let pid_path = testnet_pid_path()?;
    let log_path = testnet_log_path()?;

    if let Some(existing_pid) = read_pid_file(pid_path.as_path()) {
        if is_process_alive(existing_pid) {
            return Err(format!(
                "Osmosis testnet node is already running (pid {})",
                existing_pid
            )
            .into());
        }
    }

    let trust_rpc_url = trust_rpc_url.unwrap_or(OSMOSIS_TESTNET_RPC_URL);
    let (rpc_servers, trust_height, trust_hash) = fetch_statesync_params(trust_rpc_url).await?;

    if let Some(parent) = pid_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let stdout_file = File::create(log_path.as_path())?;
    let stderr_file = stdout_file.try_clone()?;

    let child = Command::new("osmosisd")
        .args([
            "start",
            "--home",
            testnet_home_dir
                .to_str()
                .ok_or("Invalid testnet home directory path")?,
            "--rpc.laddr",
            "tcp://0.0.0.0:26658",
            "--grpc.address",
            "0.0.0.0:9094",
            "--grpc-web.address",
            "0.0.0.0:9091",
            "--api.address",
            "tcp://0.0.0.0:1318",
        ])
        .env("OSMOSISD_STATESYNC_ENABLE", "true")
        .env("OSMOSISD_STATESYNC_RPC_SERVERS", rpc_servers)
        .env("OSMOSISD_STATESYNC_TRUST_HEIGHT", trust_height.to_string())
        .env("OSMOSISD_STATESYNC_TRUST_HASH", trust_hash)
        .env("OSMOSISD_P2P_SEEDS", OSMOSIS_TESTNET_SEEDS)
        .env(
            "OSMOSISD_P2P_PERSISTENT_PEERS",
            OSMOSIS_TESTNET_PERSISTENT_PEERS,
        )
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()?;

    fs::write(pid_path.as_path(), child.id().to_string())?;

    let is_healthy = wait_for_health_check(
        OSMOSIS_TESTNET_STATUS_URL,
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

    let _ = stop_testnet();
    let log_tail = read_log_tail(log_path.as_path(), 120)
        .unwrap_or_else(|_| "Unable to read Osmosis testnet log file".to_string());
    Err(format!(
        "Timed out while waiting for local Osmosis testnet node at {}.\n{}",
        OSMOSIS_TESTNET_STATUS_URL, log_tail
    )
    .into())
}

pub(super) fn stop_testnet() -> Result<(), Box<dyn std::error::Error>> {
    let testnet_home_dir = testnet_home_dir()?;
    let pid_path = testnet_pid_path()?;

    let pid = read_pid_file(pid_path.as_path()).or_else(|| {
        find_testnet_node_pids(testnet_home_dir.as_path())
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

async fn ensure_osmosisd_available(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if osmosis_dir.exists() {
        verbose("Osmosis directory already exists");
    } else {
        download_osmosis_source(osmosis_dir).await?;
    }

    let mut binary = locate_osmosisd_binary();
    if binary.is_none() {
        log("ERROR: osmosisd is not installed or not available in the PATH.");

        let should_continue = prompt_and_install_osmosisd(osmosis_dir).await?;
        if !should_continue {
            return Err("osmosisd is required for local Osmosis startup".into());
        }

        binary = locate_osmosisd_binary();
    }

    let (osmosisd_binary, path_visible) =
        binary.ok_or("osmosisd is still not available after install step")?;

    match Command::new(&osmosisd_binary).arg("version").output() {
        Ok(output) if output.status.success() => {
            let stdout_version = String::from_utf8_lossy(&output.stdout);
            let stderr_version = String::from_utf8_lossy(&output.stderr);
            let version_line = stdout_version
                .lines()
                .next()
                .or_else(|| stderr_version.lines().next())
                .unwrap_or("version unavailable");

            verbose(&format!(
                "PASS: osmosisd {} ({})",
                version_line,
                osmosisd_binary.display()
            ));

            if !path_visible {
                warn(&format!(
                    "osmosisd is installed at {} but not visible in PATH. Add '$HOME/go/bin' to PATH for direct shell usage.",
                    osmosisd_binary.display()
                ));
            }
        }
        Ok(output) => {
            return Err(format!(
                "osmosisd exists at {} but 'osmosisd version' failed (exit code {})",
                osmosisd_binary.display(),
                output.status.code().unwrap_or(-1)
            )
            .into());
        }
        Err(error) => {
            return Err(format!(
                "Failed to run osmosisd at {}: {}",
                osmosisd_binary.display(),
                error
            )
            .into());
        }
    }

    Ok(())
}

async fn download_osmosis_source(osmosis_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    download_repository(OSMOSIS_SOURCE_ZIP_URL, osmosis_path, "osmosis").await
}

async fn prompt_and_install_osmosisd(
    osmosis_path: &Path,
) -> Result<bool, Box<dyn std::error::Error>> {
    let question = "Do you want to install osmosisd? (yes/no): ";
    print!("{}", question);
    io::stdout().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let input = input.trim().to_lowercase();

    if input == "yes" || input == "y" {
        println!("{} Installing osmosisd...", style("Step 1/1").bold().dim());

        let output = Command::new("make")
            .current_dir(osmosis_path)
            .arg("install")
            .output()
            .map_err(|error| format!("Failed to run make install for osmosisd: {}", error))?;

        if !output.status.success() {
            return Err(format!(
                "Failed to install osmosisd:\n{}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }

        println!("PASS: osmosisd installed successfully");
        Ok(true)
    } else {
        Ok(false)
    }
}

fn locate_osmosisd_binary() -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join("osmosisd");
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    home_dir().and_then(|home| {
        let candidate = home.join("go/bin/osmosisd");
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}

fn testnet_home_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(OSMOSIS_TESTNET_HOME_DIR))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn testnet_pid_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(OSMOSIS_TESTNET_PID_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn testnet_log_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(OSMOSIS_TESTNET_LOG_FILE))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

fn initialize_testnet_home(home_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let config_toml_path = home_path.join("config/config.toml");
    let genesis_path = home_path.join("config/genesis.json");
    if config_toml_path.exists() && genesis_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(home_path)?;

    let output = Command::new("osmosisd")
        .args([
            "init",
            OSMOSIS_TESTNET_MONIKER,
            "--chain-id",
            OSMOSIS_TESTNET_CHAIN_ID,
            "--home",
            home_path
                .to_str()
                .ok_or("Invalid testnet home directory path")?,
        ])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to initialize Osmosis testnet home: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }

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
            "Failed to fetch status from trusted Osmosis RPC {} (HTTP {})",
            status_url,
            status_response.status()
        )
        .into());
    }

    let status_payload: Value = status_response.json().await?;
    let latest_height = status_payload["result"]["sync_info"]["latest_block_height"]
        .as_str()
        .and_then(|height| height.parse::<u64>().ok())
        .ok_or("Unable to parse latest_block_height from trusted Osmosis RPC status response")?;

    if latest_height <= OSMOSIS_TESTNET_TRUST_OFFSET {
        return Err(format!(
            "Latest testnet height {} is too low to compute trust height with offset {}",
            latest_height, OSMOSIS_TESTNET_TRUST_OFFSET
        )
        .into());
    }

    let trust_height = latest_height - OSMOSIS_TESTNET_TRUST_OFFSET;
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
        .ok_or("Unable to parse trusted block hash from Osmosis RPC block response")?
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
        return Err(format!("Failed to send SIGTERM to Osmosis testnet pid {}", pid).into());
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
        return Err(format!("Failed to send SIGKILL to Osmosis testnet pid {}", pid).into());
    }

    for _ in 0..10 {
        if !is_process_alive(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "Osmosis testnet pid {} is still running after stop attempt",
        pid
    )
    .into())
}

fn is_process_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", pid.to_string().as_str()])
        .status()
        .ok()
        .is_some_and(|status| status.success())
}

fn find_testnet_node_pids(testnet_home_path: &Path) -> Vec<u32> {
    let expected_home = testnet_home_path.to_string_lossy();

    let output = Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output();

    match output {
        Ok(raw_output) if raw_output.status.success() => {
            String::from_utf8_lossy(&raw_output.stdout)
                .lines()
                .filter_map(parse_pid_and_command)
                .filter_map(|(pid, command)| {
                    if command.contains("osmosisd")
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

fn init_local_network(osmosis_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !logger::is_quite() {
        log("Initialize local Osmosis network ...");
    }

    execute_script_interactive(osmosis_dir, "make", Vec::from(["localnet-init"]))?;
    Ok(())
}

fn copy_local_config_files(osmosis_dir: &Path) -> Result<(), fs_extra::error::Error> {
    verbose(&format!(
        "Copying cosmwasm files from {} to {}",
        osmosis_dir.join("../configuration/cosmwasm/wasm").display(),
        osmosis_dir.join("cosmwasm").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/cosmwasm/wasm")],
        osmosis_dir.join("cosmwasm"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    verbose(&format!(
        "Copying hermes files from {} to {}",
        osmosis_dir.join("../configuration/hermes").display(),
        osmosis_dir.join("scripts").display()
    ));
    copy_items(
        &vec![osmosis_dir.join("../configuration/hermes")],
        osmosis_dir.join("scripts"),
        &fs_extra::dir::CopyOptions::new().overwrite(true),
    )?;

    let options = fs_extra::file::CopyOptions::new().overwrite(true);

    verbose(&format!(
        "Copying setup_crosschain_swaps.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_crosschain_swaps.sh")
            .display(),
        osmosis_dir
            .join("scripts/setup_crosschain_swaps.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_crosschain_swaps.sh"),
        osmosis_dir.join("scripts/setup_crosschain_swaps.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying localnet.mk from {} to {}",
        osmosis_dir.join("../scripts/localnet.mk").display(),
        osmosis_dir.join("scripts/makefiles/localnet.mk").display()
    ));
    copy(
        osmosis_dir.join("../scripts/localnet.mk"),
        osmosis_dir.join("scripts/makefiles/localnet.mk"),
        &options,
    )?;

    verbose(&format!(
        "Copying setup_osmosis_local.sh from {} to {}",
        osmosis_dir
            .join("../scripts/setup_osmosis_local.sh")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/scripts/setup.sh")
            .display()
    ));
    copy(
        osmosis_dir.join("../scripts/setup_osmosis_local.sh"),
        osmosis_dir.join("tests/localosmosis/scripts/setup.sh"),
        &options,
    )?;

    verbose(&format!(
        "Copying docker-compose.yml from {} to {}",
        osmosis_dir
            .join("../configuration/docker-compose.yml")
            .display(),
        osmosis_dir
            .join("tests/localosmosis/docker-compose.yml")
            .display()
    ));
    copy(
        osmosis_dir.join("../configuration/docker-compose.yml"),
        osmosis_dir.join("tests/localosmosis/docker-compose.yml"),
        &options,
    )?;

    verbose(&format!(
        "Copying Dockerfile from {} to {}",
        osmosis_dir.join("../configuration/Dockerfile").display(),
        osmosis_dir.join("Dockerfile").display()
    ));
    copy(
        osmosis_dir.join("../configuration/Dockerfile"),
        osmosis_dir.join("Dockerfile"),
        &options,
    )?;

    Ok(())
}
