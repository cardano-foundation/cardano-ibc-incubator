use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use crate::{
    chains::osmosis::{configure_hermes_for_demo, stop_local, workspace_dir},
    logger,
    start::{self, run_hermes_command},
    stop::stop_relayer,
    utils::{execute_script, parse_tendermint_client_id, parse_tendermint_connection_id},
    DemoType,
};

const ENTRYPOINT_CHAIN_ID: &str = "entrypoint";

/// Dispatches demo execution to token swap or message exchange flows.
pub async fn run_demo(use_case: DemoType, project_root_path: &Path) -> Result<(), String> {
    match use_case {
        DemoType::TokenSwap => run_token_swap(project_root_path).await,
        DemoType::MessageExchange => run_message_exchange(project_root_path).await,
    }
}

/// Runs the full token swap demo and validates required services before execution.
async fn run_token_swap(project_root_path: &Path) -> Result<(), String> {
    let osmosis_dir = workspace_dir(project_root_path);
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
    // Hermes client creation against Cardano depends on Mithril artifact availability.
    // Running this check up front gives a deterministic failure reason instead of
    // failing later deep inside channel setup.
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

    match configure_hermes_for_demo(osmosis_dir.as_path()) {
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

    // First stage script wires Osmosis-side contracts and creates the incoming routing path
    // for Cardano vouchers. We parse its stdout to recover the deployed contract address
    // needed by the final swap trigger script.
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

    // Second stage script actually submits the swap transfer using the contract address
    // returned by setup. Passing it as an env var avoids brittle parsing in the shell layer.
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

#[derive(Debug, Clone)]
struct TransferChannelEndStatus {
    state: String,
    remote_channel_id: Option<String>,
    remote_port_id: Option<String>,
}

fn parse_channel_sequence(channel_id: &str) -> Option<u64> {
    channel_id.strip_prefix("channel-")?.parse::<u64>().ok()
}

#[derive(Debug, Clone)]
struct ConnectionEndStatus {
    state: String,
    client_id: Option<String>,
    remote_client_id: Option<String>,
    remote_connection_id: Option<String>,
}

fn parse_connection_sequence(connection_id: &str) -> Option<u64> {
    connection_id
        .strip_prefix("connection-")?
        .parse::<u64>()
        .ok()
}

/// Queries a transfer channel end and returns only the fields needed for open-state validation.
///
/// This is intentionally stricter than "channel exists":
/// token swap transfers can only run on fully open channels, and stale Init/TryOpen channels
/// frequently remain in local dev environments after interrupted handshakes.
fn query_transfer_channel_end_status(
    chain_id: &str,
    channel_id: &str,
) -> Result<Option<TransferChannelEndStatus>, String> {
    let output = run_hermes_command(&[
        "--json",
        "query",
        "channel",
        "end",
        "--chain",
        chain_id,
        "--port",
        "transfer",
        "--channel",
        channel_id,
    ])
    .map_err(|error| error.to_string())?;

    if !output.status.success() {
        logger::verbose(&format!(
            "Hermes query channel end failed for chain={chain_id}, channel={channel_id}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
        return Ok(None);
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();
    let Some(result) = parsed_lines
        .iter()
        .filter_map(|entry| entry.get("result"))
        .next_back()
    else {
        logger::verbose(&format!(
            "Hermes query channel end returned no result object for chain={chain_id}, channel={channel_id}",
        ));
        return Ok(None);
    };

    let state = result
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if state.is_empty() {
        logger::verbose(&format!(
            "Hermes query channel end returned empty state for chain={chain_id}, channel={channel_id}",
        ));
        return Ok(None);
    }

    let remote = result.get("remote");
    let remote_channel_id = remote
        .and_then(|remote| remote.get("channel_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let remote_port_id = remote
        .and_then(|remote| remote.get("port_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Ok(Some(TransferChannelEndStatus {
        state,
        remote_channel_id,
        remote_port_id,
    }))
}

fn is_open_transfer_state(state: &str) -> bool {
    state.eq_ignore_ascii_case("open")
}

/// Queries all connection ids known by Hermes for one chain.
fn query_connection_ids_for_chain(chain_id: &str) -> Result<Vec<String>, String> {
    let output = run_hermes_command(&["--json", "query", "connections", "--chain", chain_id])
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Hermes query connections failed for chain={chain_id}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();

    let mut connection_ids = Vec::new();
    for result in parsed_lines.iter().filter_map(|entry| entry.get("result")) {
        if let Some(array) = result.as_array() {
            for item in array {
                if let Some(connection_id) = item.as_str() {
                    if connection_id.starts_with("connection-") {
                        connection_ids.push(connection_id.to_string());
                    }
                    continue;
                }
                if let Some(connection_id) = item.get("connection_id").and_then(Value::as_str) {
                    if connection_id.starts_with("connection-") {
                        connection_ids.push(connection_id.to_string());
                    }
                }
            }
            continue;
        }

        if let Some(array) = result.get("connections").and_then(Value::as_array) {
            for item in array {
                if let Some(connection_id) = item.get("connection_id").and_then(Value::as_str) {
                    if connection_id.starts_with("connection-") {
                        connection_ids.push(connection_id.to_string());
                    }
                }
            }
        }
    }

    connection_ids.sort_by(|left, right| {
        let left_seq = parse_connection_sequence(left).unwrap_or(0);
        let right_seq = parse_connection_sequence(right).unwrap_or(0);
        right_seq.cmp(&left_seq).then_with(|| right.cmp(left))
    });
    connection_ids.dedup();
    Ok(connection_ids)
}

/// Queries one connection end and extracts only the fields required for deterministic validation.
fn query_connection_end_status(
    chain_id: &str,
    connection_id: &str,
) -> Result<Option<ConnectionEndStatus>, String> {
    let output = run_hermes_command(&[
        "--json",
        "query",
        "connection",
        "end",
        "--chain",
        chain_id,
        "--connection",
        connection_id,
    ])
    .map_err(|error| error.to_string())?;

    if !output.status.success() {
        logger::verbose(&format!(
            "Hermes query connection end failed for chain={chain_id}, connection={connection_id}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
        return Ok(None);
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();
    let Some(result) = parsed_lines
        .iter()
        .filter_map(|entry| entry.get("result"))
        .next_back()
    else {
        logger::verbose(&format!(
            "Hermes query connection end returned no result object for chain={chain_id}, connection={connection_id}",
        ));
        return Ok(None);
    };

    let state = result
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if state.is_empty() {
        logger::verbose(&format!(
            "Hermes query connection end returned empty state for chain={chain_id}, connection={connection_id}",
        ));
        return Ok(None);
    }

    let client_id = result
        .get("client_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let counterparty = result.get("counterparty");
    let remote_client_id = counterparty
        .and_then(|value| value.get("client_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let remote_connection_id = counterparty
        .and_then(|value| value.get("connection_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Ok(Some(ConnectionEndStatus {
        state,
        client_id,
        remote_client_id,
        remote_connection_id,
    }))
}

/// Verifies that a Cardano connection is fully open and symmetric with the Entrypoint chain.
///
/// This check is intentionally strict:
/// - Both ends must be Open
/// - Counterparty connection ids must point back to each other
/// - Client ids must be present on both ends
///
/// Using only fully-open symmetric connections avoids non-deterministic behavior where
/// partially-created handshakes remain in state and break later channel operations.
fn is_open_cardano_entrypoint_connection(cardano_connection_id: &str) -> Result<bool, String> {
    let Some(cardano_end) = query_connection_end_status("cardano-devnet", cardano_connection_id)?
    else {
        return Ok(false);
    };
    if !is_open_transfer_state(&cardano_end.state) {
        logger::verbose(&format!(
            "Skipping cardano-devnet connection {cardano_connection_id}: state={} (expected Open)",
            cardano_end.state
        ));
        return Ok(false);
    }

    let Some(entrypoint_connection_id) = cardano_end.remote_connection_id.as_deref() else {
        logger::verbose(&format!(
            "Skipping cardano-devnet connection {cardano_connection_id}: missing counterparty connection id"
        ));
        return Ok(false);
    };
    let Some(entrypoint_end) =
        query_connection_end_status(ENTRYPOINT_CHAIN_ID, entrypoint_connection_id)?
    else {
        return Ok(false);
    };
    if !is_open_transfer_state(&entrypoint_end.state) {
        logger::verbose(&format!(
            "Skipping cardano-devnet connection {cardano_connection_id}: entrypoint counterparty {} is {} (expected Open)",
            entrypoint_connection_id, entrypoint_end.state
        ));
        return Ok(false);
    }
    if entrypoint_end.remote_connection_id.as_deref() != Some(cardano_connection_id) {
        logger::verbose(&format!(
            "Skipping cardano-devnet connection {cardano_connection_id}: entrypoint counterparty {} does not point back to it",
            entrypoint_connection_id
        ));
        return Ok(false);
    }
    if cardano_end.client_id.is_none()
        || cardano_end.remote_client_id.is_none()
        || entrypoint_end.client_id.is_none()
        || entrypoint_end.remote_client_id.is_none()
    {
        logger::verbose(&format!(
            "Skipping cardano-devnet connection {cardano_connection_id}: missing client identifiers on one or both ends"
        ));
        return Ok(false);
    }
    Ok(true)
}

/// Selects the newest fully-open Cardano↔Entrypoint connection, if one exists.
fn query_cardano_entrypoint_open_connection() -> Result<Option<String>, String> {
    let candidate_connection_ids = query_connection_ids_for_chain("cardano-devnet")?;
    logger::verbose(&format!(
        "Hermes query returned {} cardano-devnet connection candidates",
        candidate_connection_ids.len()
    ));

    for connection_id in candidate_connection_ids {
        if is_open_cardano_entrypoint_connection(connection_id.as_str())? {
            return Ok(Some(connection_id));
        }
    }

    Ok(None)
}

/// Verifies that a Cardano transfer channel is truly usable for swaps.
///
/// Validation rules:
/// - Cardano side must be `Open`
/// - Counterparty channel id must exist
/// - Entrypoint counterparty must be `Open`
/// - Counterparty channel must point back to the same Cardano channel id
/// - Both ends must use transfer port routing
///
/// This prevents selecting stale channel ids that exist but are not open.
fn is_open_cardano_entrypoint_transfer_channel(cardano_channel_id: &str) -> Result<bool, String> {
    let Some(cardano_end) =
        query_transfer_channel_end_status("cardano-devnet", cardano_channel_id)?
    else {
        return Ok(false);
    };

    if !is_open_transfer_state(&cardano_end.state) {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: state={} (expected Open)",
            cardano_end.state
        ));
        return Ok(false);
    }

    if cardano_end.remote_port_id.as_deref() != Some("transfer") {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: counterparty port is not transfer",
        ));
        return Ok(false);
    }

    let Some(entrypoint_channel_id) = cardano_end.remote_channel_id else {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: missing counterparty channel id",
        ));
        return Ok(false);
    };

    let Some(entrypoint_end) =
        query_transfer_channel_end_status(ENTRYPOINT_CHAIN_ID, entrypoint_channel_id.as_str())?
    else {
        return Ok(false);
    };

    if !is_open_transfer_state(&entrypoint_end.state) {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: entrypoint counterparty {} is {} (expected Open)",
            entrypoint_channel_id, entrypoint_end.state
        ));
        return Ok(false);
    }

    if entrypoint_end.remote_port_id.as_deref() != Some("transfer") {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: entrypoint counterparty {} port is not transfer",
            entrypoint_channel_id
        ));
        return Ok(false);
    }

    if entrypoint_end.remote_channel_id.as_deref() != Some(cardano_channel_id) {
        logger::verbose(&format!(
            "Skipping cardano-devnet channel {cardano_channel_id}: entrypoint counterparty {} does not point back to it",
            entrypoint_channel_id
        ));
        return Ok(false);
    }

    Ok(true)
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
        ENTRYPOINT_CHAIN_ID,
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
            "Hermes query returned {} chain channels on cardano-devnet↔entrypoint",
            channels.len()
        ));
    } else {
        logger::verbose("Hermes query returned no channel list for cardano-devnet↔entrypoint");
    }

    if let Some(channels) = chain_channels {
        // Important: channel existence is not enough for token transfers.
        // Interrupted handshakes leave stale channel ids in Init/TryOpen state.
        // We collect every transfer channel candidate first, then validate each one
        // against both chain ends and only accept channels that are Open on both sides.
        let mut candidate_channel_ids: Vec<String> = channels
            .iter()
            .filter_map(extract_transfer_channel_id)
            .collect();

        // Prefer newer channel ids first because local dev runs often create multiple
        // channels over time after resets, failed handshakes, or interrupted demos.
        candidate_channel_ids.sort_by(|left, right| {
            let left_seq = parse_channel_sequence(left).unwrap_or(0);
            let right_seq = parse_channel_sequence(right).unwrap_or(0);
            right_seq.cmp(&left_seq).then_with(|| right.cmp(left))
        });
        candidate_channel_ids.dedup();

        for channel_id in candidate_channel_ids {
            if is_open_cardano_entrypoint_transfer_channel(channel_id.as_str())? {
                return Ok(Some(channel_id));
            }
        }
    }

    Ok(None)
}

fn create_cardano_entrypoint_transfer_channel_on_connection(
    connection_id: &str,
) -> Result<(), String> {
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
        connection_id,
        "--a-port",
        "transfer",
        "--b-port",
        "transfer",
    ])
    .map_err(|error| error.to_string())?;
    if !create_channel_output.status.success() {
        return Err(format!(
            "Failed to create Cardano-Entrypoint transfer channel on connection {}: {}",
            connection_id,
            String::from_utf8_lossy(&create_channel_output.stderr)
        ));
    }
    Ok(())
}

/// Ensures the Cardano to Entrypoint transfer path exists by creating client, connection, and channel as needed.
fn ensure_cardano_entrypoint_transfer_channel() -> Result<(), String> {
    if let Some(open_channel_id) = query_cardano_entrypoint_channel()? {
        logger::log(&format!(
            "PASS: Cardano->Entrypoint transfer channel already exists and is open ({open_channel_id})"
        ));
        return Ok(());
    }

    logger::log("No open Cardano->Entrypoint transfer channel detected. Creating one now.");
    logger::verbose("No open Cardano->Entrypoint transfer channel exists. Creating one now.");

    if let Some(existing_open_connection_id) = query_cardano_entrypoint_open_connection()? {
        logger::verbose(&format!(
            "Found existing open Cardano↔Entrypoint connection {}; creating transfer channel on it",
            existing_open_connection_id
        ));
        create_cardano_entrypoint_transfer_channel_on_connection(
            existing_open_connection_id.as_str(),
        )?;

        let Some(open_channel_id) = query_cardano_entrypoint_channel()? else {
            return Err(
                "Created transfer channel on an open Cardano↔Entrypoint connection, but no open transfer channel is currently usable".to_string(),
            );
        };
        logger::log(&format!(
            "PASS: Created Cardano<->Entrypoint transfer channel for token-swap demo ({open_channel_id})"
        ));
        return Ok(());
    }

    logger::verbose("Creating Cardano-devnet client with entrypoint reference");

    let create_cardano_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        "cardano-devnet",
        "--reference-chain",
        ENTRYPOINT_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !create_cardano_client_output.status.success() {
        return Err(format!(
            "Failed to create client for cardano-devnet->entrypoint: {}",
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

    logger::verbose("Creating entrypoint client with cardano-devnet reference");
    let create_entrypoint_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        ENTRYPOINT_CHAIN_ID,
        "--reference-chain",
        "cardano-devnet",
    ])
    .map_err(|error| error.to_string())?;
    if !create_entrypoint_client_output.status.success() {
        return Err(format!(
            "Failed to create client for entrypoint->cardano-devnet: {}",
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
        "Parsed entrypoint client id: {entrypoint_client_id}"
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

    create_cardano_entrypoint_transfer_channel_on_connection(connection_id.as_str())?;

    // Validate post-creation state explicitly so we fail fast with a clear reason
    // instead of continuing into the swap script with a non-open channel id.
    let Some(open_channel_id) = query_cardano_entrypoint_channel()? else {
        return Err(
            "Created Cardano↔Entrypoint channel artifacts but no open transfer channel is currently usable".to_string(),
        );
    };

    logger::log(&format!(
        "PASS: Created Cardano<->Entrypoint transfer channel for token-swap demo ({open_channel_id})"
    ));
    Ok(())
}

/// Logs an error, stops Osmosis demo services, and returns the original error message.
fn fail_with_cleanup(osmosis_dir: &Path, message: &str) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    stop_local(osmosis_dir);
    Err(message.to_string())
}
