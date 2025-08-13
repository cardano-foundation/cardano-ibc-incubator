use std::path::Path;

use crate::{
    config,
    logger::{error, log},
    utils::execute_script,
};

pub fn stop_gateway(project_root_path: &Path) {
    let gateway_result = execute_script(
        project_root_path.join("cardano/gateway").as_path(),
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match gateway_result {
        Ok(_) => {
            log("❎ Gateway stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop gateway: {}", e));
        }
    }
}

pub fn stop_cardano_network(project_root_path: &Path) {
    let cardano_result = execute_script(
        project_root_path.join("chains/cardano").as_path(),
        "docker",
        Vec::from(["compose", "down"]),
        None,
    );
    match cardano_result {
        Ok(_) => {
            log("❎ Cardano network stopped");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Cardano network: {}", e));
        }
    }
}

pub fn stop_cosmos(cosmos_path: &Path) {
    if cosmos_path.exists() {
        let cosmos_result =
            execute_script(cosmos_path, "docker", Vec::from(["compose", "down"]), None);
        match cosmos_result {
            Ok(_) => {
                log("❎ Cosmos stopped successfully");
            }
            Err(e) => {
                error(&format!("❌ Failed to stop Cosmos: {}", e));
            }
        }
    }
}

pub fn stop_osmosis(osmosis_path: &Path) {
    let osmosis_result = execute_script(osmosis_path, "make", Vec::from(["localnet-stop"]), None);
    match osmosis_result {
        Ok(_) => {
            log("❎ Osmosis stopped successfully");
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
            log("❎ Relayer stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Relayer: {}", e));
        }
    }
}

pub fn stop_mithril(mithril_path: &Path) {
    let mithril_data_dir = mithril_path.join("data");
    let mithril_script_path = mithril_path.join("scripts");
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
            log("❎ Mithril stopped successfully");
        }
        Err(e) => {
            error(&format!("❌ Failed to stop Mithril: {}", e));
        }
    }
}
