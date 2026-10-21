use std::path::Path;

use crate::{
    logger,
    route_setup::{self, RouteChain, RouteEndpoint},
    start::OptionalChainId,
    utils::execute_script,
};

pub async fn run_token_swap_demo(
    project_root_path: &Path,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
) -> Result<(), String> {
    match chain.unwrap_or(OptionalChainId::Osmosis) {
        OptionalChainId::Osmosis => {}
        OptionalChainId::Cosmos | OptionalChainId::Injective => {
            return Err("The Cosmos and Injective demos only transfer tokens. Use `caribic demo token-transfer` with the same chain and network.".to_string());
        }
        OptionalChainId::Cheqd => {
            return Err("ERROR: Token-swap demo is not implemented for chain 'cheqd'.".to_string());
        }
    }
    if crate::local_network::is_local(project_root_path) {
        return Err("The Osmosis token-swap demo is not supported by the local DevKit runtime. Use `caribic demo token-transfer --chain cosmos --network v8-classic` for the local transfer demo.".to_string());
    }

    let network = network.unwrap_or("local");
    let route = route_setup::setup_transfer_route(
        project_root_path,
        RouteEndpoint::new(RouteChain::Cardano, None),
        RouteEndpoint::new(RouteChain::Osmosis, Some(network.to_string())),
    )?;

    logger::log("PASS: Direct token-transfer route is ready");
    for line in route.summary_lines() {
        logger::log(&format!("  {}", line));
    }

    run_direct_osmosis_token_swap(
        project_root_path,
        network,
        &route.cardano_chain_id,
        &route.destination_chain_id,
        &route.direct_channel_pair.a_channel_id,
        &route.direct_channel_pair.b_channel_id,
    )
}

fn run_direct_osmosis_token_swap(
    project_root_path: &Path,
    network: &str,
    cardano_chain_id: &str,
    osmosis_chain_id: &str,
    cardano_osmosis_channel_id: &str,
    osmosis_cardano_channel_id: &str,
) -> Result<(), String> {
    let script_path = project_root_path
        .join("chains")
        .join("osmosis")
        .join("scripts")
        .join("run_direct_token_swap.sh");
    let script = script_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid run_direct_token_swap.sh path".to_string())?;
    let project_root = project_root_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid project root path".to_string())?;

    execute_script(
        project_root_path,
        script,
        Vec::new(),
        Some(vec![
            ("CARIBIC_PROJECT_ROOT", project_root),
            ("OSMOSIS_NETWORK", network),
            ("CARDANO_CHAIN_ID", cardano_chain_id),
            ("HERMES_OSMOSIS_NAME", osmosis_chain_id),
            ("OSMOSIS_CHAIN_ID", osmosis_chain_id),
            ("CARDANO_OSMOSIS_CHANNEL_ID", cardano_osmosis_channel_id),
            ("OSMOSIS_CARDANO_CHANNEL_ID", osmosis_cardano_channel_id),
        ]),
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to run direct Osmosis token-swap demo: {}",
            error
        )
    })?;

    logger::log("PASS: Direct Cardano-to-Osmosis token swap completed");
    Ok(())
}
