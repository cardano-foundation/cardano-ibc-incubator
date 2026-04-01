use std::path::Path;
use std::process::{Command, Stdio};
use std::{fs, path::PathBuf};

use crate::{
    config::{self, CoreCardanoNetwork},
    logger,
};
use serde::Deserialize;

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
    let normalized_handler_json_path = normalize_existing_path(
        project_root_path.join("cardano/offchain/deployments/handler.json"),
    )?;
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
    let target_bucket = match bucket {
        Some(explicit) => explicit,
        None => initial_summary
            .buckets
            .iter()
            .max_by_key(|candidate| {
                (
                    candidate.total_entries,
                    candidate.active_shard_entry_count,
                    -(candidate.bucket_index as isize),
                )
            })
            .map(|candidate| candidate.bucket_index)
            .ok_or_else(|| "Trace-registry summary returned no buckets".to_string())?,
    };
    logger::log(&format!(
        "Trace registry before benchmark: totalEntries={} maxTxSize={} headroom={} projectedActiveShardUpperBound={}",
        initial_summary.total_entries,
        initial_summary.max_tx_size,
        initial_summary.tx_headroom_bytes,
        initial_summary.projected_max_shard_datum_bytes_upper_bound
    ));
    logger::log(&format!(
        "Running fast local denom-registry benchmark inserts against bucket {} ({} inserts)",
        target_bucket, inserts
    ));

    run_fast_benchmark_inserts(
        &offchain_dir,
        &normalized_handler_json_path,
        target_bucket,
        inserts,
    )?;

    let final_summary =
        query_registry_summary(&gateway_dir, &normalized_bridge_manifest_path, &profile)?;
    logger::log(&format!(
        "Denom-registry benchmark finished: totalEntries={} maxTxSize={} projectedUpperBound={}",
        final_summary.total_entries,
        final_summary.max_tx_size,
        final_summary.projected_max_shard_datum_bytes_upper_bound
    ));
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

    Ok(())
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

    let envelope: TraceRegistrySummaryEnvelope =
        serde_json::from_slice(&output.stdout).map_err(|error| {
            format!(
                "Failed to parse trace-registry summary JSON:\nstdout: {}\nerror: {}",
                String::from_utf8_lossy(&output.stdout),
                error
            )
        })?;

    Ok(envelope.summary)
}

fn run_fast_benchmark_inserts(
    offchain_dir: &Path,
    handler_json_path: &str,
    bucket: u8,
    inserts: usize,
) -> Result<(), String> {
    let status = Command::new("deno")
        .arg("run")
        .arg("--frozen")
        .arg("--env-file=.env.default")
        .arg("--allow-net")
        .arg("--allow-env")
        .arg("--allow-read")
        .arg("--allow-ffi")
        .arg("scripts/benchmark-trace-registry-inserts.ts")
        .arg("--bucket")
        .arg(bucket.to_string())
        .arg("--inserts")
        .arg(inserts.to_string())
        .current_dir(offchain_dir)
        .env("HANDLER_JSON_PATH", handler_json_path)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "Failed to start fast denom-registry benchmark inserts in {}: {}",
                offchain_dir.display(),
                error
            )
        })?;

    if !status.success() {
        return Err(format!(
            "Fast denom-registry benchmark insert script failed with status {}",
            status
        ));
    }

    Ok(())
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
    _gateway_dir: &Path,
    handler_json_path: &str,
    bridge_manifest_path: &str,
    _profile: &config::CardanoNetworkProfile,
) -> Result<(), String> {
    if Path::new(bridge_manifest_path).exists() {
        return Ok(());
    }

    let handler_path = PathBuf::from(handler_json_path);
    if !handler_path.exists() {
        return Err(format!(
            "Bridge manifest is missing at {} and handler.json is also missing at {}. Re-run the local bridge deployment on feat/cardano-onchain-trace-registry to recreate both artifacts, then retry.",
            bridge_manifest_path,
            handler_path.display()
        ));
    }

    Err(format!(
        "Bridge manifest is missing at {}. Local devnet deployments are ephemeral, so the benchmark will not synthesize a new manifest from an existing handler.json. Re-run the local bridge deployment on feat/cardano-onchain-trace-registry so startup regenerates both artifacts, then retry.",
        bridge_manifest_path
    ))
}
