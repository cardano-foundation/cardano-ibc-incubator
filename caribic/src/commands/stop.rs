use std::path::Path;

use crate::{chains, config, logger, stop, StopTarget};

fn resolve_stop_network(
    requested: Option<&str>,
    active: config::CoreCardanoNetwork,
) -> Result<config::CoreCardanoNetwork, String> {
    let Some(requested) = requested else {
        return Ok(active);
    };
    let requested = config::CoreCardanoNetwork::parse(Some(requested))?;
    if requested != active {
        return Err(format!(
            "ERROR: Cardano {} is active, but stop requested {}. Refusing to stop a different runtime; switch the flag or omit --network.",
            active.as_str(),
            requested.as_str()
        ));
    }
    Ok(active)
}

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

    let active_network = config::active_core_cardano_network(project_root_path);
    let core_cardano_network = resolve_stop_network(network.as_deref(), active_network)?;

    match target {
        Some(StopTarget::All) | None => {
            stop::stop_dapp(project_root_path);
            stop_all_managed_optional_chain_networks(project_root_path, "osmosis")?;
            stop_all_managed_optional_chain_networks(project_root_path, "cheqd")?;
            stop_all_managed_optional_chain_networks(project_root_path, "injective")?;
            bridge_down(project_root_path);
            network_down(project_root_path, core_cardano_network);
            logger::log("\nAll services stopped successfully");
        }
        Some(StopTarget::Bridge) => {
            bridge_down(project_root_path);
            logger::log("\nBridge stopped successfully");
        }
        Some(StopTarget::Dapp) => {
            stop::stop_dapp(project_root_path);
            logger::log("\nIBC Swap dapp stopped successfully");
        }
        Some(StopTarget::Network) => {
            network_down(project_root_path, core_cardano_network);
            logger::log("\nCardano Network stopped successfully");
        }
        Some(StopTarget::Demo) => {
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
                logger::log(&format!(
                    "\nUsing public Mithril {}; no local Mithril containers to stop",
                    core_cardano_network.as_str()
                ));
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
fn network_down(project_root_path: &Path, active_network: config::CoreCardanoNetwork) {
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

#[cfg(test)]
mod tests {
    use super::resolve_stop_network;
    use crate::config::CoreCardanoNetwork;

    #[test]
    fn explicit_stop_network_must_match_the_active_runtime() {
        assert_eq!(
            resolve_stop_network(None, CoreCardanoNetwork::Preprod).unwrap(),
            CoreCardanoNetwork::Preprod
        );
        assert_eq!(
            resolve_stop_network(Some("preview"), CoreCardanoNetwork::Preview).unwrap(),
            CoreCardanoNetwork::Preview
        );
        let error = resolve_stop_network(Some("preview"), CoreCardanoNetwork::Preprod)
            .expect_err("a stop command must not target another active runtime");
        assert!(error.contains("preprod is active"));
        assert!(error.contains("requested preview"));
    }
}
