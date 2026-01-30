use std::path::Path;
use std::process::Command;

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

pub fn stop_cosmos(cosmos_path: &Path) {
    if !cosmos_path.exists() {
        return;
    }
    
    if !has_running_containers(cosmos_path) {
        log("Cosmos was not running");
        return;
    }
    
    let cosmos_result =
        execute_script(cosmos_path, "docker", Vec::from(["compose", "down"]), None);
    match cosmos_result {
        Ok(_) => {
            log("Cosmos stopped successfully");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Cosmos: {}", e));
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

pub fn stop_relayer(_relayer_path: &Path) {
    // Stop Hermes daemon by finding and killing the process
    let pkill_result = Command::new("pkill")
        .args(&["-f", "hermes start"])
        .output();
    
    match pkill_result {
        Ok(output) => {
            if output.status.success() {
                log("Hermes relayer stopped successfully");
            } else {
                log("Hermes relayer was not running");
            }
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Hermes relayer: {}", e));
        }
    }
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
