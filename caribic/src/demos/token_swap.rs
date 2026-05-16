use std::path::Path;

use crate::start::OptionalChainId;

pub async fn run_token_swap_demo(
    _project_root_path: &Path,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
) -> Result<(), String> {
    let chain_label = chain
        .map(|chain| chain.adapter_id().to_string())
        .unwrap_or_else(|| "osmosis".to_string());
    let network_label = network.unwrap_or("local");

    Err(format!(
        "Token-swap demo for Cardano -> {chain_label} ({network_label}) is disabled because the intermediary-chain route has been phased out. Direct Cardano-to-target routes are not implemented yet."
    ))
}
