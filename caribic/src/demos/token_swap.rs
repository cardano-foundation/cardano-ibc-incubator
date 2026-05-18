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
    let resolved_chain = chain.unwrap_or(OptionalChainId::Osmosis);
    let network_label = network.unwrap_or("local");
    let route_chain = match resolved_chain {
        OptionalChainId::Osmosis => RouteChain::Osmosis,
        OptionalChainId::Injective => RouteChain::Injective,
        OptionalChainId::Cheqd => {
            return Err("ERROR: Token-swap demo is not implemented for chain 'cheqd'.".to_string())
        }
    };

    let transfer_route = route_setup::setup_transfer_route(
        project_root_path,
        RouteEndpoint::new(RouteChain::Cardano, None),
        RouteEndpoint::new(route_chain, Some(network_label.to_string())),
    )?;

    logger::log("PASS: Direct token-transfer route is ready");
    for line in transfer_route.summary_lines() {
        logger::log(&format!("  {}", line));
    }

    match resolved_chain {
        OptionalChainId::Osmosis => run_direct_osmosis_token_swap(
            project_root_path,
            network_label,
            transfer_route.cardano_chain_id.as_str(),
            transfer_route.destination_chain_id.as_str(),
            transfer_route.direct_channel_pair.a_channel_id.as_str(),
            transfer_route.direct_channel_pair.b_channel_id.as_str(),
        ),
        OptionalChainId::Injective => run_direct_injective_token_swap(
            project_root_path,
            network_label,
            transfer_route.cardano_chain_id.as_str(),
            transfer_route.destination_chain_id.as_str(),
            transfer_route.direct_channel_pair.a_channel_id.as_str(),
            transfer_route.direct_channel_pair.b_channel_id.as_str(),
        ),
        OptionalChainId::Cheqd => unreachable!("cheqd token-swap returned earlier"),
    }
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

fn run_direct_injective_token_swap(
    project_root_path: &Path,
    network: &str,
    cardano_chain_id: &str,
    injective_chain_id: &str,
    cardano_injective_channel_id: &str,
    injective_cardano_channel_id: &str,
) -> Result<(), String> {
    let script_path = project_root_path
        .join("chains")
        .join("injective")
        .join("scripts")
        .join("run_direct_token_swap.sh");
    let script = script_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid run_direct_token_swap.sh path".to_string())?;
    let project_root = project_root_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid project root path".to_string())?;
    let injective_dir = project_root_path.join("chains").join("injective");
    let injective_dir = injective_dir
        .to_str()
        .ok_or_else(|| "ERROR: Invalid Injective path".to_string())?;

    execute_script(
        project_root_path,
        script,
        Vec::new(),
        Some(vec![
            ("CARIBIC_PROJECT_ROOT", project_root),
            ("CARIBIC_INJECTIVE_DIR", injective_dir),
            ("INJECTIVE_NETWORK", network),
            ("CARDANO_CHAIN_ID", cardano_chain_id),
            ("INJECTIVE_CHAIN_ID", injective_chain_id),
            ("CARDANO_INJECTIVE_CHANNEL_ID", cardano_injective_channel_id),
            ("INJECTIVE_CARDANO_CHANNEL_ID", injective_cardano_channel_id),
        ]),
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to run direct Injective token transfer demo: {}",
            error
        )
    })?;

    logger::log("PASS: Direct Cardano-to-Injective token transfer demo completed");
    Ok(())
}
