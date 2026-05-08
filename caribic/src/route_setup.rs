use std::path::Path;
use std::process::Output;
use std::time::Duration;

use serde_json::Value;

use crate::{
    chains::{
        injective::{
            configure_hermes_for_demo as configure_injective_hermes_for_demo,
            configure_hermes_for_testnet_demo as configure_injective_hermes_for_testnet_demo,
            local_chain_id as injective_local_chain_id,
            testnet_chain_id as injective_testnet_chain_id,
            workspace_dir as injective_workspace_dir,
        },
        osmosis::{
            configure_hermes_for_demo as configure_osmosis_hermes_for_demo,
            demo_chain_id as osmosis_demo_chain_id,
            sync_workspace_assets as sync_osmosis_workspace_assets,
            workspace_dir as osmosis_workspace_dir,
        },
    },
    config, logger,
    start::{run_hermes_command, run_hermes_command_with_timeout},
    utils::{parse_tendermint_client_id, parse_tendermint_connection_id},
};

const TRANSFER_PORT_ID: &str = "transfer";
const HERMES_CARDANO_QUERY_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteChain {
    Cardano,
    Injective,
    Osmosis,
}

impl RouteChain {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Cardano => "Cardano",
            Self::Injective => "Injective",
            Self::Osmosis => "Osmosis",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RouteEndpoint {
    pub chain: RouteChain,
    pub network: Option<String>,
}

impl RouteEndpoint {
    pub fn new(chain: RouteChain, network: Option<String>) -> Self {
        Self { chain, network }
    }
}

#[derive(Debug, Clone)]
pub struct TransferChannelPair {
    pub a_channel_id: String,
    pub b_channel_id: String,
}

#[derive(Debug, Clone)]
pub struct TransferRouteSetup {
    pub cardano_chain_id: String,
    pub entrypoint_chain_id: String,
    pub destination_chain_id: String,
    pub destination_chain: RouteChain,
    pub destination_network: String,
    pub cardano_entrypoint_channel_pair: TransferChannelPair,
    pub entrypoint_destination_channel_pair: TransferChannelPair,
}

impl TransferRouteSetup {
    pub fn summary_lines(&self) -> Vec<String> {
        vec![
            format!(
                "Cardano -> Entrypoint: {}:{} <-> {}:{}",
                self.cardano_chain_id,
                self.cardano_entrypoint_channel_pair.a_channel_id,
                self.entrypoint_chain_id,
                self.cardano_entrypoint_channel_pair.b_channel_id
            ),
            format!(
                "Entrypoint -> {} {}: {}:{} <-> {}:{}",
                self.destination_chain.display_name(),
                self.destination_network,
                self.entrypoint_chain_id,
                self.entrypoint_destination_channel_pair.a_channel_id,
                self.destination_chain_id,
                self.entrypoint_destination_channel_pair.b_channel_id
            ),
        ]
    }
}

pub fn setup_transfer_route(
    project_root_path: &Path,
    source: RouteEndpoint,
    destination: RouteEndpoint,
) -> Result<TransferRouteSetup, String> {
    if source.chain != RouteChain::Cardano {
        return Err(format!(
            "Only Cardano-sourced token-transfer routes are currently supported, got '{}'.",
            source.chain.display_name()
        ));
    }

    let active_cardano_network = config::active_core_cardano_network(project_root_path);
    if let Some(source_network) = source.network.as_deref() {
        if source_network != active_cardano_network.as_str() {
            return Err(format!(
                "Requested Cardano network '{}' but the active Cardano runtime is '{}'. Start the matching runtime first.",
                source_network,
                active_cardano_network.as_str()
            ));
        }
    }

    let cardano_entrypoint_channel_pair = ensure_cardano_entrypoint_transfer_channel()?;
    let (destination_chain_id, destination_network, entrypoint_destination_channel_pair) =
        match destination.chain {
            RouteChain::Injective => {
                let network = destination.network.as_deref().unwrap_or("local");
                let pair =
                    ensure_entrypoint_injective_transfer_channel(project_root_path, network)?;
                let chain_id = injective_chain_id_for_network(network)?.to_string();
                (chain_id, network.to_string(), pair)
            }
            RouteChain::Osmosis => {
                let network = destination.network.as_deref().unwrap_or("local");
                let pair = ensure_entrypoint_osmosis_transfer_channel(project_root_path, network)?;
                let chain_id = osmosis_demo_chain_id(network)?.to_string();
                (chain_id, network.to_string(), pair)
            }
            RouteChain::Cardano => {
                return Err(
                    "Cardano-to-Cardano token-transfer route setup is not supported.".to_string(),
                )
            }
        };

    Ok(TransferRouteSetup {
        cardano_chain_id: cardano_chain_id(),
        entrypoint_chain_id: entrypoint_chain_id(),
        destination_chain_id,
        destination_chain: destination.chain,
        destination_network,
        cardano_entrypoint_channel_pair,
        entrypoint_destination_channel_pair,
    })
}

pub fn ensure_entrypoint_injective_transfer_channel(
    project_root_path: &Path,
    network: &str,
) -> Result<TransferChannelPair, String> {
    let injective_chain_id = injective_chain_id_for_network(network)?;

    if let Some(existing_open_channel_pair) = query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        injective_chain_id,
        TRANSFER_PORT_ID,
    )? {
        logger::log(&format!(
            "PASS: Reusing Entrypoint<->Injective transfer channel ({})",
            existing_open_channel_pair.a_channel_id
        ));
        return Ok(existing_open_channel_pair);
    }

    let injective_dir = injective_workspace_dir(project_root_path);
    let configure_result = match network {
        "local" => configure_injective_hermes_for_demo(project_root_path, injective_dir.as_path()),
        "testnet" => {
            configure_injective_hermes_for_testnet_demo(project_root_path, injective_dir.as_path())
        }
        _ => Err(format!(
            "Unsupported Injective network '{}' for transfer route setup",
            network
        )
        .into()),
    };

    configure_result.map_err(|error| {
        format!(
            "Failed to configure Hermes for Entrypoint->Injective {} route: {}",
            network, error
        )
    })?;

    query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        injective_chain_id,
        TRANSFER_PORT_ID,
    )?
    .ok_or_else(|| {
        format!(
            "Hermes configured Entrypoint->Injective {}, but no reciprocal open transfer channel is usable.",
            network
        )
    })
}

pub fn ensure_entrypoint_osmosis_transfer_channel(
    project_root_path: &Path,
    network: &str,
) -> Result<TransferChannelPair, String> {
    let osmosis_chain_id = osmosis_demo_chain_id(network)?;

    if let Some(existing_open_channel_pair) = query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        osmosis_chain_id,
        TRANSFER_PORT_ID,
    )? {
        logger::log(&format!(
            "PASS: Reusing Entrypoint<->Osmosis transfer channel ({})",
            existing_open_channel_pair.a_channel_id
        ));
        return Ok(existing_open_channel_pair);
    }

    let osmosis_dir = osmosis_workspace_dir(project_root_path);
    sync_osmosis_workspace_assets(project_root_path, osmosis_dir.as_path()).map_err(|error| {
        format!(
            "Failed to refresh Osmosis workspace assets before route setup: {}",
            error
        )
    })?;
    configure_osmosis_hermes_for_demo(osmosis_dir.as_path(), network).map_err(|error| {
        format!(
            "Failed to configure Hermes for Entrypoint->Osmosis {} route: {}",
            network, error
        )
    })?;

    query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        osmosis_chain_id,
        TRANSFER_PORT_ID,
    )?
    .ok_or_else(|| {
        format!(
            "Hermes configured Entrypoint->Osmosis {}, but no reciprocal open transfer channel is usable.",
            network
        )
    })
}

fn injective_chain_id_for_network(network: &str) -> Result<&'static str, String> {
    match network {
        "local" => Ok(injective_local_chain_id()),
        "testnet" => Ok(injective_testnet_chain_id()),
        _ => Err(format!(
            "Unsupported Injective network '{}' for transfer route setup",
            network
        )),
    }
}

fn cardano_chain_id() -> String {
    let config = config::get_config();
    let active_network = config::active_core_cardano_network(Path::new(&config.project_root));
    config::cardano_network_profile(active_network).chain_id
}

fn cardano_message_port_id() -> String {
    config::get_config().chains.cardano.message_port_id
}

fn entrypoint_chain_id() -> String {
    config::get_config().chains.entrypoint.chain_id
}

fn entrypoint_message_port_id() -> String {
    config::get_config().chains.entrypoint.message_port_id
}

fn hermes_output_details(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!(
        "status={}\nstdout:\n{}\nstderr:\n{}",
        output.status,
        if stdout.trim().is_empty() {
            "<empty>"
        } else {
            stdout.trim()
        },
        if stderr.trim().is_empty() {
            "<empty>"
        } else {
            stderr.trim()
        }
    )
}

fn is_retryable_hermes_provider_failure(details: &str) -> bool {
    let lower = details.to_ascii_lowercase();
    if is_non_retryable_hermes_provider_failure(lower.as_str()) {
        return false;
    }

    lower.contains("unexpected server response: 401")
        || lower.contains("http 401")
        || lower.contains("gateway client error: internal server error")
        || lower.contains("internal server error")
        || lower.contains("deadline has elapsed")
        || lower.contains("timed out")
        || lower.contains("connection reset")
}

fn is_non_retryable_hermes_provider_failure(lower_details: &str) -> bool {
    lower_details.contains("non-retryable cardano provider rejection")
        || lower_details.contains("ogmios_codes=3010")
        || lower_details.contains("ogmios_codes=3012")
        || lower_details.contains("\"code\":3010")
        || lower_details.contains("\"code\":3012")
        || lower_details.contains("some scripts of the transactions terminated")
        || lower_details.contains("failed to evaluate to a positive outcome")
        || lower_details.contains("validationerror")
        || lower_details.contains("validator returned false")
}

fn run_hermes_command_with_provider_retry(
    args: &[&str],
    operation: &str,
) -> Result<Output, String> {
    const MAX_ATTEMPTS: usize = 6;
    let mut last_details = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        let output = run_hermes_command(args).map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(output);
        }

        last_details = hermes_output_details(&output);
        if attempt == MAX_ATTEMPTS || !is_retryable_hermes_provider_failure(&last_details) {
            break;
        }

        logger::verbose(&format!(
            "Hermes {operation} failed with a transient provider error (attempt {attempt}/{MAX_ATTEMPTS}); retrying in 5s"
        ));
        std::thread::sleep(Duration::from_secs(5));
    }

    let lower_details = last_details.to_ascii_lowercase();
    let classification = if is_non_retryable_hermes_provider_failure(lower_details.as_str()) {
        "non-retryable Cardano transaction validation failure"
    } else {
        "provider/relayer failure"
    };
    Err(format!(
        "Hermes {operation} failed ({classification}): {last_details}"
    ))
}

fn create_hermes_client_with_provider_retry(
    host_chain: &str,
    reference_chain: &str,
) -> Result<String, String> {
    let output = run_hermes_command_with_provider_retry(
        &[
            "create",
            "client",
            "--host-chain",
            host_chain,
            "--reference-chain",
            reference_chain,
        ],
        &format!("create client {host_chain}->{reference_chain}"),
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_tendermint_client_id(&stdout).ok_or_else(|| {
        format!(
            "Failed to parse client id for {host_chain}->{reference_chain} from Hermes output:\n{}",
            stdout
        )
    })
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

fn query_transfer_channel_end_status(
    chain_id: &str,
    port_id: &str,
    channel_id: &str,
) -> Result<Option<TransferChannelEndStatus>, String> {
    let output = match run_hermes_command_with_timeout(
        &[
            "--json",
            "query",
            "channel",
            "end",
            "--chain",
            chain_id,
            "--port",
            port_id,
            "--channel",
            channel_id,
        ],
        Duration::from_secs(HERMES_CARDANO_QUERY_TIMEOUT_SECS),
    ) {
        Ok(output) => output,
        Err(error) => {
            let message = error.to_string();
            if message.contains("timed out after") {
                logger::verbose(&format!(
                    "Hermes query channel end timed out for chain={chain_id}, channel={channel_id}; skipping candidate"
                ));
                return Ok(None);
            }
            return Err(message);
        }
    };

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

fn extract_transfer_channel_id_for_ports(
    entry: &Value,
    local_port_id: &str,
    remote_port_id: &str,
) -> Option<String> {
    let entry_local_port = entry.get("port_id").and_then(Value::as_str);
    let entry_remote_port = entry
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str);

    if entry_local_port != Some(local_port_id) {
        return None;
    }

    if let Some(entry_remote_port) = entry_remote_port {
        if entry_remote_port != remote_port_id {
            return None;
        }
    }

    extract_transfer_channel_id(entry)
}

pub fn query_open_transfer_channel_pair(
    a_chain_id: &str,
    a_port_id: &str,
    b_chain_id: &str,
    b_port_id: &str,
) -> Result<Option<TransferChannelPair>, String> {
    let output = match run_hermes_command_with_timeout(
        &[
            "--json",
            "query",
            "channels",
            "--chain",
            a_chain_id,
            "--counterparty-chain",
            b_chain_id,
        ],
        Duration::from_secs(HERMES_CARDANO_QUERY_TIMEOUT_SECS),
    ) {
        Ok(output) => output,
        Err(error) => {
            let message = error.to_string();
            if message.contains("timed out after") {
                logger::verbose(&format!(
                    "Hermes query channels timed out for {a_chain_id}<->{b_chain_id}; creating or validating a fresh transfer path"
                ));
                return Ok(None);
            }
            return Err(message);
        }
    };

    if !output.status.success() {
        return Err(format!(
            "Hermes query channels failed for {}<->{}:\n{}",
            a_chain_id,
            b_chain_id,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();

    let channel_entries = parsed_lines
        .iter()
        .filter_map(|entry| match entry.get("result") {
            Some(result) if result.is_array() => result.as_array(),
            Some(result) if result.is_object() => result.get("channels").and_then(Value::as_array),
            _ => None,
        })
        .next_back()
        .cloned()
        .unwrap_or_default();

    let mut a_channel_ids: Vec<String> = channel_entries
        .iter()
        .filter_map(|entry| extract_transfer_channel_id_for_ports(entry, a_port_id, b_port_id))
        .collect();
    a_channel_ids.sort_by(|left, right| {
        let left_seq = parse_channel_sequence(left).unwrap_or(0);
        let right_seq = parse_channel_sequence(right).unwrap_or(0);
        right_seq.cmp(&left_seq).then_with(|| right.cmp(left))
    });
    a_channel_ids.dedup();

    for a_channel_id in a_channel_ids {
        let Some(a_end) =
            query_transfer_channel_end_status(a_chain_id, a_port_id, a_channel_id.as_str())?
        else {
            continue;
        };
        if !is_open_transfer_state(a_end.state.as_str()) {
            continue;
        }
        if a_end.remote_port_id.as_deref() != Some(b_port_id) {
            continue;
        }
        let Some(b_channel_id) = a_end.remote_channel_id else {
            continue;
        };

        let Some(b_end) =
            query_transfer_channel_end_status(b_chain_id, b_port_id, b_channel_id.as_str())?
        else {
            continue;
        };
        if !is_open_transfer_state(b_end.state.as_str()) {
            continue;
        }
        if b_end.remote_port_id.as_deref() != Some(a_port_id) {
            continue;
        }
        if b_end.remote_channel_id.as_deref() != Some(a_channel_id.as_str()) {
            continue;
        }

        return Ok(Some(TransferChannelPair {
            a_channel_id,
            b_channel_id,
        }));
    }

    Ok(None)
}

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

fn query_connection_end_status(
    chain_id: &str,
    connection_id: &str,
) -> Result<Option<ConnectionEndStatus>, String> {
    let output = match run_hermes_command_with_timeout(
        &[
            "--json",
            "query",
            "connection",
            "end",
            "--chain",
            chain_id,
            "--connection",
            connection_id,
        ],
        Duration::from_secs(HERMES_CARDANO_QUERY_TIMEOUT_SECS),
    ) {
        Ok(output) => output,
        Err(error) => {
            let message = error.to_string();
            if message.contains("timed out after") {
                logger::verbose(&format!(
                    "Hermes query connection end timed out for chain={chain_id}, connection={connection_id}; skipping candidate"
                ));
                return Ok(None);
            }
            return Err(message);
        }
    };

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

fn is_open_cardano_entrypoint_connection(cardano_connection_id: &str) -> Result<bool, String> {
    let cardano_chain_id = cardano_chain_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    let Some(cardano_end) =
        query_connection_end_status(cardano_chain_id.as_str(), cardano_connection_id)?
    else {
        return Ok(false);
    };
    if !is_open_transfer_state(&cardano_end.state) {
        logger::verbose(&format!(
            "Skipping {} connection {cardano_connection_id}: state={} (expected Open)",
            cardano_chain_id, cardano_end.state
        ));
        return Ok(false);
    }

    let Some(entrypoint_connection_id) = cardano_end.remote_connection_id.as_deref() else {
        logger::verbose(&format!(
            "Skipping {} connection {cardano_connection_id}: missing counterparty connection id",
            cardano_chain_id
        ));
        return Ok(false);
    };
    let Some(entrypoint_end) =
        query_connection_end_status(entrypoint_chain_id.as_str(), entrypoint_connection_id)?
    else {
        return Ok(false);
    };
    if !is_open_transfer_state(&entrypoint_end.state) {
        logger::verbose(&format!(
            "Skipping {} connection {cardano_connection_id}: entrypoint counterparty {} is {} (expected Open)",
            cardano_chain_id, entrypoint_connection_id, entrypoint_end.state
        ));
        return Ok(false);
    }
    if entrypoint_end.remote_connection_id.as_deref() != Some(cardano_connection_id) {
        logger::verbose(&format!(
            "Skipping {} connection {cardano_connection_id}: entrypoint counterparty {} does not point back to it",
            cardano_chain_id, entrypoint_connection_id
        ));
        return Ok(false);
    }
    if cardano_end.client_id.is_none()
        || cardano_end.remote_client_id.is_none()
        || entrypoint_end.client_id.is_none()
        || entrypoint_end.remote_client_id.is_none()
    {
        logger::verbose(&format!(
            "Skipping {} connection {cardano_connection_id}: missing client identifiers on one or both ends",
            cardano_chain_id
        ));
        return Ok(false);
    }
    Ok(true)
}

fn query_cardano_entrypoint_open_connection() -> Result<Option<String>, String> {
    let cardano_chain_id = cardano_chain_id();
    let candidate_connection_ids = query_connection_ids_for_chain(cardano_chain_id.as_str())?;
    logger::verbose(&format!(
        "Hermes query returned {} {} connection candidates",
        candidate_connection_ids.len(),
        cardano_chain_id
    ));

    for connection_id in candidate_connection_ids {
        if is_open_cardano_entrypoint_connection(connection_id.as_str())? {
            return Ok(Some(connection_id));
        }
    }

    Ok(None)
}

fn query_cardano_entrypoint_channel_pair() -> Result<Option<TransferChannelPair>, String> {
    let cardano_chain_id = cardano_chain_id();
    let cardano_port_id = cardano_message_port_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    let entrypoint_port_id = entrypoint_message_port_id();
    query_open_transfer_channel_pair(
        cardano_chain_id.as_str(),
        cardano_port_id.as_str(),
        entrypoint_chain_id.as_str(),
        entrypoint_port_id.as_str(),
    )
}

fn parse_hermes_channel_id(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .filter_map(|word| {
            let cleaned =
                word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '=');
            let cleaned = cleaned.strip_prefix("id=").unwrap_or(cleaned);

            cleaned.starts_with("channel-").then(|| cleaned.to_string())
        })
        .next()
}

fn create_cardano_entrypoint_transfer_channel_on_connection(
    connection_id: &str,
) -> Result<TransferChannelPair, String> {
    let cardano_chain_id = cardano_chain_id();
    let cardano_port_id = cardano_message_port_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    let entrypoint_port_id = entrypoint_message_port_id();
    logger::verbose(&format!(
        "Creating transfer channel on connection {connection_id} (Cardano<->Entrypoint)"
    ));
    let output = run_hermes_command_with_provider_retry(
        &[
            "create",
            "channel",
            "--a-chain",
            cardano_chain_id.as_str(),
            "--a-connection",
            connection_id,
            "--a-port",
            cardano_port_id.as_str(),
            "--b-port",
            entrypoint_port_id.as_str(),
        ],
        &format!("create channel {cardano_chain_id}->{entrypoint_chain_id}"),
    )
    .map_err(|error| {
        format!(
            "Failed to create Cardano-Entrypoint transfer channel on connection {}: {}",
            connection_id, error
        )
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let cardano_channel_id = parse_hermes_channel_id(stdout.as_ref()).ok_or_else(|| {
        format!(
            "Failed to parse Cardano channel id from Hermes output:\n{}",
            stdout.trim()
        )
    })?;

    const MAX_ATTEMPTS: usize = 24;
    for attempt in 1..=MAX_ATTEMPTS {
        if let Some(cardano_end) = query_transfer_channel_end_status(
            cardano_chain_id.as_str(),
            cardano_port_id.as_str(),
            cardano_channel_id.as_str(),
        )? {
            if is_open_transfer_state(cardano_end.state.as_str())
                && cardano_end.remote_port_id.as_deref() == Some(entrypoint_port_id.as_str())
            {
                if let Some(entrypoint_channel_id) = cardano_end.remote_channel_id {
                    if let Some(entrypoint_end) = query_transfer_channel_end_status(
                        entrypoint_chain_id.as_str(),
                        entrypoint_port_id.as_str(),
                        entrypoint_channel_id.as_str(),
                    )? {
                        if is_open_transfer_state(entrypoint_end.state.as_str())
                            && entrypoint_end.remote_port_id.as_deref()
                                == Some(cardano_port_id.as_str())
                            && entrypoint_end.remote_channel_id.as_deref()
                                == Some(cardano_channel_id.as_str())
                        {
                            return Ok(TransferChannelPair {
                                a_channel_id: cardano_channel_id,
                                b_channel_id: entrypoint_channel_id,
                            });
                        }
                    }
                }
            }
        }

        if attempt < MAX_ATTEMPTS {
            std::thread::sleep(Duration::from_secs(5));
        }
    }

    Err(format!(
        "Created Cardano<->Entrypoint transfer channel on connection {}, but it did not reach Open/Open on both ends in time (Cardano channel {}).",
        connection_id, cardano_channel_id
    ))
}

pub fn ensure_cardano_entrypoint_transfer_channel() -> Result<TransferChannelPair, String> {
    let cardano_chain_id = cardano_chain_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    logger::log("Ensuring Cardano->Entrypoint transfer path exists.");

    if let Some(existing_open_channel_pair) = query_cardano_entrypoint_channel_pair()? {
        logger::log(&format!(
            "PASS: Reusing Cardano<->Entrypoint transfer channel ({})",
            existing_open_channel_pair.a_channel_id
        ));
        return Ok(existing_open_channel_pair);
    }

    if let Some(existing_open_connection_id) = query_cardano_entrypoint_open_connection()? {
        logger::verbose(&format!(
            "Found existing open Cardano<->Entrypoint connection {}; creating transfer channel on it",
            existing_open_connection_id
        ));
        let open_channel_pair = create_cardano_entrypoint_transfer_channel_on_connection(
            existing_open_connection_id.as_str(),
        )?;
        logger::log(&format!(
            "PASS: Created Cardano<->Entrypoint transfer channel ({})",
            open_channel_pair.a_channel_id
        ));
        return Ok(open_channel_pair);
    }

    logger::verbose(&format!(
        "Creating {cardano_chain_id} client with {entrypoint_chain_id} reference"
    ));

    let cardano_client_id = create_hermes_client_with_provider_retry(
        cardano_chain_id.as_str(),
        entrypoint_chain_id.as_str(),
    )
    .map_err(|error| {
        format!("Failed to create client for {cardano_chain_id}->{entrypoint_chain_id}: {error}")
    })?;

    logger::verbose(&format!(
        "Creating {entrypoint_chain_id} client with {cardano_chain_id} reference"
    ));
    let entrypoint_client_id = create_hermes_client_with_provider_retry(
        entrypoint_chain_id.as_str(),
        cardano_chain_id.as_str(),
    )
    .map_err(|error| {
        format!("Failed to create client for {entrypoint_chain_id}->{cardano_chain_id}: {error}")
    })?;

    logger::verbose("Creating Cardano<->Entrypoint connection");
    let create_connection_output = run_hermes_command_with_provider_retry(
        &[
            "create",
            "connection",
            "--a-chain",
            cardano_chain_id.as_str(),
            "--a-client",
            cardano_client_id.as_str(),
            "--b-client",
            entrypoint_client_id.as_str(),
        ],
        &format!("create connection {cardano_chain_id}->{entrypoint_chain_id}"),
    )
    .map_err(|error| format!("Failed to create Cardano-Entrypoint connection: {error}"))?;
    let create_connection_stdout =
        String::from_utf8_lossy(&create_connection_output.stdout).to_string();
    let connection_id =
        parse_tendermint_connection_id(&create_connection_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano-Entrypoint connection id from Hermes output:\n{}",
                create_connection_stdout
            )
        })?;

    let open_channel_pair =
        create_cardano_entrypoint_transfer_channel_on_connection(connection_id.as_str())?;

    logger::log(&format!(
        "PASS: Created Cardano<->Entrypoint transfer channel ({})",
        open_channel_pair.a_channel_id
    ));
    Ok(open_channel_pair)
}
