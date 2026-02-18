use std::path::Path;

use crate::chains::{self, ChainStartRequest};
use crate::{logger, ChainCommand};

/// Runs chain-scoped commands through registered chain adapters.
pub async fn run_chain(project_root_path: &Path, command: ChainCommand) -> Result<(), String> {
    match command {
        ChainCommand::Start {
            chain,
            network,
            chain_flag,
        } => {
            let adapter = chains::get_chain_adapter(chain.as_str())
                .ok_or_else(|| unknown_chain_message(chain.as_str()))?;
            let resolved_network = adapter.resolve_network(network.as_deref())?;
            let parsed_flags = chains::parse_chain_flags(chain_flag.as_slice())?;
            adapter.validate_flags(resolved_network.as_str(), &parsed_flags)?;

            let request = ChainStartRequest {
                network: resolved_network.as_str(),
                flags: &parsed_flags,
            };
            adapter.start(project_root_path, &request).await?;

            logger::log(&format!(
                "PASS: {} started for network '{}'",
                adapter.display_name(),
                resolved_network
            ));
        }
        ChainCommand::Stop {
            chain,
            network,
            chain_flag,
        } => {
            let adapter = chains::get_chain_adapter(chain.as_str())
                .ok_or_else(|| unknown_chain_message(chain.as_str()))?;
            let resolved_network = adapter.resolve_network(network.as_deref())?;
            let parsed_flags = chains::parse_chain_flags(chain_flag.as_slice())?;
            adapter.stop(project_root_path, resolved_network.as_str(), &parsed_flags)?;

            logger::log(&format!(
                "PASS: {} stopped for network '{}'",
                adapter.display_name(),
                resolved_network
            ));
        }
        ChainCommand::Health {
            chain,
            network,
            chain_flag,
        } => {
            let adapter = chains::get_chain_adapter(chain.as_str())
                .ok_or_else(|| unknown_chain_message(chain.as_str()))?;
            let resolved_network = adapter.resolve_network(network.as_deref())?;
            let parsed_flags = chains::parse_chain_flags(chain_flag.as_slice())?;
            let statuses =
                adapter.health(project_root_path, resolved_network.as_str(), &parsed_flags)?;

            logger::log(&format!(
                "{} health ({})",
                adapter.display_name(),
                resolved_network
            ));
            logger::log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

            let mut healthy_count = 0usize;
            let service_count = statuses.len();
            for status in statuses {
                if status.healthy {
                    healthy_count += 1;
                }
                let symbol = if status.healthy { "[OK]" } else { "[FAIL]" };
                logger::log(&format!("{} {}", symbol, status.label));
                logger::log(&format!("    {}", status.status));
                logger::log("");
            }

            logger::log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            if healthy_count == service_count {
                logger::log(&format!("All {} service(s) are healthy", service_count));
            } else {
                logger::log(&format!(
                    "WARNING: {}/{} service(s) healthy, {} need attention",
                    healthy_count,
                    service_count,
                    service_count.saturating_sub(healthy_count)
                ));
            }
        }
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
