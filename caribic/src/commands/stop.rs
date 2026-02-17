use std::path::Path;

use crate::{chains, logger, stop, StopTarget};

/// Stops the requested service group and keeps stop ordering consistent.
pub fn run_stop(
    target: Option<StopTarget>,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    let stop_optional_chain_target = target == Some(StopTarget::Osmosis);

    if !stop_optional_chain_target && (network.is_some() || !chain_flags.is_empty()) {
        return Err(
            "ERROR: --network and --chain-flag are only supported with `caribic stop osmosis` or `caribic chain stop ...`"
                .to_string(),
        );
    }

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
            stop_optional_chain(project_root_path, None, Vec::new())?;
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
            stop_optional_chain(project_root_path, network, chain_flags)?;
            logger::log("\nOsmosis stopped successfully");
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
            stop_optional_chain(project_root_path, None, Vec::new())?;
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

fn stop_optional_chain(
    project_root_path: &Path,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let adapter = chains::get_chain_adapter("osmosis")
        .ok_or_else(|| "ERROR: Osmosis chain adapter is not registered".to_string())?;
    let resolved_network = adapter.resolve_network(network.as_deref())?;
    let parsed_flags = chains::parse_chain_flags(chain_flags.as_slice())?;
    adapter.stop(project_root_path, resolved_network.as_str(), &parsed_flags)
}

/// Stops the local Cardano network and Mithril services.
fn network_down(project_root_path: &Path) {
    // Stop local cardano network
    stop::stop_cardano_network(project_root_path);

    // Stop Mithril
    stop::stop_mithril(project_root_path.join("chains/mithrils").as_path());
}

/// Stops bridge-facing components that are safe to restart independently.
fn bridge_down(project_root_path: &Path) {
    // Stop Relayer
    stop::stop_relayer(project_root_path.join("relayer").as_path());

    // Stop Gateway
    stop::stop_gateway(project_root_path);
}
