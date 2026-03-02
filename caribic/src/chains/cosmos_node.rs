//! Shared runtime utilities for Cosmos-style chain adapters.
//!
//! This module centralizes operational helpers that are reused across
//! multiple Cosmos chains (currently Osmosis and Injective), so chain
//! implementations can keep only chain-specific logic in their own modules.

use std::env;
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use dirs::home_dir;
use serde_json::Value;

use crate::chains::{check_port_health, check_rpc_health, ChainFlags, ChainHealthStatus};
use crate::utils::wait_for_health_check;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CosmosNetworkKind {
    Local,
    Testnet,
    Mainnet,
}

impl CosmosNetworkKind {
    pub(crate) fn parse(raw_network: &str) -> Result<Self, String> {
        match raw_network {
            "local" => Ok(Self::Local),
            "testnet" => Ok(Self::Testnet),
            "mainnet" => Ok(Self::Mainnet),
            _ => Err(format!(
                "Unsupported Cosmos network '{}'. Expected one of: local, testnet, mainnet",
                raw_network
            )),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct CosmosChainOptions {
    pub stateful: Option<bool>,
    pub trust_rpc_url: Option<String>,
}

impl CosmosChainOptions {
    pub(crate) fn from_flags(flags: &ChainFlags) -> Result<Self, String> {
        let mut options = Self::default();
        for (flag_name, raw_value) in flags {
            match flag_name.as_str() {
                "stateful" => {
                    options.stateful = Some(parse_bool_option(raw_value, "stateful")?);
                }
                "trust-rpc-url" => {
                    options.trust_rpc_url = Some(raw_value.clone());
                }
                _ => {
                    return Err(format!(
                        "Unsupported Cosmos flag '{}'. Allowed options: stateful, trust-rpc-url",
                        flag_name
                    ));
                }
            }
        }
        Ok(options)
    }

    pub(crate) fn stateful_or(&self, default_value: bool) -> bool {
        self.stateful.unwrap_or(default_value)
    }

    pub(crate) fn trust_rpc_url<'a>(&'a self, default_value: &'a str) -> &'a str {
        self.trust_rpc_url.as_deref().unwrap_or(default_value)
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct CosmosStateSyncSpec {
    pub default_trust_rpc_url: &'static str,
    pub trust_offset: u64,
    pub seeds: &'static str,
    pub persistent_peers: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct CosmosNodeSpec {
    pub chain_name: &'static str,
    pub binary: &'static str,
    pub chain_id: &'static str,
    pub moniker: &'static str,
    pub status_url: &'static str,
    pub rpc_laddr: &'static str,
    pub grpc_address: &'static str,
    pub grpc_web_address: Option<&'static str>,
    pub api_address: &'static str,
    pub home_dir: &'static str,
    pub pid_file: &'static str,
    pub log_file: &'static str,
    pub state_sync: Option<CosmosStateSyncSpec>,
}

#[derive(Clone, Debug)]
pub(crate) struct CosmosNodePaths {
    pub home_dir: PathBuf,
    pub pid_path: PathBuf,
    pub log_path: PathBuf,
}

impl CosmosNodeSpec {
    pub(crate) fn paths(&self) -> Result<CosmosNodePaths, Box<dyn std::error::Error>> {
        Ok(CosmosNodePaths {
            home_dir: resolve_home_relative_path(self.home_dir)?,
            pid_path: resolve_home_relative_path(self.pid_file)?,
            log_path: resolve_home_relative_path(self.log_file)?,
        })
    }
}

pub(crate) async fn start_managed_node(
    spec: &CosmosNodeSpec,
    trust_rpc_url_override: Option<&str>,
    health_retries: u32,
    health_retry_interval_ms: u64,
    process_label: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let paths = spec.paths()?;
    if let Some(existing_pid) = read_pid_file(paths.pid_path.as_path()) {
        if is_process_alive(existing_pid) {
            return Err(format!(
                "{} is already running (pid {})",
                process_label, existing_pid
            )
            .into());
        }
    }

    let state_sync_params = if let Some(state_sync_spec) = spec.state_sync {
        let trust_rpc_url = trust_rpc_url_override.unwrap_or(state_sync_spec.default_trust_rpc_url);
        Some((
            fetch_statesync_params(trust_rpc_url, state_sync_spec.trust_offset, spec.chain_name)
                .await?,
            state_sync_spec,
        ))
    } else {
        None
    };

    if let Some(parent) = paths.pid_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = paths.log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let stdout_file = File::create(paths.log_path.as_path())?;
    let stderr_file = stdout_file.try_clone()?;

    let mut command = Command::new(spec.binary);
    command
        .arg("start")
        .arg("--home")
        .arg(
            paths
                .home_dir
                .to_str()
                .ok_or("Invalid node home directory path")?,
        )
        .arg("--rpc.laddr")
        .arg(spec.rpc_laddr)
        .arg("--grpc.address")
        .arg(spec.grpc_address)
        .arg("--api.address")
        .arg(spec.api_address);

    if let Some(grpc_web_address) = spec.grpc_web_address {
        command.arg("--grpc-web.address").arg(grpc_web_address);
    }

    if let Some(((rpc_servers, trust_height, trust_hash), state_sync_spec)) = state_sync_params {
        let binary_prefix = spec.binary.to_ascii_uppercase();
        command
            .env(format!("{}_STATESYNC_ENABLE", binary_prefix), "true")
            .env(
                format!("{}_STATESYNC_RPC_SERVERS", binary_prefix),
                rpc_servers,
            )
            .env(
                format!("{}_STATESYNC_TRUST_HEIGHT", binary_prefix),
                trust_height.to_string(),
            )
            .env(
                format!("{}_STATESYNC_TRUST_HASH", binary_prefix),
                trust_hash,
            )
            .env(
                format!("{}_P2P_SEEDS", binary_prefix),
                state_sync_spec.seeds,
            )
            .env(
                format!("{}_P2P_PERSISTENT_PEERS", binary_prefix),
                state_sync_spec.persistent_peers,
            );
    }

    let child = command
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()?;

    fs::write(paths.pid_path.as_path(), child.id().to_string())?;
    thread::sleep(Duration::from_millis(500));
    if !is_process_alive(child.id()) {
        let log_tail = read_log_tail(paths.log_path.as_path(), 120)
            .unwrap_or_else(|_| format!("Unable to read {} log file", process_label));
        return Err(format!("{} exited early.\n{}", process_label, log_tail).into());
    }

    let is_healthy = wait_for_health_check(
        spec.status_url,
        health_retries,
        health_retry_interval_ms,
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

    let _ = stop_managed_node(spec, process_label);
    let log_tail = read_log_tail(paths.log_path.as_path(), 120)
        .unwrap_or_else(|_| format!("Unable to read {} log file", process_label));
    Err(format!(
        "Timed out while waiting for {} at {}.\n{}",
        process_label, spec.status_url, log_tail
    )
    .into())
}

pub(crate) fn stop_managed_node(
    spec: &CosmosNodeSpec,
    process_label: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let paths = spec.paths()?;
    let pid = read_pid_file(paths.pid_path.as_path()).or_else(|| {
        find_node_pids_for_home(spec.binary, paths.home_dir.as_path())
            .into_iter()
            .next()
    });

    if let Some(pid) = pid {
        stop_process(pid, process_label)?;
    }

    if paths.pid_path.exists() {
        fs::remove_file(paths.pid_path.as_path())?;
    }

    Ok(())
}

pub(crate) fn managed_node_health(
    id: &'static str,
    label: &'static str,
    spec: &CosmosNodeSpec,
) -> Result<ChainHealthStatus, String> {
    let default_rpc_port = parse_port_from_url(spec.status_url, "status_url", spec.chain_name)?;
    let grpc_port =
        parse_port_from_socket_address(spec.grpc_address, "grpc_address", spec.chain_name)?;

    let rpc_ready = check_rpc_health(id, spec.status_url, default_rpc_port, label).healthy;
    let grpc_ready = check_port_health(id, grpc_port, label).healthy;

    Ok(ChainHealthStatus {
        id,
        label,
        healthy: rpc_ready && grpc_ready,
        status: format!(
            "RPC ({}): {}; gRPC ({}): {}",
            default_rpc_port,
            if rpc_ready {
                "reachable"
            } else {
                "not reachable"
            },
            grpc_port,
            if grpc_ready {
                "reachable"
            } else {
                "not reachable"
            }
        ),
    })
}

pub(crate) fn resolve_home_relative_path(
    relative_path: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    home_dir()
        .map(|path| path.join(relative_path))
        .ok_or_else(|| "Unable to resolve home directory".into())
}

pub(crate) fn parse_port_from_url(
    url: &str,
    field_name: &str,
    chain_name: &str,
) -> Result<u16, String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| format!("Invalid {} {} '{}': {}", chain_name, field_name, url, error))?;
    parsed.port_or_known_default().ok_or_else(|| {
        format!(
            "{} {} '{}' does not include a known port",
            chain_name, field_name, url
        )
    })
}

pub(crate) fn parse_port_from_socket_address(
    address: &str,
    field_name: &str,
    chain_name: &str,
) -> Result<u16, String> {
    let port_text = address
        .trim()
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("Invalid {} {} '{}'", chain_name, field_name, address))?;

    port_text.parse::<u16>().map_err(|error| {
        format!(
            "Invalid {} {} '{}' (cannot parse port): {}",
            chain_name, field_name, address, error
        )
    })
}

/// Returns true if `binary` is available on `PATH`.
pub(crate) fn command_exists(binary: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path_var).any(|directory| directory.join(binary).is_file())
}

/// Resolves a binary either from `PATH` or from `$HOME/go/bin`.
///
/// The returned boolean indicates whether the binary came from `PATH` (`true`)
/// or from the Go fallback location (`false`).
pub(crate) fn locate_binary_in_path_or_go_bin(binary: &str) -> Option<(PathBuf, bool)> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join(binary);
            if candidate.is_file() {
                return Some((candidate, true));
            }
        }
    }

    home_dir().and_then(|home| {
        let candidate = home.join("go").join("bin").join(binary);
        if candidate.is_file() {
            Some((candidate, false))
        } else {
            None
        }
    })
}

/// Prepends `directory` to the current process `PATH` if it is not already present.
pub(crate) fn add_directory_to_process_path(directory: &Path) {
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

/// Fetches state-sync parameters from a trusted RPC endpoint.
///
/// Returns `(rpc_servers, trust_height, trust_hash)` for use in Cosmos SDK
/// state-sync startup.
pub(crate) async fn fetch_statesync_params(
    trust_rpc_url: &str,
    trust_offset: u64,
    chain_name: &str,
) -> Result<(String, u64, String), Box<dyn std::error::Error>> {
    let trust_rpc_base_url = normalize_trust_rpc_url(trust_rpc_url)?;
    let status_url = trust_rpc_base_url.join("status")?;

    let status_response = reqwest::get(status_url.as_str()).await?;
    if !status_response.status().is_success() {
        return Err(format!(
            "Failed to fetch status from trusted {} RPC {} (HTTP {})",
            chain_name,
            status_url,
            status_response.status()
        )
        .into());
    }

    let status_payload: Value = status_response.json().await?;
    let latest_height = status_payload["result"]["sync_info"]["latest_block_height"]
        .as_str()
        .and_then(|height| height.parse::<u64>().ok())
        .ok_or_else(|| {
            format!(
                "Unable to parse latest_block_height from trusted {} RPC status response",
                chain_name
            )
        })?;

    if latest_height <= trust_offset {
        return Err(format!(
            "Latest {} testnet height {} is too low to compute trust height with offset {}",
            chain_name, latest_height, trust_offset
        )
        .into());
    }

    let trust_height = latest_height - trust_offset;
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
        .ok_or_else(|| {
            format!(
                "Unable to parse trusted block hash from {} RPC block response",
                chain_name
            )
        })?
        .to_string();

    let rpc_server = format_rpc_server_address(&trust_rpc_base_url)?;
    let rpc_servers = format!("{},{}", rpc_server, rpc_server);

    Ok((rpc_servers, trust_height, trust_hash))
}

/// Reads a PID from a pid-file.
pub(crate) fn read_pid_file(pid_file_path: &Path) -> Option<u32> {
    fs::read_to_string(pid_file_path)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
}

/// Gracefully terminates a process, then force-kills if needed.
pub(crate) fn stop_process(
    pid: u32,
    process_label: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if !is_process_alive(pid) {
        return Ok(());
    }

    let terminate_status = Command::new("kill")
        .args(["-TERM", pid.to_string().as_str()])
        .status()?;
    if !terminate_status.success() {
        return Err(format!("Failed to send SIGTERM to {} pid {}", process_label, pid).into());
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
        return Err(format!("Failed to send SIGKILL to {} pid {}", process_label, pid).into());
    }

    for _ in 0..10 {
        if !is_process_alive(pid) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    Err(format!(
        "{} pid {} is still running after stop attempt",
        process_label, pid
    )
    .into())
}

/// Checks whether a process ID is currently alive.
pub(crate) fn is_process_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", pid.to_string().as_str()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some_and(|status| status.success())
}

/// Finds running node PIDs for a specific binary and `--home` directory.
pub(crate) fn find_node_pids_for_home(binary_name: &str, node_home_path: &Path) -> Vec<u32> {
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
                    if command.contains(binary_name)
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

/// Reads the last `max_lines` lines from a log file.
pub(crate) fn read_log_tail(
    log_path: &Path,
    max_lines: usize,
) -> Result<String, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(log_path)?;
    let mut lines: Vec<&str> = content.lines().rev().take(max_lines).collect();
    lines.reverse();
    Ok(lines.join("\n"))
}

/// Normalizes a trusted RPC URL to its base form.
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

/// Formats a URL as `{scheme}://{host}:{port}` for state-sync RPC servers.
fn format_rpc_server_address(url: &reqwest::Url) -> Result<String, Box<dyn std::error::Error>> {
    let host = url
        .host_str()
        .ok_or("Trusted RPC URL is missing a host name")?;
    let port = url
        .port_or_known_default()
        .ok_or("Trusted RPC URL is missing a known port")?;
    Ok(format!("{}://{}:{}", url.scheme(), host, port))
}

/// Parses `ps` output lines of the shape `pid command...`.
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

fn parse_bool_option(raw_value: &str, field_name: &str) -> Result<bool, String> {
    match raw_value.to_lowercase().as_str() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" => Ok(false),
        _ => Err(format!(
            "Option '{}' expects a boolean value (true/false), got '{}'",
            field_name, raw_value
        )),
    }
}
