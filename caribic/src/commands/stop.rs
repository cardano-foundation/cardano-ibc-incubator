use std::path::Path;

use crate::{logger, stop, utils, StopTarget};

pub fn run_stop(target: Option<StopTarget>) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    let osmosis_dir = utils::get_osmosis_dir(project_root_path);

    match target {
        Some(StopTarget::All) | None => {
            stop::stop_cosmos(
                project_root_path.join("chains/summit-demo/").as_path(),
                "Message-exchange demo chain",
            );
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop::stop_osmosis(osmosis_dir.as_path());
            bridge_down(project_root_path);
            network_down(project_root_path);
            logger::log("\nAll services stopped successfully");
        }
        Some(StopTarget::Bridge) => {
            bridge_down(project_root_path);
            logger::log("\nBridge stopped successfully");
        }
        Some(StopTarget::Network) => {
            network_down(project_root_path);
            logger::log("\nCardano Network stopped successfully");
        }
        Some(StopTarget::Cosmos) => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            logger::log("\nCosmos Entrypoint chain stopped successfully");
        }
        Some(StopTarget::Osmosis) => {
            stop::stop_osmosis(osmosis_dir.as_path());
            logger::log("\nOsmosis appchain stopped successfully");
        }
        Some(StopTarget::Demo) => {
            stop::stop_cosmos(
                project_root_path.join("chains/summit-demo/").as_path(),
                "Message-exchange demo chain",
            );
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop::stop_osmosis(osmosis_dir.as_path());
            logger::log("\nDemo services stopped successfully");
        }
        Some(StopTarget::Gateway) => {
            stop::stop_gateway(project_root_path);
            logger::log("\nGateway stopped successfully");
        }
        Some(StopTarget::Relayer) => {
            stop::stop_relayer(project_root_path.join("relayer").as_path());
            logger::log("\nRelayer stopped successfully");
        }
        Some(StopTarget::Mithril) => {
            stop::stop_mithril(project_root_path.join("chains/mithrils").as_path());
            logger::log("\nMithril stopped successfully (mithril-aggregator, mithril-signer-1, mithril-signer-2)");
        }
    }

    Ok(())
}

fn network_down(project_root_path: &Path) {
    // Stop local cardano network
    stop::stop_cardano_network(project_root_path);

    // Stop Mithril
    stop::stop_mithril(project_root_path.join("chains/mithrils").as_path());
}

fn bridge_down(project_root_path: &Path) {
    // Stop Relayer
    stop::stop_relayer(project_root_path.join("relayer").as_path());

    // Stop Gateway
    stop::stop_gateway(project_root_path);
}
