use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::{
    config,
    logger::{error, log},
    utils::execute_script,
};

/// Check if any docker compose containers are running in a given directory
fn has_running_containers(path: &Path) -> bool {
    let output = Command::new("docker")
        .args(&["compose", "ps", "-q"])
        .current_dir(path)
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            !stdout.trim().is_empty()
        }
        Err(_) => false,
    }
}

pub fn stop_gateway(project_root_path: &Path) {
    let gateway_path = project_root_path.join("cardano/gateway");

    if !has_running_containers(&gateway_path) {
        log("Gateway was not running");
        return;
    }

    let gateway_result = execute_script(
        &gateway_path,
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match gateway_result {
        Ok(_) => {
            log("Gateway stopped successfully");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop gateway: {}", e));
        }
    }
}

pub fn stop_cardano_network(project_root_path: &Path) {
    let cardano_path = project_root_path.join("chains/cardano");

    if !has_running_containers(&cardano_path) {
        log("Cardano network was not running");
        return;
    }

    let cardano_result = execute_script(
        &cardano_path,
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match cardano_result {
        Ok(_) => {
            log("Cardano network stopped successfully");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Cardano network: {}", e));
        }
    }
}

pub fn stop_cosmos(cosmos_path: &Path, chain_name: &str) {
    if !cosmos_path.exists() {
        return;
    }

    if !has_running_containers(cosmos_path) {
        log(&format!("{} was not running", chain_name));
        return;
    }

    let cosmos_result = execute_script(cosmos_path, "docker", Vec::from(["compose", "down"]), None);
    match cosmos_result {
        Ok(_) => {
            log(&format!("{} stopped successfully", chain_name));
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop {}: {}", chain_name, e));
        }
    }
}

pub fn stop_osmosis(osmosis_path: &Path) {
    // Osmosis uses make instead of docker compose, harder to check if running
    // Just attempt to stop and let make handle it gracefully
    let osmosis_result = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
    match osmosis_result {
        Ok(_) => {
            // make localnet-stop doesn't tell us if it was running, so be quiet
        }
        Err(_) => {
            // Silently ignore errors - osmosis might not be set up
        }
    }
}

pub fn stop_relayer(relayer_path: &Path) {
    // Stop Hermes daemon by targeting the exact local relayer binary process that caribic starts:
    //   <project>/relayer/target/release/hermes --config ... start
    // Matching on "hermes start" is not reliable because "--config" sits between those tokens.
    let running_pids = find_running_hermes_daemon_pids(relayer_path);
    if running_pids.is_empty() {
        log("Hermes relayer was not running");
        return;
    }

    for pid in &running_pids {
        if let Err(kill_error) = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
        {
            error(&format!(
                "ERROR: Failed to send SIGTERM to Hermes relayer pid {}: {}",
                pid, kill_error
            ));
        }
    }

    thread::sleep(Duration::from_millis(500));

    let remaining_pids: Vec<u32> = running_pids
        .into_iter()
        .filter(|pid| is_process_alive(*pid))
        .collect();

    for pid in &remaining_pids {
        if let Err(kill_error) = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .output()
        {
            error(&format!(
                "ERROR: Failed to send SIGKILL to Hermes relayer pid {}: {}",
                pid, kill_error
            ));
        }
    }

    if remaining_pids.is_empty() {
        log("Hermes relayer stopped successfully");
    } else {
        log(&format!(
            "Hermes relayer stop requested; forced kill attempted for remaining pids: {}",
            remaining_pids
                .iter()
                .map(|pid| pid.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
}

fn is_process_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn find_running_hermes_daemon_pids(relayer_path: &Path) -> Vec<u32> {
    let expected_binary = relayer_path.join("target/release/hermes");
    let expected_binary_str = expected_binary.to_str();

    let ps_output = Command::new("ps")
        .args(["-ax", "-o", "pid=,command="])
        .output();

    match ps_output {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| parse_pid_and_command(line))
            .filter_map(|(pid, command)| {
                if is_hermes_daemon_command(command.as_str(), expected_binary_str) {
                    Some(pid)
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn parse_pid_and_command(line: &str) -> Option<(u32, String)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let pid_str = parts.next()?;
    let command = parts.next().unwrap_or("").trim_start().to_string();
    let pid = pid_str.parse::<u32>().ok()?;

    Some((pid, command))
}

fn is_hermes_daemon_command(command: &str, expected_binary_path: Option<&str>) -> bool {
    let normalized_command = command.trim();

    if normalized_command.is_empty() || !normalized_command.contains("--config") {
        return false;
    }

    if let Some(path) = expected_binary_path {
        if normalized_command.starts_with(path) {
            return normalized_command.ends_with(" start");
        }
    }

    normalized_command.contains("hermes") && normalized_command.ends_with(" start")
}

pub fn stop_mithril(mithril_path: &Path) {
    let mithril_script_path = mithril_path.join("scripts");

    if !mithril_script_path.exists() {
        log("Mithril was not configured");
        return;
    }

    let mithril_data_dir = mithril_path.join("data");
    let mithril_config = config::get_config().mithril;
    let mithril_result = execute_script(
        &mithril_script_path,
        "docker",
        Vec::from([
            "compose",
            "-f",
            "docker-compose.yaml",
            "--profile",
            "mithril",
            "down",
        ]),
        Some(vec![
            (
                "MITHRIL_AGGREGATOR_IMAGE",
                mithril_config.aggregator_image.as_str(),
            ),
            ("MITHRIL_CLIENT_IMAGE", mithril_config.client_image.as_str()),
            ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
            (
                "CARDANO_NODE_VERSION",
                mithril_config.cardano_node_version.as_str(),
            ),
            (
                "CHAIN_OBSERVER_TYPE",
                mithril_config.chain_observer_type.as_str(),
            ),
            ("CARDANO_NODE_DIR", mithril_config.cardano_node_dir.as_str()),
            ("MITHRIL_DATA_DIR", mithril_data_dir.to_str().unwrap()),
            (
                "GENESIS_VERIFICATION_KEY",
                mithril_config.genesis_verification_key.as_str(),
            ),
            (
                "GENESIS_SECRET_KEY",
                mithril_config.genesis_secret_key.as_str(),
            ),
            ("MITHRIL_SIGNER_IMAGE", mithril_config.signer_image.as_str()),
        ]),
    );
    match mithril_result {
        Ok(_) => {
            log("Mithril stopped successfully (mithril-aggregator, mithril-signer-1, mithril-signer-2)");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Mithril: {}", e));
        }
    }
}
