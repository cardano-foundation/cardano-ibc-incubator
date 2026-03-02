//! Shared runtime utilities for Cosmos-style chain adapters.
//!
//! This module centralizes operational helpers that are reused across
//! multiple Cosmos chains (currently Osmosis and Injective), so chain
//! implementations can keep only chain-specific logic in their own modules.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use dirs::home_dir;
use serde_json::Value;

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
