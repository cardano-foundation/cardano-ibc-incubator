use std::path::Path;

use crate::{logger, stop, StopTarget};

/// Stops the requested service group and keeps stop ordering consistent.
pub fn run_stop(
    target: Option<StopTarget>,
    chain: Option<String>,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    if let Some(chain_id) = chain.as_deref() {
        if target.is_some() {
            return Err(
                "ERROR: --chain cannot be combined with a stop target. Use either `caribic stop bridge` or `caribic stop --chain <chain>`."
                    .to_string(),
            );
        }

        if network.is_some() || !chain_flags.is_empty() {
            let (display_name, resolved_network) = crate::commands::chain::stop_optional_chain(
                project_root_path,
                chain_id,
                network.as_deref(),
                chain_flags.as_slice(),
            )
            .map_err(|error| {
                format!("ERROR: Failed to stop optional chain '{}': {}", chain_id, error)
            })?;

            logger::log(&format!(
                "\n{} stopped successfully (network: {})",
                display_name, resolved_network,
            ));
        } else {
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                chain_id,
            )
            .map_err(|error| {
                format!("ERROR: Failed to stop optional chain '{}': {}", chain_id, error)
            })?;

            logger::log("\nOptional chain stopped successfully");
        }

        return Ok(());
    }

    if network.is_some() || !chain_flags.is_empty() {
        return Err(
            "ERROR: --network and --chain-flag require --chain. Use `caribic stop --chain <chain> --network <network>`."
                .to_string(),
        );
    }

    match target {
        Some(StopTarget::All) | None => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "osmosis",
            )?;
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "cheqd",
            )?;
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "injective",
            )?;
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
                "Cosmos Entrypoint chain",
            );
            logger::log("\nCosmos Entrypoint chain stopped successfully");
        }
        Some(StopTarget::Demo) => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "osmosis",
            )?;
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "cheqd",
            )?;
            crate::commands::chain::stop_all_managed_optional_chain_networks(
                project_root_path,
                "injective",
            )?;
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
