use std::path::Path;

use crate::{
    logger::{error, log},
    utils::execute_script,
};

pub fn stop_cardano_network(project_root_path: &Path) {
    let cardano_result = execute_script(
        project_root_path.join("chains/cardano").as_path(),
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match cardano_result {
        Ok(_) => {
            log("✅ Cardano network stopped");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Cardano network: {}", e));
        }
    }

    let gateway_result = execute_script(
        project_root_path.join("cardano/gateway").as_path(),
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match gateway_result {
        Ok(_) => {
            log("✅ Gateway stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop gateway: {}", e));
        }
    }
}

pub fn stop_cosmos(cosmos_path: &Path) {
    let cosmos_result = execute_script(cosmos_path, "docker", Vec::from(["compose", "down"]), None);
    match cosmos_result {
        Ok(_) => {
            log("✅ Cosmos stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Cosmos: {}", e));
        }
    }
}

pub fn stop_osmosis(osmosis_path: &Path) {
    let osmosis_result = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
    match osmosis_result {
        Ok(_) => {
            log("✅ Osmosis stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Osmosis: {}", e));
        }
    }
}

pub fn stop_relayer(relayer_path: &Path) {
    let relayer_result =
        execute_script(relayer_path, "docker", Vec::from(["compose", "down"]), None);
    match relayer_result {
        Ok(_) => {
            log("✅ Relayer stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Relayer: {}", e));
        }
    }
}
