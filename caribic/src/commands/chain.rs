use std::path::Path;

use crate::chains::{self, ChainStartRequest};

pub async fn start_optional_chain(
    project_root_path: &Path,
    chain_id: &str,
    network: Option<&str>,
    chain_flags: &[String],
) -> Result<(String, String), String> {
    let adapter =
        chains::get_chain_adapter(chain_id).ok_or_else(|| unknown_chain_message(chain_id))?;
    let resolved_network = adapter.resolve_network(network)?;
    let parsed_flags = chains::parse_chain_flags(chain_flags)?;
    adapter.validate_flags(resolved_network.as_str(), &parsed_flags)?;

    let request = ChainStartRequest {
        network: resolved_network.as_str(),
        flags: &parsed_flags,
    };
    adapter.start(project_root_path, &request).await?;

    Ok((adapter.display_name().to_string(), resolved_network))
}

pub fn stop_optional_chain(
    project_root_path: &Path,
    chain_id: &str,
    network: Option<&str>,
    chain_flags: &[String],
) -> Result<(String, String), String> {
    let adapter =
        chains::get_chain_adapter(chain_id).ok_or_else(|| unknown_chain_message(chain_id))?;
    let resolved_network = adapter.resolve_network(network)?;
    let parsed_flags = chains::parse_chain_flags(chain_flags)?;
    adapter.stop(project_root_path, resolved_network.as_str(), &parsed_flags)?;

    Ok((adapter.display_name().to_string(), resolved_network))
}

pub fn stop_all_managed_optional_chain_networks(
    project_root_path: &Path,
    chain_id: &str,
) -> Result<(), String> {
    let adapter =
        chains::get_chain_adapter(chain_id).ok_or_else(|| unknown_chain_message(chain_id))?;

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

fn unknown_chain_message(chain_id: &str) -> String {
    let supported_chains = chains::registered_chain_adapters()
        .iter()
        .map(|adapter| adapter.id())
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Unknown chain '{}'. Supported chains: {}",
        chain_id, supported_chains
    )
}
