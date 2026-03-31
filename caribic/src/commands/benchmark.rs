use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs, path::PathBuf};

use crate::{
    config::{self, CoreCardanoNetwork},
    logger,
    start as relayer_start,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;
use sha3::{Digest, Sha3_256};

const CARDANO_CHAIN_ID: &str = "cardano-devnet";
const CARDANO_NETWORK_MAGIC: &str = "42";
const TRANSFER_PORT: &str = "transfer";
const REQUIRED_TRANSFER_CHANNEL_PAIRS: usize = 2;
const DEFAULT_TRANSFER_AMOUNT: u64 = 1_000_000;
const DEFAULT_TIMEOUT_HEIGHT_OFFSET: u64 = 10_000;
const DEFAULT_TIMEOUT_SECONDS: u64 = 600;

#[derive(Debug, Clone)]
struct TransferChannelPair {
    cardano_channel: String,
    entrypoint_channel: String,
}

#[derive(Debug, Clone)]
struct TransferChannelEndStatus {
    state: String,
    remote_channel_id: Option<String>,
    remote_port_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ConnectionEndStatus {
    state: String,
    client_id: Option<String>,
    remote_client_id: Option<String>,
    remote_connection_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceRegistryBucketStats {
    bucket_index: u8,
    shard_count: usize,
    rollover_count: usize,
    total_entries: usize,
    active_shard_entry_count: usize,
    active_shard_datum_bytes: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceRegistrySummary {
    max_tx_size: usize,
    tx_headroom_bytes: usize,
    projected_max_shard_datum_bytes_upper_bound: usize,
    total_entries: usize,
    buckets: Vec<TraceRegistryBucketStats>,
}

#[derive(Debug, Deserialize)]
struct TraceRegistrySummaryEnvelope {
    summary: TraceRegistrySummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MintMockTokenResult {
    token_name: String,
    token_name_hex: String,
    token_unit: String,
    receiver_address: String,
    amount: String,
    tx_hash: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct QueryDenomRequest {
    #[prost(string, tag = "1")]
    hash: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct QueryDenomResponse {
    #[prost(message, optional, tag = "1")]
    denom: Option<Denom>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct Denom {
    #[prost(string, tag = "1")]
    base: String,
    #[prost(message, repeated, tag = "3")]
    trace: Vec<Hop>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct Hop {
    #[prost(string, tag = "1")]
    port_id: String,
    #[prost(string, tag = "2")]
    channel_id: String,
}

pub fn run_denom_registry_benchmark(
    project_root_path: &Path,
    bucket: Option<u8>,
    inserts: usize,
) -> Result<(), String> {
    let active_network = config::active_core_cardano_network(project_root_path);
    if active_network != CoreCardanoNetwork::Local {
        return Err(format!(
            "Denom-registry benchmark only supports the local Cardano runtime today (active network: {}).",
            active_network.as_str()
        ));
    }

    if let Some(bucket_index) = bucket {
        if bucket_index > 15 {
            return Err(format!(
                "Trace-registry bucket must be between 0 and 15, received {}",
                bucket_index
            ));
        }
    }

    if inserts == 0 {
        return Err("Denom-registry benchmark requires --inserts >= 1".to_string());
    }

    let profile = config::cardano_network_profile(active_network);
    let gateway_dir = project_root_path.join("cardano/gateway");
    let offchain_dir = project_root_path.join("cardano/offchain");
    let normalized_handler_json_path =
        normalize_existing_path(project_root_path.join("cardano/offchain/deployments/handler.json"))?;
    let normalized_bridge_manifest_path = normalize_future_path(
        project_root_path.join("cardano/offchain/deployments/bridge-manifest.json"),
    )?;

    ensure_bridge_manifest_exists(
        &gateway_dir,
        &normalized_handler_json_path,
        &normalized_bridge_manifest_path,
        &profile,
    )?;

    let initial_summary =
        query_registry_summary(&gateway_dir, &normalized_bridge_manifest_path, &profile)?;
    logger::log(&format!(
        "Trace registry before benchmark: totalEntries={} maxTxSize={} headroom={} projectedActiveShardUpperBound={}",
        initial_summary.total_entries,
        initial_summary.max_tx_size,
        initial_summary.tx_headroom_bytes,
        initial_summary.projected_max_shard_datum_bytes_upper_bound
    ));

    let channel_pairs = ensure_transfer_channel_pairs(project_root_path, REQUIRED_TRANSFER_CHANNEL_PAIRS)?;
    let outbound_pair = &channel_pairs[0];
    let return_pair = &channel_pairs[1];
    logger::log(&format!(
        "Using outbound pair cardano:{} <-> entrypoint:{} and return pair cardano:{} <-> entrypoint:{}",
        outbound_pair.cardano_channel,
        outbound_pair.entrypoint_channel,
        return_pair.cardano_channel,
        return_pair.entrypoint_channel
    ));

    let entrypoint_address = get_hermes_chain_address(project_root_path, entrypoint_chain_id())?;
    let cardano_receiver_credential = get_cardano_payment_credential_hex(project_root_path)?;
    let cardano_receiver_address = cardano_enterprise_address_from_payment_credential(
        project_root_path,
        &cardano_receiver_credential,
    )?;
    let voucher_policy_id = read_handler_json_value(
        project_root_path,
        &["validators", "mintVoucher", "scriptHash"],
    )?;
    let deployed_mock_token_unit =
        read_handler_json_value(project_root_path, &["tokens", "mock"])?;
    let mock_policy_id = extract_policy_id(&deployed_mock_token_unit)?;
    let run_nonce = benchmark_run_nonce();

    logger::log(&format!(
        "Benchmark addresses: entrypoint={} cardanoReceiver={}",
        entrypoint_address, cardano_receiver_address
    ));

    for insert_index in 1..=inserts {
        let token_name = choose_mock_token_name_for_bucket(
            bucket,
            run_nonce,
            insert_index,
            &mock_policy_id,
            outbound_pair,
            return_pair,
        )?;
        let predicted_bucket = predicted_cardano_voucher_bucket(
            &mock_policy_id,
            &token_name,
            outbound_pair,
            return_pair,
        )?;

        logger::log(&format!(
            "Insert {}/{}: minting mock asset '{}' (predicted bucket={})",
            insert_index, inserts, token_name, predicted_bucket
        ));

        let mint_result = mint_mock_token(
            &offchain_dir,
            &token_name,
            DEFAULT_TRANSFER_AMOUNT,
            &cardano_receiver_address,
        )?;

        let entrypoint_balances_before = query_entrypoint_balances(&entrypoint_address)?;
        hermes_ft_transfer(
            project_root_path,
            CARDANO_CHAIN_ID,
            entrypoint_chain_id(),
            TRANSFER_PORT,
            &outbound_pair.cardano_channel,
            DEFAULT_TRANSFER_AMOUNT,
            &mint_result.token_unit,
            Some(&entrypoint_address),
            DEFAULT_TIMEOUT_HEIGHT_OFFSET,
            DEFAULT_TIMEOUT_SECONDS,
        )?;
        hermes_clear_packets(
            project_root_path,
            CARDANO_CHAIN_ID,
            TRANSFER_PORT,
            &outbound_pair.cardano_channel,
            entrypoint_chain_id(),
            &outbound_pair.entrypoint_channel,
            Some(12),
        )?;

        let entrypoint_balances_after = query_entrypoint_balances(&entrypoint_address)?;
        let entrypoint_voucher_denom = find_entrypoint_ibc_denom_with_min_delta(
            &entrypoint_balances_before,
            &entrypoint_balances_after,
            DEFAULT_TRANSFER_AMOUNT,
        )?;
        let entrypoint_voucher_hash = entrypoint_voucher_denom
            .strip_prefix("ibc/")
            .unwrap_or(entrypoint_voucher_denom.as_str());
        assert_entrypoint_denom_trace(
            entrypoint_voucher_hash,
            &format!("transfer/{}", outbound_pair.entrypoint_channel),
            &expected_denom_trace_base_denom(&mint_result.token_unit),
        )?;

        let cardano_voucher_assets_before = query_cardano_policy_assets(
            project_root_path,
            &cardano_receiver_address,
            &voucher_policy_id,
        )
        .map_err(|error| error.to_string())?;

        hermes_ft_transfer(
            project_root_path,
            entrypoint_chain_id(),
            CARDANO_CHAIN_ID,
            TRANSFER_PORT,
            &return_pair.entrypoint_channel,
            DEFAULT_TRANSFER_AMOUNT,
            &entrypoint_voucher_denom,
            Some(&cardano_receiver_credential),
            DEFAULT_TIMEOUT_HEIGHT_OFFSET,
            DEFAULT_TIMEOUT_SECONDS,
        )?;
        hermes_clear_packets(
            project_root_path,
            entrypoint_chain_id(),
            TRANSFER_PORT,
            &return_pair.entrypoint_channel,
            CARDANO_CHAIN_ID,
            &return_pair.cardano_channel,
            Some(12),
        )?;

        let cardano_voucher_assets_after = query_cardano_policy_assets(
            project_root_path,
            &cardano_receiver_address,
            &voucher_policy_id,
        )
        .map_err(|error| error.to_string())?;
        let minted_cardano_voucher_hash = find_policy_asset_with_min_delta(
            &cardano_voucher_assets_before,
            &cardano_voucher_assets_after,
            DEFAULT_TRANSFER_AMOUNT,
        )?;
        let actual_bucket = bucket_index_for_hash_hex(&minted_cardano_voucher_hash)?;
        let expected_path = format!(
            "transfer/{}/transfer/{}/transfer/{}",
            return_pair.cardano_channel,
            return_pair.entrypoint_channel,
            outbound_pair.entrypoint_channel
        );
        let expected_base_denom = expected_denom_trace_base_denom(&mint_result.token_unit);
        assert_gateway_denom_trace(
            &minted_cardano_voucher_hash,
            &expected_path,
            &expected_base_denom,
        )?;

        if let Some(target_bucket) = bucket {
            if actual_bucket != target_bucket {
                return Err(format!(
                    "Live insert {} landed in bucket {} instead of requested bucket {} (voucher hash {})",
                    insert_index, actual_bucket, target_bucket, minted_cardano_voucher_hash
                ));
            }
        }

        let live_summary = query_registry_summary(
            &gateway_dir,
            &normalized_bridge_manifest_path,
            &profile,
        )?;
        let bucket_stats = live_summary
            .buckets
            .iter()
            .find(|candidate| candidate.bucket_index == actual_bucket)
            .ok_or_else(|| format!("Missing live stats for bucket {}", actual_bucket))?;

        logger::log(&format!(
            "Insert {}/{} complete: tokenUnit={} voucherHash={} bucket={} totalEntries={} bucketEntries={} bucketShards={} bucketRollovers={} activeDatumBytes={}",
            insert_index,
            inserts,
            mint_result.token_unit,
            minted_cardano_voucher_hash,
            actual_bucket,
            live_summary.total_entries,
            bucket_stats.total_entries,
            bucket_stats.shard_count,
            bucket_stats.rollover_count,
            bucket_stats.active_shard_datum_bytes
        ));
    }

    let final_summary = query_registry_summary(
        &gateway_dir,
        &normalized_bridge_manifest_path,
        &profile,
    )?;
    logger::log(&format!(
        "Denom-registry benchmark finished: totalEntries={} maxTxSize={} projectedUpperBound={}",
        final_summary.total_entries,
        final_summary.max_tx_size,
        final_summary.projected_max_shard_datum_bytes_upper_bound
    ));
    if let Some(target_bucket) = bucket {
        if let Some(bucket_stats) = final_summary
            .buckets
            .iter()
            .find(|candidate| candidate.bucket_index == target_bucket)
        {
            logger::log(&format!(
                "Target bucket {} final state: totalEntries={} shardCount={} rollovers={} activeEntries={} activeDatumBytes={}",
                target_bucket,
                bucket_stats.total_entries,
                bucket_stats.shard_count,
                bucket_stats.rollover_count,
                bucket_stats.active_shard_entry_count,
                bucket_stats.active_shard_datum_bytes
            ));
        }
    }

    Ok(())
}

fn benchmark_run_nonce() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn entrypoint_chain_id() -> &'static str {
    static ENTRYPOINT_CHAIN_ID: OnceLock<String> = OnceLock::new();
    ENTRYPOINT_CHAIN_ID
        .get_or_init(|| config::get_config().chains.entrypoint.chain_id)
        .as_str()
}

fn query_registry_summary(
    gateway_dir: &Path,
    bridge_manifest_path: &str,
    profile: &config::CardanoNetworkProfile,
) -> Result<TraceRegistrySummary, String> {
    let output = Command::new("npm")
        .arg("--silent")
        .arg("run")
        .arg("benchmark:denom-registry")
        .arg("--")
        .arg("--json")
        .arg("--summary-only")
        .current_dir(gateway_dir)
        .env("CARDANO_CHAIN_ID", &profile.chain_id)
        .env(
            "CARDANO_CHAIN_NETWORK_MAGIC",
            profile.network_magic.to_string(),
        )
        .env("KUPO_ENDPOINT", "http://127.0.0.1:1442")
        .env("OGMIOS_ENDPOINT", "http://127.0.0.1:1337")
        .env("BRIDGE_MANIFEST_PATH", bridge_manifest_path)
        .output()
        .map_err(|error| {
            format!(
                "Failed to query live trace-registry summary from {}: {}",
                gateway_dir.display(),
                error
            )
        })?;

    if !output.status.success() {
        return Err(format!(
            "Trace-registry summary query failed:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ));
    }

    let envelope: TraceRegistrySummaryEnvelope = serde_json::from_slice(&output.stdout)
        .map_err(|error| {
            format!(
                "Failed to parse trace-registry summary JSON:\nstdout: {}\nerror: {}",
                String::from_utf8_lossy(&output.stdout),
                error
            )
        })?;

    Ok(envelope.summary)
}

fn mint_mock_token(
    offchain_dir: &Path,
    token_name: &str,
    amount: u64,
    receiver_address: &str,
) -> Result<MintMockTokenResult, String> {
    let output = Command::new("deno")
        .arg("run")
        .arg("--frozen")
        .arg("--env-file=.env.default")
        .arg("--allow-net")
        .arg("--allow-env")
        .arg("--allow-read")
        .arg("--allow-ffi")
        .arg("scripts/mint-mock-token.ts")
        .arg("--token-name")
        .arg(token_name)
        .arg("--amount")
        .arg(amount.to_string())
        .arg("--receiver")
        .arg(receiver_address)
        .current_dir(offchain_dir)
        .output()
        .map_err(|error| {
            format!(
                "Failed to start mock-token mint script in {}: {}",
                offchain_dir.display(),
                error
            )
        })?;

    if !output.status.success() {
        return Err(format!(
            "Mock-token mint script failed:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ));
    }

    serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "Failed to parse mock-token mint output:\nstdout: {}\nstderr: {}\nerror: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
            error
        )
    })
}

fn choose_mock_token_name_for_bucket(
    target_bucket: Option<u8>,
    run_nonce: u64,
    insert_index: usize,
    mock_policy_id: &str,
    outbound_pair: &TransferChannelPair,
    return_pair: &TransferChannelPair,
) -> Result<String, String> {
    const MAX_ATTEMPTS: usize = 4096;

    for attempt in 0..MAX_ATTEMPTS {
        let token_name = format!(
            "b{:04x}{:04x}{:02x}",
            (run_nonce & 0xffff) as u16,
            (insert_index & 0xffff) as u16,
            (attempt & 0xff) as u8
        );
        if let Some(bucket) = target_bucket {
            let predicted_bucket = predicted_cardano_voucher_bucket(
                mock_policy_id,
                &token_name,
                outbound_pair,
                return_pair,
            )?;
            if predicted_bucket != bucket {
                continue;
            }
        }
        return Ok(token_name);
    }

    Err(format!(
        "Failed to derive a mock token name landing in bucket {:?} after {} attempts",
        target_bucket, MAX_ATTEMPTS
    ))
}

fn predicted_cardano_voucher_bucket(
    mock_policy_id: &str,
    token_name: &str,
    outbound_pair: &TransferChannelPair,
    return_pair: &TransferChannelPair,
) -> Result<u8, String> {
    let token_unit = format!("{}{}", mock_policy_id, encode_hex_string(token_name));
    let final_full_denom = format!(
        "transfer/{}/transfer/{}/transfer/{}/{}",
        return_pair.cardano_channel,
        return_pair.entrypoint_channel,
        outbound_pair.entrypoint_channel,
        expected_denom_trace_base_denom(&token_unit)
    );
    let mut hasher = Sha3_256::new();
    hasher.update(final_full_denom.as_bytes());
    let digest = hasher.finalize();
    Ok(digest[0] / 16)
}

fn ensure_transfer_channel_pairs(
    project_root: &Path,
    required_pairs: usize,
) -> Result<Vec<TransferChannelPair>, String> {
    let connection_id = ensure_open_cardano_entrypoint_connection(project_root)?;
    let mut pairs = query_transfer_channel_pairs(project_root)?;
    let mut attempts = 0usize;

    while pairs.len() < required_pairs {
        attempts += 1;
        if attempts > required_pairs + 2 {
            return Err(format!(
                "Failed to provision {} Cardano↔Entrypoint transfer channel pairs (found {})",
                required_pairs,
                pairs.len()
            ));
        }

        logger::log("Creating an additional Cardano↔Entrypoint transfer channel for the benchmark...");
        create_transfer_channel_on_connection(project_root, &connection_id)?;
        std::thread::sleep(Duration::from_secs(3));
        pairs = query_transfer_channel_pairs(project_root)?;
    }

    Ok(pairs)
}

fn ensure_open_cardano_entrypoint_connection(project_root: &Path) -> Result<String, String> {
    if let Some(existing) = query_cardano_entrypoint_open_connection(project_root)? {
        return Ok(existing);
    }

    logger::log("No open Cardano↔Entrypoint connection found. Creating one for the benchmark...");
    relayer_start::hermes_create_connection(CARDANO_CHAIN_ID, entrypoint_chain_id())
        .map_err(|error| format!("Failed to create Cardano↔Entrypoint connection: {}", error))?;

    for _attempt in 0..5 {
        if let Some(connection_id) = query_cardano_entrypoint_open_connection(project_root)? {
            return Ok(connection_id);
        }
        std::thread::sleep(Duration::from_secs(3));
    }

    Err("Created a Cardano↔Entrypoint connection, but could not resolve an open connection id afterward".to_string())
}

fn query_cardano_entrypoint_open_connection(project_root: &Path) -> Result<Option<String>, String> {
    let mut connection_ids = query_connection_ids_for_chain(project_root, CARDANO_CHAIN_ID)?;
    sort_connection_ids_desc(&mut connection_ids);

    for connection_id in connection_ids {
        if is_open_cardano_entrypoint_connection(project_root, connection_id.as_str())? {
            return Ok(Some(connection_id));
        }
    }

    Ok(None)
}

fn sort_connection_ids_desc(connection_ids: &mut Vec<String>) {
    connection_ids.sort_by(|left, right| {
        parse_connection_sequence(right)
            .cmp(&parse_connection_sequence(left))
            .then_with(|| right.cmp(left))
    });
    connection_ids.dedup();
}

fn query_connection_ids_for_chain(project_root: &Path, chain_id: &str) -> Result<Vec<String>, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(["--json", "query", "connections", "--chain", chain_id])
        .output()
        .map_err(|error| format!("Failed to query Hermes connections for {}: {}", chain_id, error))?;

    if !output.status.success() {
        return Err(format!(
            "Hermes query connections failed for {}:\nstdout: {}\nstderr: {}",
            chain_id,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
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

    Ok(connection_ids)
}

fn is_open_cardano_entrypoint_connection(
    project_root: &Path,
    cardano_connection_id: &str,
) -> Result<bool, String> {
    let Some(cardano_end) =
        query_connection_end_status(project_root, CARDANO_CHAIN_ID, cardano_connection_id)?
    else {
        return Ok(false);
    };

    if !is_open_transfer_state(cardano_end.state.as_str()) {
        return Ok(false);
    }

    let Some(entrypoint_connection_id) = cardano_end.remote_connection_id.as_deref() else {
        return Ok(false);
    };
    let Some(entrypoint_end) =
        query_connection_end_status(project_root, entrypoint_chain_id(), entrypoint_connection_id)?
    else {
        return Ok(false);
    };

    if !is_open_transfer_state(entrypoint_end.state.as_str()) {
        return Ok(false);
    }
    if entrypoint_end.remote_connection_id.as_deref() != Some(cardano_connection_id) {
        return Ok(false);
    }
    if cardano_end.client_id.is_none()
        || cardano_end.remote_client_id.is_none()
        || entrypoint_end.client_id.is_none()
        || entrypoint_end.remote_client_id.is_none()
    {
        return Ok(false);
    }

    Ok(true)
}

fn query_connection_end_status(
    project_root: &Path,
    chain_id: &str,
    connection_id: &str,
) -> Result<Option<ConnectionEndStatus>, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args([
            "--json",
            "query",
            "connection",
            "end",
            "--chain",
            chain_id,
            "--connection",
            connection_id,
        ])
        .output()
        .map_err(|error| format!("Failed to query Hermes connection end: {}", error))?;

    if !output.status.success() {
        return Ok(None);
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();
    let Some(result) = parsed_lines.iter().filter_map(|entry| entry.get("result")).next_back() else {
        return Ok(None);
    };

    let state = result
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if state.is_empty() {
        return Ok(None);
    }

    let counterparty = result.get("counterparty");
    Ok(Some(ConnectionEndStatus {
        state,
        client_id: result.get("client_id").and_then(Value::as_str).map(ToOwned::to_owned),
        remote_client_id: counterparty
            .and_then(|value| value.get("client_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        remote_connection_id: counterparty
            .and_then(|value| value.get("connection_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }))
}

fn query_transfer_channel_pairs(project_root: &Path) -> Result<Vec<TransferChannelPair>, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args([
            "--json",
            "query",
            "channels",
            "--chain",
            CARDANO_CHAIN_ID,
            "--counterparty-chain",
            entrypoint_chain_id(),
        ])
        .output()
        .map_err(|error| format!("Failed to query Hermes channels: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "Hermes channel query failed:\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
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

    let mut cardano_channel_ids: Vec<String> = channel_entries
        .iter()
        .filter_map(|entry| extract_transfer_channel_id_for_ports(entry, TRANSFER_PORT, TRANSFER_PORT))
        .collect();
    cardano_channel_ids.sort_by(|left, right| {
        parse_channel_sequence(right)
            .cmp(&parse_channel_sequence(left))
            .then_with(|| right.cmp(left))
    });
    cardano_channel_ids.dedup();

    let mut pairs = Vec::new();
    for cardano_channel in cardano_channel_ids {
        let Some(cardano_end) =
            query_transfer_channel_end_status(project_root, CARDANO_CHAIN_ID, TRANSFER_PORT, &cardano_channel)?
        else {
            continue;
        };
        if !is_open_transfer_state(cardano_end.state.as_str()) {
            continue;
        }
        if cardano_end.remote_port_id.as_deref() != Some(TRANSFER_PORT) {
            continue;
        }
        let Some(entrypoint_channel) = cardano_end.remote_channel_id else {
            continue;
        };

        let Some(entrypoint_end) = query_transfer_channel_end_status(
            project_root,
            entrypoint_chain_id(),
            TRANSFER_PORT,
            &entrypoint_channel,
        )? else {
            continue;
        };
        if !is_open_transfer_state(entrypoint_end.state.as_str()) {
            continue;
        }
        if entrypoint_end.remote_port_id.as_deref() != Some(TRANSFER_PORT) {
            continue;
        }
        if entrypoint_end.remote_channel_id.as_deref() != Some(cardano_channel.as_str()) {
            continue;
        }

        pairs.push(TransferChannelPair {
            cardano_channel,
            entrypoint_channel,
        });
    }

    Ok(pairs)
}

fn query_transfer_channel_end_status(
    project_root: &Path,
    chain_id: &str,
    port_id: &str,
    channel_id: &str,
) -> Result<Option<TransferChannelEndStatus>, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args([
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
        ])
        .output()
        .map_err(|error| format!("Failed to query Hermes channel end: {}", error))?;

    if !output.status.success() {
        return Ok(None);
    }

    let parsed_lines: Vec<Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect();
    let Some(result) = parsed_lines.iter().filter_map(|entry| entry.get("result")).next_back() else {
        return Ok(None);
    };

    let state = result
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if state.is_empty() {
        return Ok(None);
    }

    let remote = result.get("remote");
    Ok(Some(TransferChannelEndStatus {
        state,
        remote_channel_id: remote
            .and_then(|value| value.get("channel_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        remote_port_id: remote
            .and_then(|value| value.get("port_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }))
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

fn extract_transfer_channel_id(entry: &Value) -> Option<String> {
    let local_port = entry.get("port_id").and_then(Value::as_str);
    let remote_port = entry
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str);
    if !(matches!(local_port, Some(TRANSFER_PORT)) || matches!(remote_port, Some(TRANSFER_PORT))) {
        return None;
    }

    let channel_id = entry
        .get("channel_id")
        .and_then(Value::as_str)
        .or_else(|| entry.get("channel_a").and_then(Value::as_str))?;
    channel_id.starts_with("channel-").then(|| channel_id.to_string())
}

fn is_open_transfer_state(state: &str) -> bool {
    state.eq_ignore_ascii_case("open")
}

fn create_transfer_channel_on_connection(project_root: &Path, connection_id: &str) -> Result<(), String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let status = Command::new(&hermes_binary)
        .args([
            "create",
            "channel",
            "--a-chain",
            CARDANO_CHAIN_ID,
            "--a-connection",
            connection_id,
            "--a-port",
            TRANSFER_PORT,
            "--b-port",
            TRANSFER_PORT,
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("Failed to execute Hermes channel creation: {}", error))?;

    if !status.success() {
        return Err(format!(
            "Hermes channel creation failed on connection {} with status {}",
            connection_id, status
        ));
    }

    Ok(())
}

fn parse_connection_sequence(connection_id: &str) -> Option<u64> {
    connection_id
        .strip_prefix("connection-")?
        .parse::<u64>()
        .ok()
}

fn parse_channel_sequence(channel_id: &str) -> Option<u64> {
    channel_id.strip_prefix("channel-")?.parse::<u64>().ok()
}

fn read_handler_json_value(project_root: &Path, json_path: &[&str]) -> Result<String, String> {
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    let deployment_json = fs::read_to_string(&deployment_path).map_err(|error| {
        format!(
            "Failed to read deployment config at {}: {}",
            deployment_path.display(),
            error
        )
    })?;
    let deployment: Value = serde_json::from_str(&deployment_json).map_err(|error| {
        format!(
            "Failed to parse deployment JSON at {}: {}",
            deployment_path.display(),
            error
        )
    })?;

    let mut cursor = &deployment;
    for segment in json_path {
        cursor = cursor.get(*segment).ok_or_else(|| {
            format!(
                "Deployment value at {} not found in {}",
                json_path.join("."),
                deployment_path.display()
            )
        })?;
    }

    cursor
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| format!("Deployment value at {} is not a string", json_path.join(".")))
}

fn get_hermes_chain_address(project_root: &Path, chain_id: &str) -> Result<String, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(["keys", "list", "--chain", chain_id])
        .output()
        .map_err(|error| format!("Failed to query Hermes keys for {}: {}", chain_id, error))?;

    if !output.status.success() {
        return Err(format!(
            "Hermes keys list failed for {}:\n{}",
            chain_id,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let cleaned =
            token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');

        if chain_id == entrypoint_chain_id() {
            if cleaned.starts_with("cosmos1") {
                return Ok(cleaned.to_string());
            }
            continue;
        }

        if chain_id == CARDANO_CHAIN_ID {
            if cleaned.starts_with("addr_test1") || cleaned.starts_with("addr1") {
                return Ok(cleaned.to_string());
            }

            let looks_like_hex_address =
                cleaned.len() == 58 && cleaned.chars().all(|c| c.is_ascii_hexdigit());
            if looks_like_hex_address {
                let address_bytes = decode_hex_bytes(cleaned)?;
                let network_id = address_bytes.first().copied().unwrap_or(0) & 0x0f;
                let hrp = if network_id == 0 { "addr_test" } else { "addr" };
                return cardano_hex_address_to_bech32(cleaned, hrp);
            }
            continue;
        }
    }

    Err(format!(
        "Could not parse {} address from Hermes keys list output:\n{}",
        chain_id,
        stdout.trim()
    ))
}

fn get_cardano_payment_credential_hex(project_root: &Path) -> Result<String, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(["keys", "list", "--chain", CARDANO_CHAIN_ID])
        .output()
        .map_err(|error| format!("Failed to query Hermes keys for Cardano: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "Hermes keys list failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let cleaned =
            token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');
        let looks_like_hex_address =
            cleaned.len() == 58 && cleaned.chars().all(|c| c.is_ascii_hexdigit());
        if !looks_like_hex_address {
            continue;
        }

        let credential = cleaned[2..].to_string();
        let looks_like_hex_credential =
            credential.len() == 56 && credential.chars().all(|c| c.is_ascii_hexdigit());
        if looks_like_hex_credential {
            return Ok(credential);
        }
    }

    Err(format!(
        "Could not parse Cardano payment credential from Hermes keys list output:\n{}",
        stdout.trim()
    ))
}

fn cardano_enterprise_address_from_payment_credential(
    project_root: &Path,
    payment_credential_hex: &str,
) -> Result<String, String> {
    let deployment_path = project_root.join("cardano/offchain/deployments/handler.json");
    let deployment_json = fs::read_to_string(&deployment_path).map_err(|error| {
        format!(
            "Failed to read deployment config at {}: {}",
            deployment_path.display(),
            error
        )
    })?;
    let deployment: Value = serde_json::from_str(&deployment_json)
        .map_err(|error| format!("Failed to parse deployment JSON: {}", error))?;
    let host_state_address = deployment["validators"]["hostStateStt"]["address"]
        .as_str()
        .ok_or_else(|| "validators.hostStateStt.address not found in deployment".to_string())?;

    let (network_id, hrp) = if host_state_address.starts_with("addr_test") {
        (0u8, "addr_test")
    } else {
        (1u8, "addr")
    };

    let credential_bytes = decode_hex_bytes(payment_credential_hex)?;
    if credential_bytes.len() != 28 {
        return Err(format!(
            "Invalid Cardano payment credential length (expected 28 bytes, got {})",
            credential_bytes.len()
        ));
    }

    let header = 0x60 | network_id;
    let mut address_bytes = Vec::with_capacity(1 + credential_bytes.len());
    address_bytes.push(header);
    address_bytes.extend_from_slice(&credential_bytes);

    bech32_encode_bytes(hrp, &address_bytes)
}

fn cardano_hex_address_to_bech32(hex_address: &str, hrp: &str) -> Result<String, String> {
    let bytes = decode_hex_bytes(hex_address)?;
    bech32_encode_bytes(hrp, &bytes)
}

fn bech32_encode_bytes(hrp: &str, bytes: &[u8]) -> Result<String, String> {
    let data = bech32_convert_bits(bytes, 8, 5, true)?
        .into_iter()
        .map(Bech32U5::try_from_u8)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "Failed to convert bytes to bech32 words".to_string())?;
    bech32_encode(hrp, &data)
}

fn bech32_encode(hrp: &str, data: &[Bech32U5]) -> Result<String, String> {
    const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    let mut checksum_input = hrp_expand(hrp);
    checksum_input.extend(data.iter().map(|value| value.0));
    checksum_input.extend([0u8; 6]);

    let polymod = bech32_polymod(&checksum_input) ^ 1;
    let mut encoded = String::with_capacity(hrp.len() + 1 + data.len() + 6);
    encoded.push_str(hrp);
    encoded.push('1');

    for value in data {
        encoded.push(CHARSET[value.0 as usize] as char);
    }
    for index in 0..6 {
        let checksum_value = ((polymod >> (5 * (5 - index))) & 31) as usize;
        encoded.push(CHARSET[checksum_value] as char);
    }

    Ok(encoded)
}

#[derive(Copy, Clone)]
struct Bech32U5(u8);

impl Bech32U5 {
    fn try_from_u8(value: u8) -> Option<Self> {
        (value < 32).then_some(Self(value))
    }
}

fn bech32_convert_bits(data: &[u8], from: u32, to: u32, pad: bool) -> Result<Vec<u8>, String> {
    let mut acc = 0u32;
    let mut bits = 0u32;
    let maxv = (1 << to) - 1;
    let mut out = Vec::new();

    for value in data {
        let v = u32::from(*value);
        if (v >> from) != 0 {
            return Err(format!("Invalid value {} for {}-bit input", v, from));
        }

        acc = (acc << from) | v;
        bits += from;
        while bits >= to {
            bits -= to;
            out.push(((acc >> bits) & maxv) as u8);
        }
    }

    if pad {
        if bits > 0 {
            out.push(((acc << (to - bits)) & maxv) as u8);
        }
    } else if bits >= from || ((acc << (to - bits)) & maxv) != 0 {
        return Err("Invalid padding in bech32 convertbits".to_string());
    }

    Ok(out)
}

fn hrp_expand(hrp: &str) -> Vec<u8> {
    let mut expanded = Vec::with_capacity(hrp.len() * 2 + 1);
    for byte in hrp.bytes() {
        expanded.push(byte >> 5);
    }
    expanded.push(0);
    for byte in hrp.bytes() {
        expanded.push(byte & 0x1f);
    }
    expanded
}

fn bech32_polymod(values: &[u8]) -> u32 {
    const GENERATORS: [u32; 5] = [
        0x3b6a57b2,
        0x26508e6d,
        0x1ea119fa,
        0x3d4233dd,
        0x2a1462b3,
    ];

    let mut chk = 1u32;
    for value in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ (*value as u32);
        for (index, generator) in GENERATORS.iter().enumerate() {
            if ((top >> index) & 1) == 1 {
                chk ^= generator;
            }
        }
    }
    chk
}

fn decode_hex_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err(format!("Invalid hex string length: {}", hex.len()));
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for index in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[index..index + 2], 16)
            .map_err(|error| format!("Invalid hex at {}: {}", index, error))?;
        bytes.push(byte);
    }
    Ok(bytes)
}

fn encode_hex_string(input: &str) -> String {
    input
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

fn extract_policy_id(token_unit: &str) -> Result<String, String> {
    if token_unit.len() < 56 || token_unit.len() % 2 != 0 || !token_unit.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("Invalid Cardano token unit '{}'", token_unit));
    }
    Ok(token_unit[..56].to_string())
}

fn expected_denom_trace_base_denom(base_denom: &str) -> String {
    if base_denom.len() % 2 == 0 && base_denom.chars().all(|c| c.is_ascii_hexdigit()) {
        base_denom.to_string()
    } else {
        encode_hex_string(base_denom)
    }
}

fn query_entrypoint_balances(address: &str) -> Result<BTreeMap<String, u128>, String> {
    let url = format!(
        "http://127.0.0.1:1317/cosmos/bank/v1beta1/balances/{}",
        address
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {}", error))?;
    let response = client
        .get(url)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|error| format!("Failed to query entrypoint balances: {}", error))?;
    let json: Value = response
        .json()
        .map_err(|error| format!("Failed to decode entrypoint balances JSON: {}", error))?;

    let balances = json
        .get("balances")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut map = BTreeMap::new();
    for coin in balances {
        let denom = coin
            .get("denom")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if denom.is_empty() {
            continue;
        }

        let amount = coin
            .get("amount")
            .and_then(Value::as_str)
            .unwrap_or("0")
            .parse::<u128>()
            .unwrap_or(0);
        map.insert(denom, amount);
    }

    Ok(map)
}

fn find_entrypoint_ibc_denom_with_min_delta(
    before: &BTreeMap<String, u128>,
    after: &BTreeMap<String, u128>,
    min_delta: u64,
) -> Result<String, String> {
    let mut candidates = Vec::new();
    for (denom, after_amount) in after {
        if !denom.starts_with("ibc/") {
            continue;
        }
        let before_amount = before.get(denom).copied().unwrap_or(0);
        let delta = after_amount.saturating_sub(before_amount);
        if delta >= min_delta as u128 {
            candidates.push((denom.clone(), delta));
        }
    }

    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    match candidates.as_slice() {
        [] => Err(format!(
            "No Entrypoint IBC denom increased by at least {}",
            min_delta
        )),
        [(denom, _delta)] => Ok(denom.clone()),
        [(denom, delta), other @ ..] => Err(format!(
            "Multiple Entrypoint IBC denoms increased by at least {}: first={} (+{}), also matched {} more",
            min_delta,
            denom,
            delta,
            other.len()
        )),
    }
}

fn query_entrypoint_denom_trace(hash: &str) -> Result<(String, String), String> {
    let url = format!("http://127.0.0.1:1317/ibc/apps/transfer/v1/denoms/{}", hash);
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {}", error))?;
    let response = client
        .get(url)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|error| format!("Failed to query Entrypoint denom trace: {}", error))?;
    let json: Value = response
        .json()
        .map_err(|error| format!("Failed to decode Entrypoint denom trace JSON: {}", error))?;

    let denom = json
        .get("denom")
        .ok_or_else(|| format!("Entrypoint denom response missing denom: {}", json))?;

    let base_denom = denom
        .get("base")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Entrypoint denom response missing base: {}", json))?;

    let trace_path = denom
        .get("trace")
        .and_then(Value::as_array)
        .map(|trace| {
            trace
                .iter()
                .map(|hop| {
                    let port_id = hop
                        .get("port_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("Entrypoint denom response missing trace.port_id: {}", json))?;
                    let channel_id = hop
                        .get("channel_id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| format!("Entrypoint denom response missing trace.channel_id: {}", json))?;
                    Ok(format!("{}/{}", port_id, channel_id))
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .transpose()?
        .unwrap_or_default()
        .join("/");

    Ok((trace_path, base_denom.to_string()))
}

fn assert_entrypoint_denom_trace(
    hash: &str,
    expected_path: &str,
    expected_base_denom: &str,
) -> Result<(), String> {
    let attempts = 5;
    let delay = Duration::from_secs(2);
    let mut last_error: Option<String> = None;

    for attempt in 1..=attempts {
        match query_entrypoint_denom_trace(hash) {
            Ok((path, base_denom)) => {
                if path != expected_path || base_denom != expected_base_denom {
                    return Err(format!(
                        "Entrypoint denom-trace mismatch for hash {}: expected path/base_denom {}/{} but got {}/{}",
                        hash, expected_path, expected_base_denom, path, base_denom
                    ));
                }
                return Ok(());
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < attempts {
                    std::thread::sleep(delay);
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Entrypoint denom-trace query failed".to_string()))
}

fn query_cardano_policy_assets(
    project_root: &Path,
    address: &str,
    policy_id: &str,
) -> Result<BTreeMap<String, u64>, Box<dyn std::error::Error>> {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .args(&[
            "compose",
            "exec",
            "-T",
            "cardano-node",
            "cardano-cli",
            "query",
            "utxo",
            "--address",
            address,
            "--testnet-magic",
            CARDANO_NETWORK_MAGIC,
            "--out-file",
            "/dev/stdout",
        ])
        .current_dir(&cardano_dir)
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Cardano UTxOs at {}:\n{}",
            address,
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    let utxo_json = String::from_utf8(output.stdout)?;
    let utxos: Value = serde_json::from_str(&utxo_json)?;
    let Some(utxo_map) = utxos.as_object() else {
        return Ok(BTreeMap::new());
    };

    let mut assets = BTreeMap::new();
    for utxo_data in utxo_map.values() {
        let Some(value_obj) = utxo_data.get("value").and_then(Value::as_object) else {
            continue;
        };
        let Some(policy_assets) = value_obj.get(policy_id).and_then(Value::as_object) else {
            continue;
        };

        for (asset_name, amount_value) in policy_assets {
            let amount = amount_value
                .as_u64()
                .or_else(|| amount_value.as_str().and_then(|raw| raw.parse::<u64>().ok()))
                .unwrap_or(0);
            if amount == 0 {
                continue;
            }
            let entry = assets.entry(asset_name.clone()).or_insert(0u64);
            *entry = (*entry).saturating_add(amount);
        }
    }

    Ok(assets)
}

fn find_policy_asset_with_min_delta(
    before: &BTreeMap<String, u64>,
    after: &BTreeMap<String, u64>,
    min_delta: u64,
) -> Result<String, String> {
    let mut candidates = Vec::new();
    for (asset_name, after_amount) in after {
        let before_amount = before.get(asset_name).copied().unwrap_or(0);
        let delta = after_amount.saturating_sub(before_amount);
        if delta >= min_delta {
            candidates.push((asset_name.clone(), delta));
        }
    }

    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    match candidates.as_slice() {
        [] => Err(format!("No policy asset increased by at least {}", min_delta)),
        [(asset_name, _delta)] => Ok(asset_name.clone()),
        [(asset_name, delta), other @ ..] => Err(format!(
            "Multiple policy assets increased by at least {}: first={} (+{}), also matched {} more assets",
            min_delta,
            asset_name,
            delta,
            other.len()
        )),
    }
}

async fn query_gateway_denom_trace(hash: &str) -> Result<(String, String), String> {
    let endpoint = tonic::transport::Endpoint::from_shared("http://localhost:5001".to_string())
        .map_err(|error| format!("Invalid Gateway gRPC endpoint: {}", error))?
        .timeout(Duration::from_secs(5));

    let channel = endpoint
        .connect()
        .await
        .map_err(|error| format!("Failed to connect to Gateway gRPC: {}", error))?;
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|error| format!("Gateway gRPC service not ready: {}", error))?;

    let request = tonic::Request::new(QueryDenomRequest {
        hash: hash.to_string(),
    });
    let path = tonic::codegen::http::uri::PathAndQuery::from_static(
        "/ibc.applications.transfer.v1.Query/Denom",
    );
    let response: QueryDenomResponse = grpc
        .unary(request, path, tonic::codec::ProstCodec::default())
        .await
        .map_err(|error| format!("Gateway denom-trace query failed: {}", error))?
        .into_inner();

    let denom = response
        .denom
        .ok_or_else(|| "Gateway denom response missing denom".to_string())?;

    let path = denom
        .trace
        .iter()
        .flat_map(|hop| [hop.port_id.clone(), hop.channel_id.clone()])
        .collect::<Vec<_>>()
        .join("/");

    Ok((path, denom.base))
}

fn assert_gateway_denom_trace(
    hash: &str,
    expected_path: &str,
    expected_base_denom: &str,
) -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|error| format!("Failed to create Tokio runtime: {}", error))?;
    runtime.block_on(async {
        let attempts = 5;
        let delay = Duration::from_secs(2);
        let mut last_error: Option<String> = None;

        for attempt in 1..=attempts {
            match query_gateway_denom_trace(hash).await {
                Ok((path, base_denom)) => {
                    if path != expected_path || base_denom != expected_base_denom {
                        return Err(format!(
                            "Gateway denom-trace mismatch for hash {}: expected path/base_denom {}/{} but got {}/{}",
                            hash, expected_path, expected_base_denom, path, base_denom
                        ));
                    }
                    return Ok(());
                }
                Err(error) => {
                    last_error = Some(error);
                    if attempt < attempts {
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "Gateway denom-trace query failed".to_string()))
    })
}

fn hermes_ft_transfer(
    project_root: &Path,
    src_chain: &str,
    dst_chain: &str,
    src_port: &str,
    src_channel: &str,
    amount: u64,
    denom: &str,
    receiver: Option<&str>,
    timeout_height_offset: u64,
    timeout_seconds: u64,
) -> Result<(), String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    logger::log(&format!(
        "Running Hermes ft-transfer {} -> {} on {} amount={} denom={}",
        src_chain, dst_chain, src_channel, amount, denom
    ));

    let mut command = Command::new(&hermes_binary);
    command
        .args(&[
            "tx",
            "ft-transfer",
            "--src-chain",
            src_chain,
            "--dst-chain",
            dst_chain,
            "--src-port",
            src_port,
            "--src-channel",
            src_channel,
            "--amount",
            &amount.to_string(),
            "--denom",
            denom,
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    if let Some(receiver_address) = receiver {
        command.args(["--receiver", receiver_address]);
    }
    if timeout_height_offset > 0 {
        command.args(["--timeout-height-offset", &timeout_height_offset.to_string()]);
    }
    if timeout_seconds > 0 {
        command.args(["--timeout-seconds", &timeout_seconds.to_string()]);
    }

    let status = command
        .status()
        .map_err(|error| format!("Failed to execute Hermes ft-transfer: {}", error))?;
    if !status.success() {
        return Err(format!(
            "Hermes ft-transfer failed for {} -> {} on channel {} with status {}",
            src_chain, dst_chain, src_channel, status
        ));
    }

    Ok(())
}

fn hermes_run_clear_packets(
    project_root: &Path,
    chain: &str,
    port: &str,
    channel: &str,
) -> Result<(), String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let status = Command::new(&hermes_binary)
        .args([
            "clear",
            "packets",
            "--chain",
            chain,
            "--port",
            port,
            "--channel",
            channel,
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("Failed to execute Hermes clear packets: {}", error))?;

    if !status.success() {
        return Err(format!(
            "Hermes clear packets failed for {}/{} with status {}",
            chain, channel, status
        ));
    }

    Ok(())
}

fn hermes_clear_packets(
    project_root: &Path,
    primary_chain: &str,
    port: &str,
    primary_channel: &str,
    counterparty_chain: &str,
    counterparty_channel: &str,
    max_attempts_override: Option<usize>,
) -> Result<(), String> {
    let max_attempts = max_attempts_override.unwrap_or(10);
    let retry_delay = Duration::from_secs(5);

    for attempt in 1..=max_attempts {
        hermes_run_clear_packets(project_root, primary_chain, port, primary_channel)?;
        hermes_run_clear_packets(project_root, counterparty_chain, port, counterparty_channel)?;

        let (primary_has_pending, _) =
            hermes_query_packet_pending(project_root, primary_chain, port, primary_channel)?;
        let (counterparty_has_pending, _) =
            hermes_query_packet_pending(project_root, counterparty_chain, port, counterparty_channel)?;

        if !primary_has_pending && !counterparty_has_pending {
            return Ok(());
        }

        if attempt < max_attempts {
            logger::log(&format!(
                "Packet clear attempt {}/{} still has pending packets; retrying in {:?}",
                attempt, max_attempts, retry_delay
            ));
            std::thread::sleep(retry_delay);
            continue;
        }

        return Err(format!(
            "Hermes clear packets left pending packets after {} attempts on {}/{} and {}/{}",
            max_attempts, primary_chain, primary_channel, counterparty_chain, counterparty_channel
        ));
    }

    Ok(())
}

fn hermes_query_packet_pending(
    project_root: &Path,
    chain: &str,
    port: &str,
    channel: &str,
) -> Result<(bool, String), String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args([
            "query",
            "packet",
            "pending",
            "--chain",
            chain,
            "--port",
            port,
            "--channel",
            channel,
        ])
        .output()
        .map_err(|error| format!("Failed to query pending packets: {}", error))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!(
            "Hermes query packet pending failed:\nstdout: {}\nstderr: {}",
            stdout, stderr
        ));
    }

    let combined = if stderr.trim().is_empty() {
        stdout.to_string()
    } else {
        format!("{}\n{}", stdout, stderr)
    };

    let mut in_unreceived_section = false;
    let has_pending_packets = combined.lines().any(|line| {
        let trimmed = line.trim();

        if trimmed.starts_with("Unreceived packets:") || trimmed.starts_with("Unreceived acks:") {
            in_unreceived_section = true;
            return false;
        }

        if trimmed.starts_with("SUCCESS")
            || trimmed.starts_with("Summary of pending packets")
            || trimmed.starts_with("Packets pending on")
        {
            in_unreceived_section = false;
            return false;
        }

        if trimmed.is_empty() || !in_unreceived_section {
            return false;
        }

        let is_sequence_line = trimmed
            .chars()
            .all(|character| character.is_ascii_digit() || ", .=-".contains(character));
        is_sequence_line && trimmed.chars().any(|character| character.is_ascii_digit())
    });

    Ok((has_pending_packets, combined))
}

fn bucket_index_for_hash_hex(hash: &str) -> Result<u8, String> {
    let first = hash
        .chars()
        .next()
        .ok_or_else(|| "Missing hash prefix".to_string())?;
    first
        .to_digit(16)
        .map(|value| value as u8)
        .ok_or_else(|| format!("Invalid voucher hash '{}'", hash))
}

fn normalize_existing_path(path: impl AsRef<Path>) -> Result<String, String> {
    let display = path.as_ref().display().to_string();
    fs::canonicalize(path.as_ref())
        .map(|resolved| resolved.to_string_lossy().to_string())
        .map_err(|error| format!("Failed to resolve required path {}: {}", display, error))
}

fn normalize_future_path(path: impl AsRef<Path>) -> Result<String, String> {
    let candidate = PathBuf::from(path.as_ref());
    if candidate.exists() {
        return normalize_existing_path(&candidate);
    }

    let parent = candidate.parent().ok_or_else(|| {
        format!(
            "Failed to resolve future path {} because it has no parent directory",
            candidate.display()
        )
    })?;
    let resolved_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Failed to resolve parent directory {} for {}: {}",
            parent.display(),
            candidate.display(),
            error
        )
    })?;

    let file_name = candidate.file_name().ok_or_else(|| {
        format!(
            "Failed to resolve future path {} because it has no file name",
            candidate.display()
        )
    })?;

    Ok(resolved_parent
        .join(file_name)
        .to_string_lossy()
        .to_string())
}

fn ensure_bridge_manifest_exists(
    gateway_dir: &Path,
    handler_json_path: &str,
    bridge_manifest_path: &str,
    profile: &config::CardanoNetworkProfile,
) -> Result<(), String> {
    if Path::new(bridge_manifest_path).exists() {
        return Ok(());
    }

    logger::log(&format!(
        "Bridge manifest not found at {}. Generating it from handler.json first...",
        bridge_manifest_path
    ));

    let status = Command::new("npm")
        .arg("run")
        .arg("export:bridge-manifest")
        .arg("--")
        .arg(handler_json_path)
        .arg(bridge_manifest_path)
        .current_dir(gateway_dir)
        .env("CARDANO_CHAIN_ID", &profile.chain_id)
        .env(
            "CARDANO_CHAIN_NETWORK_MAGIC",
            profile.network_magic.to_string(),
        )
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "Failed to start bridge-manifest export from {}: {}",
                gateway_dir.display(),
                error
            )
        })?;

    if !status.success() {
        let handler_path = PathBuf::from(handler_json_path);
        let stale_handler = fs::read_to_string(&handler_path)
            .ok()
            .map(|contents| !contents.contains("\"mintIdentifier\""))
            .unwrap_or(false);

        if stale_handler {
            return Err(format!(
                "Failed to export bridge manifest for denom-registry benchmark because {} is from the pre-directory trace-registry model. Re-run `caribic start bridge --network local` on this branch to regenerate deployment artifacts, then retry.",
                handler_path.display()
            ));
        }

        return Err(format!(
            "Failed to export bridge manifest for denom-registry benchmark (status {})",
            status
        ));
    }

    Ok(())
}
