use crate::{chains, config, logger};

/// Lists core chains plus optional chain adapters and their supported networks/flags.
pub fn run_chains() -> Result<(), String> {
    let adapters = chains::registered_chain_adapters();

    logger::log("Supported chains:\n");

    logger::log(&format!(
        "{} (Cardano devnet)",
        config::get_config().chains.cardano.chain_id
    ));
    logger::log("  - network: local (managed) - Core local Cardano devnet used by the bridge");
    logger::log("");

    if adapters.is_empty() {
        return Ok(());
    }

    for adapter in adapters {
        logger::log(&format!("{} ({})", adapter.id(), adapter.display_name()));

        for network in adapter.supported_networks() {
            let managed_mode = if network.managed_by_caribic {
                "managed"
            } else {
                "external"
            };
            logger::log(&format!(
                "  - network: {} ({}) - {}",
                network.name, managed_mode, network.description
            ));

            let supported_flags = adapter.supported_flags(network.name);
            if supported_flags.is_empty() {
                continue;
            }

            for flag in supported_flags {
                let required_status = if flag.required {
                    "required"
                } else {
                    "optional"
                };
                logger::log(&format!(
                    "      flag: {} ({}) - {}",
                    flag.name, required_status, flag.description
                ));
            }
        }

        logger::log("");
    }

    Ok(())
}
