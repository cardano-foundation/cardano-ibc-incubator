use std::path::Path;

use crate::{
    logger,
    route_setup::{self, RouteChain, RouteEndpoint},
    start::OptionalChainId,
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

    Err(format!(
        "Token-swap route setup for Cardano -> {} ({network_label}) now uses a direct channel, but the swap contract execution script still needs to be ported from the retired intermediary topology.",
        resolved_chain.adapter_id()
    ))
}
