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
    let optional_chain_alias = resolve_optional_chain_alias(target.as_ref());

    if optional_chain_alias.is_none() && (network.is_some() || !chain_flags.is_empty()) {
        return Err(
            "ERROR: --network and --chain-flag are only supported with `caribic stop <optional-chain-alias>` or `caribic chain stop ...`"
                .to_string(),
        );
    }

    match target {
        Some(StopTarget::All) | None => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop_optional_chain(project_root_path, "osmosis", None, Vec::new())?;
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
            stop_optional_chain(
                project_root_path,
                optional_chain_alias.unwrap_or("osmosis"),
                network,
                chain_flags,
            )?;
            logger::log("\nOptional chain stopped successfully");
        }
        Some(StopTarget::Demo) => {
            stop::stop_cosmos(
                project_root_path.join("cosmos").as_path(),
                "Cosmos Entrypoint chain",
            );
            stop_optional_chain(project_root_path, "osmosis", None, Vec::new())?;
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
    chain_id: &str,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let adapter = chains::get_chain_adapter(chain_id).ok_or_else(|| {
        format!(
            "ERROR: Optional chain adapter '{}' is not registered",
            chain_id
        )
    })?;
    let resolved_network = adapter.resolve_network(network.as_deref())?;
    let parsed_flags = chains::parse_chain_flags(chain_flags.as_slice())?;
    adapter.stop(project_root_path, resolved_network.as_str(), &parsed_flags)
}

/// Returns the optional-chain alias handled by `caribic stop <target>` aliases.
fn resolve_optional_chain_alias(target: Option<&StopTarget>) -> Option<&'static str> {
    match target {
        Some(StopTarget::Osmosis) => Some("osmosis"),
        _ => None,
    }
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
