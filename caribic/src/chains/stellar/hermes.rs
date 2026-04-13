use crate::chains::hermes_support;
use crate::logger::verbose;

/// Best-effort sync of the local Stellar chain block into Hermes config.
///
/// Hermes Stellar support is still in progress (PRs 3–7 not yet merged on the
/// `feat/stellar-integration` branch). This function inserts a placeholder Stellar
/// chain block into `~/.hermes/config.toml` so that once the Hermes fork is rebuilt
/// with full Stellar support, the chain is already present in the config.
///
/// Returns `Ok(())` early if `~/.hermes/config.toml` does not exist yet (relayer not
/// set up), so that `caribic start stellar` never fails due to a missing Hermes config.
pub(super) fn sync_local_chain_with_hermes() -> Result<(), Box<dyn std::error::Error>> {
    if hermes_support::hermes_config_path().is_none() {
        verbose("Hermes config not found — skipping Stellar chain block insertion");
        return Ok(());
    }

    ensure_local_chain_in_hermes_config()
}

fn ensure_local_chain_in_hermes_config() -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use dirs::home_dir;

    let home_path = home_dir().ok_or("Could not determine home directory")?;
    let destination_config_path = home_path.join(".hermes/config.toml");

    let mut destination_config =
        fs::read_to_string(&destination_config_path).map_err(|error| {
            format!(
                "Failed to read Hermes config at {}: {}",
                destination_config_path.display(),
                error
            )
        })?;

    let chain_id = super::config::LOCAL_CHAIN_ID;

    // Avoid duplicate blocks.
    if destination_config.contains(&format!("id = '{chain_id}'"))
        || destination_config.contains(&format!("id = \"{chain_id}\""))
    {
        verbose(&format!(
            "Stellar chain '{}' is already present in Hermes config — skipping",
            chain_id
        ));
        return Ok(());
    }

    let chain_block = render_stellar_chain_block();

    if !destination_config.ends_with('\n') {
        destination_config.push('\n');
    }
    destination_config.push('\n');
    destination_config.push_str("# Local Stellar chain managed by caribic (Soroban RPC + IBC contract)\n");
    destination_config.push_str(&chain_block);
    destination_config.push('\n');

    fs::write(&destination_config_path, destination_config).map_err(|error| {
        format!(
            "Failed to update Hermes config at {}: {}",
            destination_config_path.display(),
            error
        )
    })?;

    verbose(&format!(
        "Added Stellar chain '{}' to Hermes config at {}",
        chain_id,
        destination_config_path.display()
    ));

    Ok(())
}

fn render_stellar_chain_block() -> String {
    use super::config;
    format!(
        r#"[[chains]]
type = 'Stellar'
id = '{chain_id}'
rpc_url = '{rpc_url}'
network_passphrase = 'Standalone Network ; February 2017'
ibc_contract_id = 'C000000000000000000000000000000000000000000000000000000000000000'
key_name = 'stellar-relayer'
key_store_type = 'Test'
max_block_time = '10s'
clock_drift = '5s'
event_poll_interval = '3s'

[chains.packet_filter]
policy = 'allow'
list = [['transfer', '*']]
"#,
        chain_id = config::LOCAL_CHAIN_ID,
        rpc_url = config::LOCAL_SOROBAN_RPC_URL,
    )
}
