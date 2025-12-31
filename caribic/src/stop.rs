use std::path::Path;

use crate::{
    config,
    logger::{error, log},
    utils::execute_script,
};

pub fn stop_gateway(project_root_path: &Path) {
    use std::process::Command;
    
    let gateway_dir = project_root_path.join("cardano/gateway");
    
    // Check if Gateway containers are running
    let ps_check = Command::new("docker")
        .args(&["compose", "ps", "--status", "running", "--format", "{{.Names}}"])
        .current_dir(&gateway_dir)
        .output();
    
    let containers_running = match ps_check {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                !stdout.trim().is_empty()
            } else {
                false
            }
        }
        Err(_) => false,
    };
    
    if !containers_running {
        log("Gateway was not running");
        return;
    }
    
    // Containers are running, proceed to stop them
    let gateway_result = execute_script(
        gateway_dir.as_path(),
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
    use std::process::Command;
    
    let cardano_dir = project_root_path.join("chains/cardano");
    
    // Check if Cardano containers are running
    let ps_check = Command::new("docker")
        .args(&["compose", "ps", "--status", "running", "--format", "{{.Names}}"])
        .current_dir(&cardano_dir)
        .output();
    
    let containers_running = match ps_check {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                !stdout.trim().is_empty()
            } else {
                false
            }
        }
        Err(_) => false,
    };
    
    if !containers_running {
        log("Cardano network was not running");
        return;
    }
    
    // Containers are running, proceed to stop them
    let cardano_result = execute_script(
        cardano_dir.as_path(),
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

pub fn stop_cosmos(cosmos_path: &Path, label: &str) {
    if !cosmos_path.exists() {
        log(&format!("{} was not running", label));
        return;
    }
    
    use std::process::Command;
    
    // Check if Cosmos containers are running
    let ps_check = Command::new("docker")
        .args(&["compose", "ps", "--status", "running", "--format", "{{.Names}}"])
        .current_dir(cosmos_path)
        .output();
    
    let containers_running = match ps_check {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                !stdout.trim().is_empty()
            } else {
                false
            }
        }
        Err(_) => false,
    };
    
    if !containers_running {
        log(&format!("{} was not running", label));
        return;
    }
    
    // Containers are running, proceed to stop them
    let cosmos_result =
        execute_script(cosmos_path, "docker", Vec::from(["compose", "down"]), None);
    match cosmos_result {
        Ok(_) => {
            log(&format!("{} stopped successfully", label));
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop {}: {}", label, e));
        }
    }
}

pub fn stop_osmosis(osmosis_path: &Path) {
    use std::process::Command;
    
    // Check if Osmosis containers are running
    // Osmosis uses a different setup, so we check for common container names
    let ps_check = Command::new("docker")
        .args(&["ps", "--filter", "name=osmosis", "--filter", "status=running", "--format", "{{.Names}}"])
        .output();
    
    let containers_running = match ps_check {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                !stdout.trim().is_empty()
            } else {
                false
            }
        }
        Err(_) => false,
    };
    
    if !containers_running {
        log("Osmosis was not running");
        return;
    }
    
    // Containers are running, proceed to stop them
    let osmosis_result = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
    match osmosis_result {
        Ok(_) => {
            log("Osmosis stopped successfully");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Osmosis: {}", e));
        }
    }
}

pub fn stop_relayer(_relayer_path: &Path) {
    use std::process::Command;
    
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
    use std::process::Command;
    
    let mithril_script_path = mithril_path.join("scripts");
    let mithril_config = config::get_config().mithril;
    
    // Check if Mithril containers are running
    let ps_check = Command::new("docker")
        .args(&[
            "compose",
            "-f",
            "docker-compose.yaml",
            "--profile",
            "mithril",
            "ps",
            "--status",
            "running",
            "--format",
            "{{.Names}}",
        ])
        .current_dir(&mithril_script_path)
        .env("MITHRIL_AGGREGATOR_IMAGE", &mithril_config.aggregator_image)
        .env("MITHRIL_CLIENT_IMAGE", &mithril_config.client_image)
        .env("MITHRIL_SIGNER_IMAGE", &mithril_config.signer_image)
        .env("CARDANO_NODE_VERSION", &mithril_config.cardano_node_version)
        .env("CHAIN_OBSERVER_TYPE", &mithril_config.chain_observer_type)
        .env("CARDANO_NODE_DIR", &mithril_config.cardano_node_dir)
        .env("MITHRIL_DATA_DIR", mithril_path.join("data").to_str().unwrap())
        .env("GENESIS_VERIFICATION_KEY", &mithril_config.genesis_verification_key)
        .env("GENESIS_SECRET_KEY", &mithril_config.genesis_secret_key)
        .output();
    
    let containers_running = match ps_check {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Check if there are any running containers (non-empty output)
                !stdout.trim().is_empty()
            } else {
                false
            }
        }
        Err(_) => false,
    };
    
    if !containers_running {
        log("Mithril was not running");
        return;
    }
    
    // Containers are running, proceed to stop them
    let mithril_data_dir = mithril_path.join("data");
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
            log("Mithril stopped successfully");
        }
        Err(e) => {
            error(&format!("ERROR: Failed to stop Mithril: {}", e));
        }
    }
}
