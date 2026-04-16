use std::path::Path;

use crate::{chains, config, logger, stop, StopTarget};

/// Stops the requested service group and keeps stop ordering consistent.
pub fn run_stop(
    target: Option<StopTarget>,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    if !chain_flags.is_empty() {
        return Err(
            "ERROR: --chain-flag is only supported through the chain adapter registry. Use `caribic chain stop --chain <id> --network <network>`."
                .to_string(),
        );
    }

    let core_cardano_network = match network.as_deref() {
        Some(requested_network) => config::CoreCardanoNetwork::parse(Some(requested_network))?,
        None => config::active_core_cardano_network(project_root_path),
    };

    match target {
        Some(StopTarget::All) | None => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop_all_managed_optional_chain_networks(project_root_path, "osmosis")?;
            stop_all_managed_optional_chain_networks(project_root_path, "cheqd")?;
            stop_all_managed_optional_chain_networks(project_root_path, "injective")?;
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
        Some(StopTarget::Entrypoint) => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Entrypoint chain",
            );
            logger::log("\nEntrypoint chain stopped successfully");
        }
        Some(StopTarget::Demo) => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop_all_managed_optional_chain_networks(project_root_path, "osmosis")?;
            stop_all_managed_optional_chain_networks(project_root_path, "cheqd")?;
            stop_all_managed_optional_chain_networks(project_root_path, "injective")?;
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
            if core_cardano_network.uses_local_mithril() {
                stop::stop_mithril(project_root_path.join("chains/mithrils").as_path());
                logger::log(
                    "\nMithril stopped successfully (mithril-aggregator, mithril-signer-1, mithril-signer-2)",
                );
            } else {
                logger::log(
                    "\nUsing public Mithril release-preprod; no local Mithril containers to stop",
                );
            }
        }
    }

    Ok(())
}

fn stop_all_managed_optional_chain_networks(
    project_root_path: &Path,
    chain_id: &str,
) -> Result<(), String> {
    let adapter = chains::get_chain_adapter(chain_id).ok_or_else(|| {
        format!(
            "ERROR: Optional chain adapter '{}' is not registered",
            chain_id
        )
    })?;

    for network in adapter
        .supported_networks()
        .iter()
        .filter(|network| network.managed_by_caribic)
    {
        adapter
            .stop(project_root_path, network.name, &chains::ChainFlags::new())
            .map_err(|error| {
                format!(
                    "ERROR: Failed to stop {} network '{}': {}",
                    adapter.display_name(),
                    network.name,
                    error
                )
            })?;
    }

    Ok(())
}

/// Stops the local Cardano network and Mithril services.
fn network_down(project_root_path: &Path) {
    let active_network = crate::config::active_core_cardano_network(project_root_path);
    stop::stop_cardano_network(project_root_path);

    if active_network.uses_local_mithril() {
        stop::stop_mithril(project_root_path.join("chains/mithrils").as_path());
    }
}

/// Stops bridge-facing components that are safe to restart independently.
fn bridge_down(project_root_path: &Path) {
    stop::stop_relayer(project_root_path.join("relayer").as_path());
    stop::stop_gateway(project_root_path);
}
