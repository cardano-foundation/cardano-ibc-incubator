use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::{
    logger,
    start::{self, configure_hermes, run_hermes_command},
    stop::{stop_osmosis, stop_relayer},
    utils::{
        execute_script, get_osmosis_dir, parse_tendermint_client_id, parse_tendermint_connection_id,
    },
    DemoType,
};

/// Dispatches demo execution to token swap or message exchange flows.
pub async fn run_demo(use_case: DemoType, project_root_path: &Path) -> Result<(), String> {
    match use_case {
        DemoType::TokenSwap => run_token_swap(project_root_path).await,
        DemoType::MessageExchange => run_message_exchange(project_root_path).await,
    }
}

/// Runs the full token swap demo and validates required services before execution.
async fn run_token_swap(project_root_path: &Path) -> Result<(), String> {
    let osmosis_dir = get_osmosis_dir(project_root_path);
    logger::verbose(&format!("{}", osmosis_dir.display()));

    let required_services = [
        "gateway", "cardano", "postgres", "kupo", "ogmios", "hermes", "mithril", "cosmos",
        "osmosis", "redis",
    ];
    if let Err(error) =
        ensure_demo_services_ready(project_root_path, &required_services, "token-swap")
    {
        return fail_with_cleanup(osmosis_dir.as_path(), &error);
    }

    logger::log("PASS: Required token-swap services are running");

    logger::verbose("Checking Mithril artifact readiness before setting up transfer paths");
    wait_for_mithril_artifacts_for_demo().await?;

    let relayer_path = project_root_path.join("relayer");
    let mut restart_relayer_after_setup = false;
    if let Ok((true, _)) = start::check_service_health(project_root_path, "hermes") {
        logger::verbose(
            "Stopping Hermes daemon during token-swap setup to avoid account sequence contention",
        );
        stop_relayer(relayer_path.as_path());
        restart_relayer_after_setup = true;
    }

    if let Err(error) = ensure_cardano_entrypoint_transfer_channel() {
        return fail_with_cleanup(
            osmosis_dir.as_path(),
            &format!(
                "ERROR: Failed to prepare Cardano↔Entrypoint transfer path: {}",
                error
            ),
        );
    }

    match configure_hermes(osmosis_dir.as_path()) {
        Ok(_) => logger::log("PASS: Hermes configured successfully and channels built"),
        Err(error) => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                &format!("ERROR: Failed to configure Hermes: {}", error),
            )
        }
    }

    if restart_relayer_after_setup {
        match start::start_hermes_daemon() {
            Ok(_) => logger::log("PASS: Hermes daemon restarted for token relay"),
            Err(error) => {
                return fail_with_cleanup(
                    osmosis_dir.as_path(),
                    &format!("ERROR: Failed to restart Hermes daemon: {}", error),
                )
            }
        }
    }

    let setup_script_path = osmosis_dir
        .join("scripts")
        .join("setup_crosschain_swaps.sh");
    let setup_script = setup_script_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid setup_crosschain_swaps.sh path".to_string())?;

    let setup_output = match execute_script(
        project_root_path,
        setup_script,
        Vec::new(),
        Some(vec![("CARIBIC_CLEAR_SWAP_PACKETS", "true")]),
    ) {
        Ok(output) => {
            logger::log("\nPASS: Token swap demo setup script completed");
            output
        }
        Err(error) => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                &format!("ERROR: Failed to run token swap setup script: {}", error),
            );
        }
    };

    let crosschain_swaps_address = match setup_output
        .lines()
        .filter_map(|line| line.trim().split_once("crosschain_swaps address:"))
        .map(|(_, value)| value.trim().to_string())
        .find(|value| !value.is_empty())
    {
        Some(address) => address,
        None => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                "ERROR: Could not parse crosschain_swaps address from setup script output",
            )
        }
    };

    logger::log(&format!(
        "PASS: Token swap setup produced crosschain_swaps address {}",
        crosschain_swaps_address
    ));

    let swap_script = project_root_path.join("swap.sh");
    let swap_script = swap_script
        .to_str()
        .ok_or_else(|| "ERROR: Invalid swap.sh path".to_string())?;

    execute_script(
        project_root_path,
        swap_script,
        Vec::new(),
        Some(vec![(
            "CROSSCHAIN_SWAPS_ADDRESS",
            crosschain_swaps_address.as_str(),
        )]),
    )
    .map_err(|error| format!("ERROR: Failed to run token swap transfer script: {}", error))?;
    logger::log("PASS: Cardano-to-Osmosis token swap completed");
    logger::log("\nPASS: Token swap demo flow completed successfully");

    Ok(())
}

/// Starts the message exchange demo chain and relayer services.
async fn run_message_exchange(project_root_path: &Path) -> Result<(), String> {
    let project_config = crate::config::get_config();
    let chain_root_path = project_root_path.join("chains/summit-demo/");

    let cosmos_chain_repo_url = format!(
        "{}/archive/refs/heads/{}.zip",
        project_config.vessel_oracle.repo_base_url, project_config.vessel_oracle.target_branch
    );

    match start::start_cosmos_entrypoint_chain_from_repository(
        &cosmos_chain_repo_url,
        chain_root_path.as_path(),
    )
    .await
    {
        Ok(_) => logger::log("PASS: Cosmos Entrypoint chain up and running"),
        Err(error) => {
            return Err(format!(
                "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                error
            ))
        }
    }

    match start::start_relayer(
        project_root_path.join("relayer").as_path(),
        chain_root_path.join("relayer/.env.relayer").as_path(),
        chain_root_path.join("relayer/config").as_path(),
        project_root_path
            .join("cardano/offchain/deployments/handler.json")
            .as_path(),
    ) {
        Ok(_) => logger::log("PASS: Relayer started successfully"),
        Err(error) => return Err(format!("ERROR: Failed to start relayer: {}", error)),
    }

    logger::log("\nPASS: Message exchange demo services started successfully");

    Ok(())
}

/// Ensures all services required by a demo flow are healthy before continuing.
fn ensure_demo_services_ready(
    project_root_path: &Path,
    required_services: &[&str],
    use_case_label: &str,
) -> Result<(), String> {
    let mut failures = Vec::new();

    for service in required_services {
        match start::check_service_health(project_root_path, service) {
            Ok((true, _)) => {}
            Ok((false, status)) => failures.push(format!("{service}: {status}")),
            Err(error) => failures.push(format!("{service}: {error}")),
        }
    }

    if failures.is_empty() {
        return Ok(());
    }

    let mut message =
        format!("ERROR: The {use_case_label} demo prerequisite services are not running.\n");
    for failure in failures {
        message.push_str(&format!("  - {failure}\n"));
    }
    message.push_str(
        "\nStart services first:\n  - caribic start --clean --with-mithril\n  - caribic start osmosis",
    );

    Err(message)
}

/// Waits until Mithril exposes stake and transaction artifacts needed by demo client creation.
async fn wait_for_mithril_artifacts_for_demo() -> Result<(), String> {
    logger::verbose("Waiting for Mithril stake distributions and cardano-transactions artifacts");
    let aggregator_base_url = crate::config::get_config()
        .mithril
        .aggregator_url
        .trim_end_matches('/')
        .to_string();
    let stake_distributions_url =
        format!("{aggregator_base_url}/aggregator/artifact/mithril-stake-distributions");
    let cardano_transactions_url =
        format!("{aggregator_base_url}/aggregator/artifact/cardano-transactions");

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .expect("Failed to build reqwest client for Mithril artifact check");

    for attempt in 1..=36 {
        let stake_ready = match client.get(stake_distributions_url.as_str()).send().await {
            Ok(response) if response.status().is_success() => response
                .json::<Value>()
                .await
                .ok()
                .and_then(|value| value.as_array().map(|arr| arr.len()))
                .is_some_and(|len| len > 0),
            _ => false,
        };
        let tx_ready = match client.get(cardano_transactions_url.as_str()).send().await {
            Ok(response) if response.status().is_success() => response
                .json::<Value>()
                .await
                .ok()
                .and_then(|value| value.as_array().map(|arr| arr.len()))
                .is_some_and(|len| len > 0),
            _ => false,
        };

        logger::verbose(&format!(
            "Mithril artifact readiness check (attempt {attempt}/36): stake_distributions={stake_ready}, cardano_transactions={tx_ready}"
        ));

        if stake_ready && tx_ready {
            logger::log("PASS: Mithril artifacts are available");
            return Ok(());
        }

        tokio::time::sleep(Duration::from_secs(5)).await;
    }

    Err(format!(
        "Mithril artifacts did not become available in time. Cardano↔Entrypoint client creation may fail.\n\
         Checked endpoints:\n\
         - {}\n\
         - {}",
        stake_distributions_url, cardano_transactions_url
    ))
}

/// Returns a transfer channel id only for entries that belong to transfer port routing.
fn extract_transfer_channel_id(entry: &Value) -> Option<String> {
    let local_port = entry.get("port_id").and_then(Value::as_str);
    let remote_port = entry
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str);
    if !(matches!(local_port, Some("transfer")) || matches!(remote_port, Some("transfer"))) {
        return None;
    }

    let channel_id = entry
        .get("channel_id")
        .and_then(Value::as_str)
        .or_else(|| entry.get("channel_a").and_then(Value::as_str))?;
    if channel_id.starts_with("channel-") {
        Some(channel_id.to_string())
    } else {
        None
    }
}

/// Queries Hermes for the latest Cardano to Entrypoint transfer channel id.
fn query_cardano_entrypoint_channel() -> Result<Option<String>, String> {
    let output = run_hermes_command(&[
        "--json",
        "query",
        "channels",
        "--chain",
        "cardano-devnet",
        "--counterparty-chain",
        "sidechain",
    ])
    .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Hermes query channels for Cardano-Entrypoint chain pair failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();

    let chain_channels = parsed_lines
        .iter()
        .filter_map(|entry| match entry.get("result") {
            Some(result) if result.is_array() => result.as_array(),
            Some(result) if result.is_object() => result.get("channels").and_then(Value::as_array),
            _ => None,
        })
        .next_back();

    if let Some(channels) = chain_channels {
        logger::verbose(&format!(
            "Hermes query returned {} chain channels on cardano-devnet↔sidechain",
            channels.len()
        ));
    } else {
        logger::verbose("Hermes query returned no channel list for cardano-devnet↔sidechain");
    }

    if let Some(channels) = chain_channels {
        for entry in channels.iter().rev() {
            if let Some(channel_id) = extract_transfer_channel_id(entry) {
                return Ok(Some(channel_id));
            }
        }
    }

    Ok(None)
}

/// Ensures the Cardano to Entrypoint transfer path exists by creating client, connection, and channel as needed.
fn ensure_cardano_entrypoint_transfer_channel() -> Result<(), String> {
    if query_cardano_entrypoint_channel()?.is_some() {
        logger::log("PASS: Cardano->Entrypoint transfer channel already exists");
        return Ok(());
    }

    logger::log("No Cardano->Entrypoint transfer channel detected. Creating one now.");
    logger::verbose("No Cardano->Entrypoint transfer channel exists. Creating one now.");
    logger::verbose("Creating Cardano-devnet client with sidechain reference");

    let create_cardano_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        "cardano-devnet",
        "--reference-chain",
        "sidechain",
    ])
    .map_err(|error| error.to_string())?;
    if !create_cardano_client_output.status.success() {
        return Err(format!(
            "Failed to create client for cardano-devnet->sidechain: {}",
            String::from_utf8_lossy(&create_cardano_client_output.stderr)
        ));
    }
    let cardano_client_stdout =
        String::from_utf8_lossy(&create_cardano_client_output.stdout).to_string();
    let cardano_client_id =
        parse_tendermint_client_id(&cardano_client_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano->Entrypoint client id from Hermes output:\n{}",
                cardano_client_stdout
            )
        })?;
    logger::verbose(&format!(
        "Parsed cardano-devnet client id: {cardano_client_id}"
    ));

    logger::verbose("Creating sidechain client with cardano-devnet reference");
    let create_entrypoint_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        "sidechain",
        "--reference-chain",
        "cardano-devnet",
    ])
    .map_err(|error| error.to_string())?;
    if !create_entrypoint_client_output.status.success() {
        return Err(format!(
            "Failed to create client for sidechain->cardano-devnet: {}",
            String::from_utf8_lossy(&create_entrypoint_client_output.stderr)
        ));
    }
    let entrypoint_client_stdout =
        String::from_utf8_lossy(&create_entrypoint_client_output.stdout).to_string();
    let entrypoint_client_id =
        parse_tendermint_client_id(&entrypoint_client_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Entrypoint->Cardano client id from Hermes output:\n{}",
                entrypoint_client_stdout
            )
        })?;
    logger::verbose(&format!(
        "Parsed sidechain client id: {entrypoint_client_id}"
    ));

    logger::verbose("Creating Cardano<->Entrypoint connection");
    let create_connection_output = run_hermes_command(&[
        "create",
        "connection",
        "--a-chain",
        "cardano-devnet",
        "--a-client",
        cardano_client_id.as_str(),
        "--b-client",
        entrypoint_client_id.as_str(),
    ])
    .map_err(|error| error.to_string())?;
    if !create_connection_output.status.success() {
        return Err(format!(
            "Failed to create Cardano-Entrypoint connection: {}",
            String::from_utf8_lossy(&create_connection_output.stderr)
        ));
    }
    let create_connection_stdout =
        String::from_utf8_lossy(&create_connection_output.stdout).to_string();
    let connection_id =
        parse_tendermint_connection_id(&create_connection_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano-Entrypoint connection id from Hermes output:\n{}",
                create_connection_stdout
            )
        })?;
    logger::verbose(&format!("Parsed connection id: {connection_id}"));

    logger::verbose("Creating transfer channel on the Cardano↔Entrypoint connection");
    logger::verbose(&format!(
        "Creating transfer channel on connection {connection_id} (Cardano↔Entrypoint)"
    ));
    let create_channel_output = run_hermes_command(&[
        "create",
        "channel",
        "--a-chain",
        "cardano-devnet",
        "--a-connection",
        connection_id.as_str(),
        "--a-port",
        "transfer",
        "--b-port",
        "transfer",
    ])
    .map_err(|error| error.to_string())?;
    if !create_channel_output.status.success() {
        return Err(format!(
            "Failed to create Cardano-Entrypoint transfer channel: {}",
            String::from_utf8_lossy(&create_channel_output.stderr)
        ));
    }

    logger::log("PASS: Created Cardano<->Entrypoint transfer channel for token-swap demo");
    Ok(())
}

/// Logs an error, stops Osmosis demo services, and returns the original error message.
fn fail_with_cleanup(osmosis_dir: &Path, message: &str) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    stop_osmosis(osmosis_dir);
    Err(message.to_string())
}
