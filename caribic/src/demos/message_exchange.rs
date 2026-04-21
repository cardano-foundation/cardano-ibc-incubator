use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use dirs::home_dir;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    constants::ENTRYPOINT_CHAIN_ID,
    logger,
    start::{self, run_hermes_command, CoreServiceId, HealthTarget},
    stop::stop_relayer,
    utils::{
        execute_script, get_cardano_tip_state, parse_tendermint_client_id,
        parse_tendermint_connection_id, prompt_runtime_deployer_sk,
    },
};

const CARDANO_CHAIN_ID: &str = "cardano-devnet";
const VESSEL_CHAIN_ID: &str = ENTRYPOINT_CHAIN_ID;
const CARDANO_MESSAGE_PORT_ID: &str = "icqhost";
const VESSEL_MESSAGE_PORT_ID: &str = "icqhost";
const ASYNC_ICQ_CHANNEL_VERSION: &str = "icq-1";
const VESSEL_RELAYER_KEY_NAME: &str = "entrypoint-relayer";
const VESSEL_RELAYER_MNEMONIC: &str = "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance";
const VESSEL_DEMO_CONTAINER_NAME: &str = "entrypoint-node-prod";
const VESSEL_KEYRING_CONTAINER_PATH: &str = "/root/.entrypoint-data/node/keyring-test";
const VESSEL_RPC_ADDR: &str = "http://127.0.0.1:26657";
const VESSEL_GRPC_ADDR: &str = "http://127.0.0.1:9090";
const DEFAULT_VESSEL_IMO: &str = "9525338";
const CARDANO_MIN_SYNC_PROGRESS_FOR_MESSAGE_EXCHANGE: f64 = 99.0;
const GATEWAY_API_BASE_URL: &str = "http://127.0.0.1:8000/api";
const CARDANO_LOCAL_KUPO_URL: &str = "http://localhost:1442";
const CARDANO_LOCAL_OGMIOS_URL: &str = "http://localhost:1337";
const CARDANO_LOCAL_NETWORK_MAGIC: &str = "42";
const ASYNC_ICQ_TIMEOUT_HEIGHT_DELTA: u64 = 10_000;

#[derive(Debug, Clone)]
struct MessageChannelPair {
    cardano_channel_id: String,
    vessel_channel_id: String,
}

#[derive(Debug, Clone)]
struct ChannelEndStatus {
    state: String,
    remote_port_id: Option<String>,
    remote_channel_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ConnectionEndStatus {
    state: String,
    client_id: Option<String>,
    remote_client_id: Option<String>,
    remote_connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GatewayUnsignedTx {
    value: String,
}

#[derive(Debug, Deserialize)]
struct BuiltVesseloracleIcqTx {
    query_path: String,
    packet_data_hex: String,
    unsigned_tx: GatewayUnsignedTx,
}

#[derive(Debug, Deserialize)]
struct WalletAddressOutput {
    address: String,
}

#[derive(Debug, Deserialize)]
struct SignedTxOutput {
    tx_hash: String,
}

/// Runs the message-exchange demo by querying Entrypoint vesseloracle state from Cardano via async-ICQ.
pub async fn run_message_exchange_demo(project_root_path: &Path) -> Result<(), String> {
    ensure_message_exchange_prerequisites(project_root_path)?;
    refresh_gateway_epoch_nonce_for_stability(project_root_path).await?;

    logger::log("PASS: Native Cosmos Entrypoint chain is up and running");

    start::start_relayer(
        project_root_path.join("relayer").as_path(),
        project_root_path.join("relayer/.env.example").as_path(),
        project_root_path.join("relayer/examples").as_path(),
        project_root_path
            .join("cardano/offchain/deployments/handler.json")
            .as_path(),
        CARDANO_CHAIN_ID,
        true,
        None,
    )
    .map_err(|error| format!("ERROR: Failed to prepare Hermes relayer: {}", error))?;
    logger::log("PASS: Hermes relayer configuration prepared");

    stop_relayer(project_root_path.join("relayer").as_path());
    configure_hermes_for_message_exchange()?;
    if gateway_uses_mithril(project_root_path) {
        logger::verbose(
            "Checking Mithril artifact readiness before message-exchange channel setup",
        );
        wait_for_mithril_artifacts_for_message_exchange().await?;
    }
    let channel_pair = ensure_message_exchange_channel()?;

    start::start_hermes_daemon()
        .map_err(|error| format!("ERROR: Failed to start Hermes daemon: {}", error))?;
    logger::log("PASS: Hermes daemon started");

    let datasource_dir = project_root_path.join("cosmos/entrypoint/datasource");
    if !datasource_dir.exists() {
        return Err(format!(
            "ERROR: Datasource directory is missing at {}",
            datasource_dir.display()
        ));
    }
    let datasource_home = prepare_datasource_home(project_root_path)?;
    logger::log("Preparing vessel datasource module");
    run_datasource_command(
        datasource_dir.as_path(),
        &["mod", "tidy"],
        datasource_home.as_str(),
    )?;
    logger::log("Submitting simulated vessel reports");
    if let Err(error) = run_datasource_command(
        datasource_dir.as_path(),
        &["run", ".", "report", "-simulate"],
        datasource_home.as_str(),
    ) {
        if error.contains("index already set") {
            logger::log("PASS: Simulated vessel reports already exist on entrypoint; continuing");
        } else {
            return Err(error);
        }
    }
    logger::log("Consolidating submitted vessel reports");
    run_datasource_command(
        datasource_dir.as_path(),
        &["run", ".", "consolidate"],
        datasource_home.as_str(),
    )?;

    let signer = resolve_cardano_demo_signer_address(project_root_path)?;
    let built_icq_tx = build_vesseloracle_icq_transaction(
        channel_pair.cardano_channel_id.as_str(),
        signer.as_str(),
        DEFAULT_VESSEL_IMO,
    )
    .await?;
    let source_tx_hash = sign_and_submit_cardano_icq_transaction(
        project_root_path,
        built_icq_tx.unsigned_tx.value.as_str(),
    )?;
    logger::log(&format!(
        "PASS: Submitted Cardano async-ICQ packet transaction {}",
        source_tx_hash
    ));

    wait_for_cardano_icq_packet_relay_readiness(&channel_pair)?;
    relay_async_icq_packet(&channel_pair)?;

    let icq_result = wait_for_vesseloracle_icq_result(
        source_tx_hash.as_str(),
        built_icq_tx.query_path.as_str(),
        built_icq_tx.packet_data_hex.as_str(),
    )
    .await?;
    logger::log(&format!(
        "PASS: Async-ICQ acknowledgement completed at height {}",
        icq_result
            .get("completed_height")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    ));
    logger::verbose(&format!(
        "Decoded vesseloracle ICQ acknowledgement: {}",
        serde_json::to_string_pretty(&icq_result).unwrap_or_else(|_| icq_result.to_string())
    ));

    logger::log("\nPASS: Message exchange demo flow completed successfully");
    Ok(())
}

fn ensure_message_exchange_prerequisites(project_root_path: &Path) -> Result<(), String> {
    let mut failures = Vec::new();

    for target in message_exchange_targets(project_root_path) {
        match start::check_health_target(project_root_path, target) {
            Ok((true, _)) => {}
            Ok((false, status)) => failures.push(format!("{}: {}", target.name(), status)),
            Err(error) => failures.push(format!("{}: {}", target.name(), error)),
        }
    }

    if failures.is_empty() {
        return ensure_cardano_demo_window(project_root_path);
    }

    let mut error = String::from(
        "ERROR: Message-exchange demo prerequisites are not met. Start the bridge first.\n",
    );
    for failure in failures {
        error.push_str(format!("  - {failure}\n").as_str());
    }
    let recommended_start = if gateway_uses_mithril(project_root_path) {
        "caribic start --clean --with-mithril"
    } else {
        "caribic start --clean"
    };
    error.push_str(format!("\nRequired command:\n  - {recommended_start}").as_str());
    Err(error)
}

fn ensure_cardano_demo_window(project_root_path: &Path) -> Result<(), String> {
    let tip_state = get_cardano_tip_state(project_root_path)
        .map_err(|error| format!("Failed to query Cardano tip state before demo: {}", error))?;
    let tip_json: Value = serde_json::from_str(tip_state.as_str()).map_err(|error| {
        format!(
            "Failed to parse Cardano tip state JSON before demo: {}",
            error
        )
    })?;

    let epoch = tip_json
        .get("epoch")
        .and_then(parse_u64_value)
        .ok_or("Cardano tip state is missing 'epoch'".to_string())?;
    let slot = tip_json
        .get("slot")
        .and_then(parse_u64_value)
        .ok_or("Cardano tip state is missing 'slot'".to_string())?;
    let slots_to_epoch_end = tip_json
        .get("slotsToEpochEnd")
        .and_then(parse_u64_value)
        .ok_or("Cardano tip state is missing 'slotsToEpochEnd'".to_string())?;
    let sync_progress = tip_json
        .get("syncProgress")
        .and_then(parse_f64_value)
        .ok_or("Cardano tip state is missing 'syncProgress'".to_string())?;

    if sync_progress < CARDANO_MIN_SYNC_PROGRESS_FOR_MESSAGE_EXCHANGE {
        return Err(format!(
            "ERROR: Cardano devnet is not in a safe state for the message-exchange demo.\n\
             Tip snapshot: epoch={epoch}, slot={slot}, slotsToEpochEnd={slots_to_epoch_end}, syncProgress={sync_progress:.2}%\n\
             \n\
             This usually indicates stale/lagging Cardano chain state and leads to Hermes create-client and packet-relay failures.\n\
             Recommended recovery:\n\
               1. caribic stop\n\
               2. {}\n\
               3. caribic demo message-exchange"
            ,
            if gateway_uses_mithril(project_root_path) {
                "caribic start --clean --with-mithril"
            } else {
                "caribic start --clean"
            }
        ));
    }

    Ok(())
}

fn gateway_light_client_mode(project_root: &Path) -> &'static str {
    let gateway_env_path = project_root.join("cardano/gateway/.env");
    let env_contents = fs::read_to_string(&gateway_env_path).unwrap_or_default();

    for line in env_contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("CARDANO_LIGHT_CLIENT_MODE=") {
            let mode = value.trim().trim_matches('"').trim_matches('\'');
            if mode == "mithril" {
                return "mithril";
            }
        }
    }

    "stake-weighted-stability"
}

fn gateway_uses_mithril(project_root: &Path) -> bool {
    gateway_light_client_mode(project_root) == "mithril"
}

fn normalize_env_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn set_or_append_gateway_env_var(
    gateway_env_path: &Path,
    key: &str,
    value: &str,
) -> Result<bool, String> {
    let existing = fs::read_to_string(gateway_env_path).unwrap_or_default();
    let mut found = false;
    let mut changed = false;
    let desired_line = format!("{key}={value}");
    let mut updated_lines = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim_start();
        if let Some((existing_key, _)) = trimmed.split_once('=') {
            if existing_key == key {
                found = true;
                if trimmed != desired_line {
                    changed = true;
                    updated_lines.push(desired_line.clone());
                } else {
                    updated_lines.push(line.to_string());
                }
                continue;
            }
        }

        updated_lines.push(line.to_string());
    }

    if !found {
        changed = true;
        updated_lines.push(desired_line);
    }

    if changed {
        let mut updated = updated_lines.join("\n");
        if !updated.ends_with('\n') {
            updated.push('\n');
        }
        fs::write(gateway_env_path, updated).map_err(|error| {
            format!(
                "Failed updating Gateway env file {}: {}",
                gateway_env_path.display(),
                error
            )
        })?;
    }

    Ok(changed)
}

fn query_current_cardano_epoch_nonce(project_root: &Path) -> Result<String, String> {
    let cardano_dir = project_root.join("chains/cardano");
    let output = Command::new("docker")
        .arg("compose")
        .arg("exec")
        .arg("-T")
        .arg("cardano-node")
        .arg("cardano-cli")
        .arg("query")
        .arg("protocol-state")
        .arg("--cardano-mode")
        .arg("--testnet-magic")
        .arg("42")
        .current_dir(cardano_dir.as_path())
        .output()
        .map_err(|error| format!("Failed to query Cardano protocol-state: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to query Cardano protocol-state for epoch nonce (exit code {:?}):\nstdout: {}\nstderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ));
    }

    let protocol_state: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "Failed to parse Cardano protocol-state JSON while reading epoch nonce: {}",
            error
        )
    })?;
    protocol_state
        .get("epochNonce")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .ok_or_else(|| "Failed to extract epochNonce from Cardano protocol-state".to_string())
}

async fn check_service_health(client: &reqwest::Client, url: &str) -> bool {
    match client.get(url).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn wait_for_service_health(
    client: &reqwest::Client,
    url: &str,
    max_attempts: usize,
    interval: Duration,
) -> bool {
    let start = Instant::now();
    for attempt in 0..max_attempts {
        if check_service_health(client, url).await {
            return true;
        }
        logger::verbose(&format!(
            "Waiting for {} (attempt {}/{}, elapsed {}s)...",
            url,
            attempt + 1,
            max_attempts,
            start.elapsed().as_secs()
        ));
        tokio::time::sleep(interval).await;
    }
    false
}

async fn refresh_gateway_epoch_nonce_for_stability(project_root: &Path) -> Result<(), String> {
    if gateway_uses_mithril(project_root) {
        return Ok(());
    }

    let current_epoch_nonce = query_current_cardano_epoch_nonce(project_root)?;
    let gateway_env_path = project_root.join("cardano/gateway/.env");
    let configured_epoch_nonce =
        crate::setup::read_gateway_env_value(&gateway_env_path, "CARDANO_EPOCH_NONCE_GENESIS")
            .map_err(|error| format!("Failed reading Gateway epoch nonce from env: {}", error))?
            .map(|value| normalize_env_value(&value))
            .unwrap_or_default();

    if configured_epoch_nonce == current_epoch_nonce {
        logger::verbose("Gateway epoch nonce already matches current Cardano epoch");
        return Ok(());
    }

    logger::log(&format!(
        "Refreshing Gateway epoch nonce for stability mode: {} -> {}",
        if configured_epoch_nonce.is_empty() {
            "<empty>"
        } else {
            configured_epoch_nonce.as_str()
        },
        current_epoch_nonce.as_str()
    ));

    set_or_append_gateway_env_var(
        &gateway_env_path,
        "CARDANO_EPOCH_NONCE_GENESIS",
        format!("\"{}\"", current_epoch_nonce).as_str(),
    )?;

    let gateway_dir = project_root.join("cardano/gateway");
    let recreate_output = Command::new("docker")
        .arg("compose")
        .arg("up")
        .arg("-d")
        .arg("--force-recreate")
        .arg("app")
        .current_dir(gateway_dir.as_path())
        .output()
        .map_err(|error| format!("Failed to recreate Gateway app container: {}", error))?;

    if !recreate_output.status.success() {
        return Err(format!(
            "Failed to recreate Gateway after epoch nonce refresh (exit code {:?}):\nstdout: {}\nstderr: {}",
            recreate_output.status.code(),
            String::from_utf8_lossy(&recreate_output.stdout),
            String::from_utf8_lossy(&recreate_output.stderr),
        ));
    }

    let http_client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("Failed to build Gateway HTTP client: {}", error))?;
    let gateway_healthy = wait_for_service_health(
        &http_client,
        "http://127.0.0.1:8000/health/ready",
        30,
        Duration::from_secs(2),
    )
    .await;

    if !gateway_healthy {
        return Err(
            "Gateway did not become proof-ready after epoch nonce refresh/recreate".to_string(),
        );
    }

    logger::log("PASS: Gateway refreshed with current Cardano epoch nonce");
    Ok(())
}

fn message_exchange_targets(project_root: &Path) -> Vec<HealthTarget> {
    let mut targets = vec![
        HealthTarget::Core(CoreServiceId::Gateway),
        HealthTarget::Core(CoreServiceId::Cardano),
        HealthTarget::Core(CoreServiceId::Postgres),
        HealthTarget::Core(CoreServiceId::Kupo),
        HealthTarget::Core(CoreServiceId::Ogmios),
        HealthTarget::Core(CoreServiceId::Entrypoint),
    ];
    if gateway_uses_mithril(project_root) {
        targets.push(HealthTarget::Core(CoreServiceId::Mithril));
    }
    targets
}

async fn wait_for_mithril_artifacts_for_message_exchange() -> Result<(), String> {
    let demo_config = crate::config::get_config().demo;
    let message_exchange_config = demo_config.message_exchange;
    let max_retries = demo_config.mithril_artifact_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: demo.mithril_artifact_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let retry_delay_secs = demo_config.mithril_artifact_retry_delay_secs;
    if retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.mithril_artifact_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let progress_interval_secs = message_exchange_config.mithril_readiness_progress_interval_secs;
    if progress_interval_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.mithril_readiness_progress_interval_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let total_wait_secs = (max_retries as u64).saturating_mul(retry_delay_secs);

    logger::verbose("Waiting for Mithril stake distributions and cardano-transactions artifacts");
    logger::log(&format!(
        "Waiting for Mithril artifacts to become available (up to {} minutes)...",
        total_wait_secs / 60
    ));
    let aggregator_base_url = crate::config::get_config()
        .mithril
        .aggregator_url
        .trim_end_matches('/')
        .to_string();
    let stake_distributions_url =
        format!("{aggregator_base_url}/aggregator/artifact/mithril-stake-distributions");
    let cardano_transactions_url =
        format!("{aggregator_base_url}/aggregator/artifact/cardano-transactions");
    let certificates_url = format!("{aggregator_base_url}/aggregator/certificates");

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| format!("Failed to build Mithril HTTP client: {}", error))?;

    let progress_log_every = (progress_interval_secs / retry_delay_secs).max(1);
    let mut last_stake_count: Option<usize> = None;
    let mut last_tx_count: Option<usize> = None;
    let mut last_certificate_count: Option<usize> = None;

    for attempt in 1..=max_retries {
        let stake_count = fetch_json_array_len(&client, stake_distributions_url.as_str()).await;
        let tx_count = fetch_json_array_len(&client, cardano_transactions_url.as_str()).await;
        let certificate_count = fetch_json_array_len(&client, certificates_url.as_str()).await;

        last_stake_count = stake_count;
        last_tx_count = tx_count;
        last_certificate_count = certificate_count;

        let stake_ready = stake_count.is_some_and(|len| len > 0);
        let tx_ready = tx_count.is_some_and(|len| len > 0);

        logger::verbose(&format!(
            "Mithril artifact readiness check (attempt {attempt}/{}): certificates={}, stake_distributions={}, cardano_transactions={}, stake_ready={stake_ready}, tx_ready={tx_ready}",
            max_retries,
            format_optional_count(certificate_count),
            format_optional_count(stake_count),
            format_optional_count(tx_count),
        ));

        if attempt == 1 || attempt % progress_log_every as usize == 0 {
            logger::log(&format!(
                "Mithril readiness: certificates={}, stake_distributions={}, cardano_transactions={} (attempt {attempt}/{max_retries})",
                format_optional_count(certificate_count),
                format_optional_count(stake_count),
                format_optional_count(tx_count),
            ));
        }

        if stake_ready && tx_ready {
            logger::log("PASS: Mithril artifacts are available for message-exchange setup");
            return Ok(());
        }

        tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
    }

    Err(format!(
        "Mithril artifacts did not become available in time for message-exchange channel setup.\n\
         Last observed counts: certificates={}, stake_distributions={}, cardano_transactions={}\n\
         Checked endpoints:\n\
         - {}\n\
         - {}\n\
         - {}",
        format_optional_count(last_certificate_count),
        format_optional_count(last_stake_count),
        format_optional_count(last_tx_count),
        certificates_url,
        stake_distributions_url,
        cardano_transactions_url
    ))
}

async fn fetch_json_array_len(client: &reqwest::Client, url: &str) -> Option<usize> {
    match client.get(url).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|value| value.as_array().map(|arr| arr.len())),
        _ => None,
    }
}

fn format_optional_count(value: Option<usize>) -> String {
    value
        .map(|count| count.to_string())
        .unwrap_or_else(|| "n/a".to_string())
}

fn prepare_datasource_home(project_root_path: &Path) -> Result<String, String> {
    let user_home = home_dir()
        .ok_or("Failed to resolve user home directory for message-exchange datasource")?;
    let datasource_home = user_home
        .join(".caribic")
        .join("message-exchange-datasource-home");
    let vessel_home = datasource_home.join(".entrypoint");
    let keyring_home = vessel_home.join("keyring-test");

    fs::create_dir_all(vessel_home.as_path()).map_err(|error| {
        format!(
            "Failed to create datasource home at {}: {}",
            vessel_home.display(),
            error
        )
    })?;
    if keyring_home.exists() {
        fs::remove_dir_all(keyring_home.as_path()).map_err(|error| {
            format!(
                "Failed to reset datasource keyring at {}: {}",
                keyring_home.display(),
                error
            )
        })?;
    }

    let source = format!(
        "{}:{}",
        VESSEL_DEMO_CONTAINER_NAME, VESSEL_KEYRING_CONTAINER_PATH
    );
    let destination = vessel_home.to_string_lossy().to_string();
    execute_script(
        project_root_path,
        "docker",
        vec!["cp", source.as_str(), destination.as_str()],
        None,
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to sync entrypoint keyring from container {}: {}",
            VESSEL_DEMO_CONTAINER_NAME, error
        )
    })?;

    if !keyring_home.join("ds0.info").exists() || !keyring_home.join("bob.info").exists() {
        return Err(format!(
            "Synced datasource keyring is incomplete at {} (missing ds0.info or bob.info)",
            keyring_home.display()
        ));
    }

    logger::log("PASS: Synced entrypoint datasource keyring for local Go commands");
    Ok(datasource_home.to_string_lossy().to_string())
}

fn run_datasource_command(
    datasource_dir: &Path,
    args: &[&str],
    datasource_home: &str,
) -> Result<(), String> {
    execute_script(
        datasource_dir,
        "go",
        args.to_vec(),
        Some(vec![("HOME", datasource_home), ("GOWORK", "off")]),
    )
    .map(|_| ())
    .map_err(|error| format!("ERROR: Failed running datasource command: {}", error))
}

async fn build_vesseloracle_icq_transaction(
    source_channel: &str,
    signer: &str,
    imo: &str,
) -> Result<BuiltVesseloracleIcqTx, String> {
    let timeout_height = query_entrypoint_latest_height().await? + ASYNC_ICQ_TIMEOUT_HEIGHT_DELTA;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build Gateway HTTP client: {}", error))?;
    let url = format!(
        "{}/icq/vesseloracle/latest-consolidated-data-report",
        GATEWAY_API_BASE_URL
    );
    // The demo now discovers the latest consolidated report over ICQ as well,
    // so Cardano only needs the IMO and no longer side-reads Entrypoint for a timestamp.
    let response = client
        .post(url.as_str())
        .json(&json!({
            "source_channel": source_channel,
            "signer": signer,
            "imo": imo,
            "timeout_height": {
                "revision_number": 0,
                "revision_height": timeout_height.to_string(),
            },
        }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Failed to request vesseloracle async-ICQ transaction: {}",
                error
            )
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        format!(
            "Failed reading vesseloracle async-ICQ response body: {}",
            error
        )
    })?;
    if !status.is_success() {
        return Err(format!(
            "Gateway failed building vesseloracle async-ICQ transaction (status={}): {}",
            status, body
        ));
    }

    serde_json::from_str::<BuiltVesseloracleIcqTx>(body.as_str()).map_err(|error| {
        format!(
            "Failed to parse vesseloracle async-ICQ transaction response JSON: {}. Body: {}",
            error, body
        )
    })
}

async fn query_entrypoint_latest_height() -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Failed to build Entrypoint RPC client: {}", error))?;
    let response = client
        .get(format!("{}/status", VESSEL_RPC_ADDR))
        .send()
        .await
        .map_err(|error| format!("Failed querying Entrypoint latest height: {}", error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed reading Entrypoint latest height body: {}", error))?;
    if !status.is_success() {
        return Err(format!(
            "Entrypoint RPC failed while querying latest height (status={}): {}",
            status, body
        ));
    }

    let value = serde_json::from_str::<Value>(body.as_str()).map_err(|error| {
        format!(
            "Failed to parse Entrypoint status JSON while querying latest height: {}. Body: {}",
            error, body
        )
    })?;
    let latest_height = value
        .get("result")
        .and_then(|result| result.get("sync_info"))
        .and_then(|sync_info| sync_info.get("latest_block_height"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!(
                "Entrypoint status missing latest_block_height. Body: {}",
                body
            )
        })?;

    latest_height.parse::<u64>().map_err(|error| {
        format!(
            "Failed parsing Entrypoint latest_block_height '{}' as u64: {}",
            latest_height, error
        )
    })
}

fn resolve_cardano_demo_signer_address(project_root_path: &Path) -> Result<String, String> {
    let deployer_sk = resolve_local_cardano_deployer_sk(project_root_path)?;
    let offchain_dir = project_root_path.join("cardano/offchain");
    let output = execute_script(
        offchain_dir.as_path(),
        "deno",
        vec!["run", "-A", "scripts/get-wallet-address.ts"],
        Some(vec![
            ("DEPLOYER_SK", deployer_sk.as_str()),
            ("KUPO_URL", CARDANO_LOCAL_KUPO_URL),
            ("OGMIOS_URL", CARDANO_LOCAL_OGMIOS_URL),
            ("CARDANO_NETWORK_MAGIC", CARDANO_LOCAL_NETWORK_MAGIC),
        ]),
    )
    .map_err(|error| format!("Failed resolving Cardano demo signer address: {}", error))?;

    let parsed = serde_json::from_str::<WalletAddressOutput>(output.as_str()).map_err(|error| {
        format!(
            "Failed to parse Cardano signer address JSON output: {}. Output: {}",
            error, output
        )
    })?;

    Ok(parsed.address)
}

fn sign_and_submit_cardano_icq_transaction(
    project_root_path: &Path,
    unsigned_tx_base64: &str,
) -> Result<String, String> {
    let deployer_sk = resolve_local_cardano_deployer_sk(project_root_path)?;
    let unsigned_tx_path = std::env::temp_dir().join(format!(
        "caribic-message-exchange-unsigned-{}.txt",
        std::process::id()
    ));
    fs::write(unsigned_tx_path.as_path(), unsigned_tx_base64).map_err(|error| {
        format!(
            "Failed to write temporary unsigned transaction file at {}: {}",
            unsigned_tx_path.display(),
            error
        )
    })?;

    let unsigned_tx_arg = unsigned_tx_path.to_string_lossy().to_string();
    let offchain_dir = project_root_path.join("cardano/offchain");
    let output = execute_script(
        offchain_dir.as_path(),
        "deno",
        vec![
            "run",
            "-A",
            "scripts/sign-submit-unsigned-tx.ts",
            unsigned_tx_arg.as_str(),
        ],
        Some(vec![
            ("DEPLOYER_SK", deployer_sk.as_str()),
            ("KUPO_URL", CARDANO_LOCAL_KUPO_URL),
            ("OGMIOS_URL", CARDANO_LOCAL_OGMIOS_URL),
            ("CARDANO_NETWORK_MAGIC", CARDANO_LOCAL_NETWORK_MAGIC),
        ]),
    )
    .map_err(|error| {
        format!(
            "Failed signing/submitting Cardano async-ICQ transaction: {}",
            error
        )
    });
    let _ = fs::remove_file(unsigned_tx_path.as_path());
    let output = output?;

    let parsed = serde_json::from_str::<SignedTxOutput>(output.as_str()).map_err(|error| {
        format!(
            "Failed to parse signed Cardano transaction JSON output: {}. Output: {}",
            error, output
        )
    })?;

    Ok(parsed.tx_hash)
}

fn resolve_local_cardano_deployer_sk(project_root_path: &Path) -> Result<String, String> {
    if let Ok(value) = std::env::var("DEPLOYER_SK") {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    let devnet_key_path = project_root_path.join("chains/cardano/config/credentials/me.sk");
    if let Ok(value) = fs::read_to_string(devnet_key_path.as_path()) {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    prompt_runtime_deployer_sk()
        .map(|value| value.trim().to_string())
        .map_err(|error| {
            format!(
                "Failed to resolve DEPLOYER_SK for local Cardano demo: {}",
                error
            )
        })
}

async fn wait_for_vesseloracle_icq_result(
    tx_hash: &str,
    query_path: &str,
    packet_data_hex: &str,
) -> Result<Value, String> {
    let message_exchange_config = crate::config::get_config().demo.message_exchange;
    let max_retries = message_exchange_config.relay_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let retry_delay_secs = message_exchange_config.relay_retry_delay_secs;
    if retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build Gateway HTTP client: {}", error))?;
    let url = format!("{}/icq/vesseloracle/result", GATEWAY_API_BASE_URL);
    let mut since_height: Option<String> = None;

    for attempt in 1..=max_retries {
        let mut payload = json!({
            "tx_hash": tx_hash,
            "query_path": query_path,
            "packet_data_hex": packet_data_hex,
        });
        if let Some(cursor) = since_height.as_ref() {
            payload["since_height"] = Value::String(cursor.clone());
        }

        let response = client
            .post(url.as_str())
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("Failed polling vesseloracle async-ICQ result: {}", error))?;
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            format!(
                "Failed reading vesseloracle async-ICQ result body: {}",
                error
            )
        })?;

        if !status.is_success() {
            return Err(format!(
                "Gateway failed polling vesseloracle async-ICQ result (status={}): {}",
                status, body
            ));
        }

        let result = serde_json::from_str::<Value>(body.as_str()).map_err(|error| {
            format!(
                "Failed to parse vesseloracle async-ICQ result JSON: {}. Body: {}",
                error, body
            )
        })?;

        if result.get("status").and_then(Value::as_str) == Some("completed") {
            return Ok(result);
        }

        since_height = result
            .get("next_search_from_height")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty());

        logger::verbose(&format!(
            "Waiting for vesseloracle async-ICQ acknowledgement (attempt {attempt}/{}): {}",
            max_retries,
            serde_json::to_string(&result).unwrap_or_else(|_| result.to_string())
        ));
        tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
    }

    Err(format!(
        "Timed out waiting for vesseloracle async-ICQ acknowledgement for tx {}",
        tx_hash
    ))
}

fn parse_f64_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

fn parse_u64_value(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<u64>().ok()))
}

fn configure_hermes_for_message_exchange() -> Result<(), String> {
    let home = home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let config_path = home.join(".hermes").join("config.toml");
    if !config_path.exists() {
        return Err(format!(
            "Hermes config was not found at {}. Run `caribic start relayer` first.",
            config_path.display()
        ));
    }

    let existing_config = fs::read_to_string(config_path.as_path())
        .map_err(|error| format!("Failed to read Hermes config: {}", error))?;
    let updated_config = upsert_chain_block(
        existing_config.as_str(),
        VESSEL_CHAIN_ID,
        vessel_chain_block().as_str(),
    )?;

    fs::write(config_path.as_path(), updated_config)
        .map_err(|error| format!("Failed to write Hermes config: {}", error))?;
    logger::log("PASS: Hermes config updated for message-exchange on entrypoint chain");

    let mnemonic_file = std::env::temp_dir().join("entrypoint-relayer-mnemonic.txt");
    fs::write(mnemonic_file.as_path(), VESSEL_RELAYER_MNEMONIC).map_err(|error| {
        format!(
            "Failed to write temporary entrypoint mnemonic file: {}",
            error
        )
    })?;

    let mnemonic_file_arg = mnemonic_file.to_string_lossy().to_string();
    let add_key_output = run_hermes_command(&[
        "keys",
        "add",
        "--overwrite",
        "--chain",
        VESSEL_CHAIN_ID,
        "--mnemonic-file",
        mnemonic_file_arg.as_str(),
    ])
    .map_err(|error| format!("Failed to run Hermes key setup command: {}", error))?;
    let _ = fs::remove_file(mnemonic_file.as_path());

    if !add_key_output.status.success() {
        return Err(format!(
            "Failed to add entrypoint key in Hermes:\n{}",
            String::from_utf8_lossy(&add_key_output.stderr)
        ));
    }

    logger::log("PASS: Hermes key added for entrypoint");
    Ok(())
}

fn vessel_chain_block() -> String {
    format!(
        r#"[[chains]]
id = '{id}'
type = 'CosmosSdk'
rpc_addr = '{rpc_addr}'
grpc_addr = '{grpc_addr}'
rpc_timeout = '10s'
account_prefix = 'cosmos'
key_name = '{key_name}'
store_prefix = 'ibc'
default_gas = 200000
max_gas = 5000000
gas_price = {{ price = 0.025, denom = 'stake' }}
gas_multiplier = 1.1
max_msg_num = 30
max_tx_size = 2097152
clock_drift = '5s'
max_block_time = '30s'
trusting_period = '14days'
trust_threshold = {{ numerator = '2', denominator = '3' }}
event_source = {{ mode = 'push', url = 'ws://127.0.0.1:26657/websocket', batch_delay = '500ms' }}

[chains.packet_filter]
policy = 'allow'
list = [
  ['icqhost', '*'],
  ['transfer', '*'],
]

address_type = {{ derivation = 'cosmos' }}
"#,
        id = VESSEL_CHAIN_ID,
        rpc_addr = VESSEL_RPC_ADDR,
        grpc_addr = VESSEL_GRPC_ADDR,
        key_name = VESSEL_RELAYER_KEY_NAME
    )
}

fn upsert_chain_block(
    config: &str,
    chain_id: &str,
    replacement_block: &str,
) -> Result<String, String> {
    let lines: Vec<&str> = config.lines().collect();
    if let Some((block_start, block_end)) = find_chain_block_bounds(&lines, chain_id) {
        let mut updated_lines: Vec<&str> = Vec::with_capacity(
            lines.len() - (block_end - block_start) + replacement_block.lines().count(),
        );
        updated_lines.extend_from_slice(&lines[..block_start]);
        updated_lines.extend(replacement_block.lines());
        updated_lines.extend_from_slice(&lines[block_end..]);
        let mut updated = updated_lines.join("\n");
        if !updated.ends_with('\n') {
            updated.push('\n');
        }
        return Ok(updated);
    }

    let mut updated = config.to_string();
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated.push('\n');
    updated.push_str("# Message exchange demo chain configuration\n");
    updated.push_str(replacement_block);
    if !updated.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn find_chain_block_bounds(lines: &[&str], target_chain_id: &str) -> Option<(usize, usize)> {
    let single_quote_id = format!("id = '{}'", target_chain_id);
    let double_quote_id = format!("id = \"{}\"", target_chain_id);
    let mut cursor = 0;

    while cursor < lines.len() {
        if lines[cursor].trim() != "[[chains]]" {
            cursor += 1;
            continue;
        }

        let block_start = cursor;
        let mut block_end = cursor + 1;
        while block_end < lines.len() && lines[block_end].trim() != "[[chains]]" {
            block_end += 1;
        }

        if lines[block_start..block_end].iter().any(|line| {
            let trimmed = line.trim();
            trimmed == single_quote_id || trimmed == double_quote_id
        }) {
            return Some((block_start, block_end));
        }

        cursor = block_end;
    }

    None
}

fn ensure_message_exchange_channel() -> Result<MessageChannelPair, String> {
    let message_exchange_config = crate::config::get_config().demo.message_exchange;
    let channel_discovery_max_retries = message_exchange_config.channel_discovery_max_retries;
    if channel_discovery_max_retries == 0 {
        return Err(
            "Invalid config: demo.message_exchange.channel_discovery_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let channel_discovery_max_retries_after_create =
        message_exchange_config.channel_discovery_max_retries_after_create;
    if channel_discovery_max_retries_after_create == 0 {
        return Err(
            "Invalid config: demo.message_exchange.channel_discovery_max_retries_after_create must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let channel_discovery_retry_delay_secs =
        message_exchange_config.channel_discovery_retry_delay_secs;
    if channel_discovery_retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.channel_discovery_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if let Some(pair) = wait_for_open_message_channel_pair(
        channel_discovery_max_retries,
        channel_discovery_retry_delay_secs,
    )? {
        logger::log(&format!(
            "PASS: Message-exchange channel already open (cardano={}, entrypoint={})",
            pair.cardano_channel_id, pair.vessel_channel_id
        ));
        return Ok(pair);
    }

    logger::log("No open message-exchange channel found. Creating one now.");
    // Keep this flow explicit and fail hard.
    // We intentionally avoid Hermes `--new-client-connection` here because it can hide
    // partial state and lead to non-deterministic behavior.
    let connection_id = ensure_open_message_exchange_connection()?;
    create_message_exchange_channel_on_connection(connection_id.as_str())?;

    let pair = wait_for_open_message_channel_pair(
        channel_discovery_max_retries_after_create,
        channel_discovery_retry_delay_secs,
    )?
    .ok_or_else(|| {
        "Created message-exchange channel, but no open channel pair could be discovered".to_string()
    })?;
    logger::log(&format!(
        "PASS: Created message-exchange channel (cardano={}, entrypoint={})",
        pair.cardano_channel_id, pair.vessel_channel_id
    ));
    Ok(pair)
}

fn wait_for_open_message_channel_pair(
    max_retries: usize,
    retry_delay_secs: u64,
) -> Result<Option<MessageChannelPair>, String> {
    for _ in 0..max_retries {
        if let Some(pair) = query_open_message_channel_pair()? {
            return Ok(Some(pair));
        }
        std::thread::sleep(Duration::from_secs(retry_delay_secs));
    }

    Ok(None)
}

fn query_open_message_channel_pair() -> Result<Option<MessageChannelPair>, String> {
    let output = run_hermes_command(&[
        "--json",
        "query",
        "channels",
        "--chain",
        CARDANO_CHAIN_ID,
        "--counterparty-chain",
        VESSEL_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Hermes query channels failed for cardano↔entrypoint:\n{}",
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

    let mut cardano_channels: Vec<String> = channel_entries
        .iter()
        .filter_map(extract_cardano_message_channel_id)
        .collect();
    cardano_channels.sort_by(|left, right| {
        parse_channel_sequence(right)
            .cmp(&parse_channel_sequence(left))
            .then_with(|| right.cmp(left))
    });
    cardano_channels.dedup();

    for cardano_channel_id in cardano_channels {
        let Some(cardano_end) = query_channel_end_status(
            CARDANO_CHAIN_ID,
            CARDANO_MESSAGE_PORT_ID,
            cardano_channel_id.as_str(),
        )?
        else {
            continue;
        };
        if !is_open_channel_state(cardano_end.state.as_str()) {
            continue;
        }
        if cardano_end.remote_port_id.as_deref() != Some(VESSEL_MESSAGE_PORT_ID) {
            continue;
        }
        let Some(vessel_channel_id) = cardano_end.remote_channel_id else {
            continue;
        };

        let Some(vessel_end) = query_channel_end_status(
            VESSEL_CHAIN_ID,
            VESSEL_MESSAGE_PORT_ID,
            vessel_channel_id.as_str(),
        )?
        else {
            continue;
        };
        if !is_open_channel_state(vessel_end.state.as_str()) {
            continue;
        }
        if vessel_end.remote_port_id.as_deref() != Some(CARDANO_MESSAGE_PORT_ID) {
            continue;
        }
        if vessel_end.remote_channel_id.as_deref() != Some(cardano_channel_id.as_str()) {
            continue;
        }

        return Ok(Some(MessageChannelPair {
            cardano_channel_id,
            vessel_channel_id,
        }));
    }

    Ok(None)
}

fn extract_cardano_message_channel_id(entry: &Value) -> Option<String> {
    let local_port = entry.get("port_id").and_then(Value::as_str);
    let remote_port = entry
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str);
    if local_port != Some(CARDANO_MESSAGE_PORT_ID) {
        return None;
    }
    if let Some(remote_port) = remote_port {
        if remote_port != VESSEL_MESSAGE_PORT_ID {
            return None;
        }
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

fn parse_channel_sequence(channel_id: &str) -> u64 {
    channel_id
        .strip_prefix("channel-")
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or_default()
}

fn parse_connection_sequence(connection_id: &str) -> u64 {
    connection_id
        .strip_prefix("connection-")
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or_default()
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
        parse_connection_sequence(right)
            .cmp(&parse_connection_sequence(left))
            .then_with(|| right.cmp(left))
    });
    connection_ids.dedup();
    Ok(connection_ids)
}

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

fn is_open_message_connection(cardano_connection_id: &str) -> Result<bool, String> {
    let Some(cardano_end) = query_connection_end_status(CARDANO_CHAIN_ID, cardano_connection_id)?
    else {
        return Ok(false);
    };

    if !is_open_channel_state(cardano_end.state.as_str()) {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: state={} (expected Open)",
            cardano_end.state
        ));
        return Ok(false);
    }

    let Some(vessel_connection_id) = cardano_end.remote_connection_id.as_deref() else {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: missing counterparty connection id"
        ));
        return Ok(false);
    };

    let Some(vessel_end) = query_connection_end_status(VESSEL_CHAIN_ID, vessel_connection_id)?
    else {
        return Ok(false);
    };

    if !is_open_channel_state(vessel_end.state.as_str()) {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: entrypoint counterparty {} is {} (expected Open)",
            vessel_connection_id, vessel_end.state
        ));
        return Ok(false);
    }

    if vessel_end.remote_connection_id.as_deref() != Some(cardano_connection_id) {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: entrypoint counterparty {} does not point back to it",
            vessel_connection_id
        ));
        return Ok(false);
    }

    if cardano_end.client_id.is_none()
        || cardano_end.remote_client_id.is_none()
        || vessel_end.client_id.is_none()
        || vessel_end.remote_client_id.is_none()
    {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: missing client identifiers on one or both ends"
        ));
        return Ok(false);
    }

    Ok(true)
}

fn query_open_message_connection() -> Result<Option<String>, String> {
    let connection_ids = query_connection_ids_for_chain(CARDANO_CHAIN_ID)?;
    for connection_id in connection_ids {
        if is_open_message_connection(connection_id.as_str())? {
            return Ok(Some(connection_id));
        }
    }
    Ok(None)
}

fn wait_for_open_message_connection(
    max_retries: usize,
    retry_delay_secs: u64,
) -> Result<Option<String>, String> {
    for _ in 0..max_retries {
        if let Some(connection_id) = query_open_message_connection()? {
            return Ok(Some(connection_id));
        }
        std::thread::sleep(Duration::from_secs(retry_delay_secs));
    }

    Ok(None)
}

fn ensure_open_message_exchange_connection() -> Result<String, String> {
    let message_exchange_config = crate::config::get_config().demo.message_exchange;
    let connection_discovery_max_retries = message_exchange_config.connection_discovery_max_retries;
    if connection_discovery_max_retries == 0 {
        return Err(
            "Invalid config: demo.message_exchange.connection_discovery_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let connection_discovery_retry_delay_secs =
        message_exchange_config.connection_discovery_retry_delay_secs;
    if connection_discovery_retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.connection_discovery_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if let Some(open_connection_id) = wait_for_open_message_connection(
        connection_discovery_max_retries,
        connection_discovery_retry_delay_secs,
    )? {
        logger::verbose(&format!(
            "Using existing open Cardano↔entrypoint connection {}",
            open_connection_id
        ));
        return Ok(open_connection_id);
    }

    logger::verbose(
        "No open Cardano↔entrypoint connection found, creating dedicated clients and connection",
    );
    // Every step below is strict by design.
    // If client or connection creation fails, we return that error directly.
    let create_cardano_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        CARDANO_CHAIN_ID,
        "--reference-chain",
        VESSEL_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !create_cardano_client_output.status.success() {
        return Err(format!(
            "Failed to create client for {CARDANO_CHAIN_ID}->{VESSEL_CHAIN_ID}: {}",
            String::from_utf8_lossy(&create_cardano_client_output.stderr)
        ));
    }
    let cardano_client_stdout =
        String::from_utf8_lossy(&create_cardano_client_output.stdout).to_string();
    let cardano_client_id =
        parse_tendermint_client_id(&cardano_client_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano->entrypoint client id from Hermes output:\n{}",
                cardano_client_stdout
            )
        })?;

    let create_vessel_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        VESSEL_CHAIN_ID,
        "--reference-chain",
        CARDANO_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !create_vessel_client_output.status.success() {
        return Err(format!(
            "Failed to create client for {VESSEL_CHAIN_ID}->{CARDANO_CHAIN_ID}: {}",
            String::from_utf8_lossy(&create_vessel_client_output.stderr)
        ));
    }
    let vessel_client_stdout =
        String::from_utf8_lossy(&create_vessel_client_output.stdout).to_string();
    let vessel_client_id = parse_tendermint_client_id(&vessel_client_stdout).ok_or_else(|| {
        format!(
            "Failed to parse entrypoint->Cardano client id from Hermes output:\n{}",
            vessel_client_stdout
        )
    })?;

    let create_connection_output = run_hermes_command(&[
        "create",
        "connection",
        "--a-chain",
        CARDANO_CHAIN_ID,
        "--a-client",
        cardano_client_id.as_str(),
        "--b-client",
        vessel_client_id.as_str(),
    ])
    .map_err(|error| error.to_string())?;
    if !create_connection_output.status.success() {
        return Err(format!(
            "Failed to create Cardano-entrypoint connection: {}",
            String::from_utf8_lossy(&create_connection_output.stderr)
        ));
    }
    let create_connection_stdout =
        String::from_utf8_lossy(&create_connection_output.stdout).to_string();
    let connection_id =
        parse_tendermint_connection_id(&create_connection_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano-entrypoint connection id from Hermes output:\n{}",
                create_connection_stdout
            )
        })?;

    let Some(open_connection_id) = wait_for_open_message_connection(
        connection_discovery_max_retries,
        connection_discovery_retry_delay_secs,
    )?
    else {
        return Err(format!(
            "Created Cardano↔entrypoint connection artifacts from {}, but no open symmetric connection is currently usable",
            connection_id
        ));
    };

    Ok(open_connection_id)
}

fn create_message_exchange_channel_on_connection(connection_id: &str) -> Result<(), String> {
    let create_output = run_hermes_command(&[
        "create",
        "channel",
        "--a-chain",
        CARDANO_CHAIN_ID,
        "--a-connection",
        connection_id,
        "--a-port",
        CARDANO_MESSAGE_PORT_ID,
        "--b-port",
        VESSEL_MESSAGE_PORT_ID,
        "--channel-version",
        ASYNC_ICQ_CHANNEL_VERSION,
    ])
    .map_err(|error| format!("Failed to execute Hermes create channel: {}", error))?;
    if !create_output.status.success() {
        return Err(format!(
            "Failed to create Cardano↔entrypoint message channel on connection {connection_id}:\n{}",
            String::from_utf8_lossy(&create_output.stderr)
        ));
    }
    Ok(())
}

fn query_channel_end_status(
    chain_id: &str,
    port_id: &str,
    channel_id: &str,
) -> Result<Option<ChannelEndStatus>, String> {
    let output = run_hermes_command(&[
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
    .map_err(|error| error.to_string())?;

    if !output.status.success() {
        logger::verbose(&format!(
            "Hermes query channel end failed for chain={chain_id}, port={port_id}, channel={channel_id}: {}",
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

    let remote = result.get("remote").or_else(|| result.get("counterparty"));
    let remote_channel_id = remote
        .and_then(|value| value.get("channel_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let remote_port_id = remote
        .and_then(|value| value.get("port_id"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    Ok(Some(ChannelEndStatus {
        state,
        remote_port_id,
        remote_channel_id,
    }))
}

fn is_open_channel_state(state: &str) -> bool {
    let normalized = state.trim().to_ascii_lowercase();
    normalized == "open" || normalized == "state_open"
}

fn contains_cardano_channel_proof_lag(text: &str) -> bool {
    let normalized = text.to_ascii_lowercase();
    normalized.contains("current hoststate root is not yet stability-accepted")
        || normalized.contains("not yet stability-accepted for proof generation (querychannel)")
        || normalized.contains("stability thresholds not met")
}

fn format_cardano_channel_proof_lag_error(channel_pair: &MessageChannelPair) -> String {
    format!(
        "ERROR: Cardano async-ICQ packet commitment exists on {}/{} but Hermes still cannot prove the channel-end state.\n\
         \n\
         Gateway is reporting that the current HostState root is not yet stability-accepted for queryChannel proof generation.\n\
         This means the packet was sent, but the Cardano light-client proof path has not caught up enough yet for packet-recv.\n\
         \n\
         Channel: {}/{}\n\
         Recovery:\n\
           1. wait for a few more Cardano blocks\n\
           2. rerun `caribic demo message-exchange`\n\
           3. if this repeats from a stale stack, run `caribic stop` then `caribic start --clean`",
        CARDANO_MESSAGE_PORT_ID,
        channel_pair.cardano_channel_id,
        CARDANO_MESSAGE_PORT_ID,
        channel_pair.cardano_channel_id
    )
}

fn relay_async_icq_packet(channel_pair: &MessageChannelPair) -> Result<(), String> {
    let message_exchange_config = crate::config::get_config().demo.message_exchange;
    let relay_max_retries = message_exchange_config.relay_max_retries;
    if relay_max_retries == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let relay_retry_delay_secs = message_exchange_config.relay_retry_delay_secs;
    if relay_retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let mut recv_relayed = false;
    let mut waiting_on_cardano_channel_proof = false;
    for attempt in 1..=relay_max_retries {
        let recv_output = run_hermes_command(&[
            "tx",
            "packet-recv",
            "--dst-chain",
            VESSEL_CHAIN_ID,
            "--src-chain",
            CARDANO_CHAIN_ID,
            "--src-port",
            CARDANO_MESSAGE_PORT_ID,
            "--src-channel",
            channel_pair.cardano_channel_id.as_str(),
        ])
        .map_err(|error| format!("Failed to execute Hermes packet-recv: {}", error))?;

        if recv_output.status.success() {
            recv_relayed = true;
            break;
        }

        let stderr = String::from_utf8_lossy(&recv_output.stderr).to_lowercase();
        if stderr.contains("no packet commitments found")
            || stderr.contains("no packets to relay")
            || stderr.contains("no unreceived packets")
        {
            std::thread::sleep(Duration::from_secs(relay_retry_delay_secs));
            continue;
        }

        if contains_cardano_channel_proof_lag(&stderr) {
            waiting_on_cardano_channel_proof = true;
            logger::warn(&format!(
                "WARN: Cardano packet commitment is ready but channel-end proof is still waiting for a stability-accepted HostState root (attempt {}/{} on {}/{}).",
                attempt,
                relay_max_retries,
                CARDANO_MESSAGE_PORT_ID,
                channel_pair.cardano_channel_id
            ));
            std::thread::sleep(Duration::from_secs(relay_retry_delay_secs));
            continue;
        }

        return Err(format!(
            "Failed relaying async-ICQ packet to Entrypoint:\n{}",
            String::from_utf8_lossy(&recv_output.stderr)
        ));
    }

    if !recv_relayed {
        if waiting_on_cardano_channel_proof {
            return Err(format_cardano_channel_proof_lag_error(channel_pair));
        }
        return Err("Timed out waiting for async-ICQ packet commitments on Cardano".to_string());
    }

    for _ in 0..relay_max_retries {
        let ack_output = run_hermes_command(&[
            "tx",
            "packet-ack",
            "--dst-chain",
            CARDANO_CHAIN_ID,
            "--src-chain",
            VESSEL_CHAIN_ID,
            "--src-port",
            VESSEL_MESSAGE_PORT_ID,
            "--src-channel",
            channel_pair.vessel_channel_id.as_str(),
        ])
        .map_err(|error| format!("Failed to execute Hermes packet-ack: {}", error))?;

        if ack_output.status.success() {
            logger::log("PASS: Async-ICQ packet relayed and acknowledged");
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&ack_output.stderr).to_lowercase();
        if stderr.contains("no acknowledgements found")
            || stderr.contains("no packets to relay")
            || stderr.contains("no unreceived acks")
        {
            std::thread::sleep(Duration::from_secs(relay_retry_delay_secs));
            continue;
        }

        return Err(format!(
            "Failed relaying async-ICQ acknowledgement back to Cardano:\n{}",
            String::from_utf8_lossy(&ack_output.stderr)
        ));
    }

    Err("Timed out waiting for async-ICQ acknowledgement on Cardano".to_string())
}

fn wait_for_cardano_icq_packet_relay_readiness(
    channel_pair: &MessageChannelPair,
) -> Result<(), String> {
    let message_exchange_config = crate::config::get_config().demo.message_exchange;
    let max_retries = message_exchange_config.relay_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let retry_delay_secs = message_exchange_config.relay_retry_delay_secs;
    if retry_delay_secs == 0 {
        return Err(
            "Invalid config: demo.message_exchange.relay_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }

    for attempt in 1..=max_retries {
        let channel_output = run_hermes_command(&[
            "query",
            "channel",
            "end",
            "--chain",
            CARDANO_CHAIN_ID,
            "--port",
            CARDANO_MESSAGE_PORT_ID,
            "--channel",
            channel_pair.cardano_channel_id.as_str(),
        ])
        .map_err(|error| {
            format!(
                "Failed to execute Hermes channel query for relay readiness: {}",
                error
            )
        })?;

        let packet_output = run_hermes_command(&[
            "query",
            "packet",
            "commitments",
            "--chain",
            CARDANO_CHAIN_ID,
            "--port",
            CARDANO_MESSAGE_PORT_ID,
            "--channel",
            channel_pair.cardano_channel_id.as_str(),
        ])
        .map_err(|error| {
            format!(
                "Failed to execute Hermes packet commitment query for relay readiness: {}",
                error
            )
        })?;

        let channel_stdout = String::from_utf8_lossy(&channel_output.stdout);
        let channel_stderr = String::from_utf8_lossy(&channel_output.stderr);
        let packet_stdout = String::from_utf8_lossy(&packet_output.stdout);
        let packet_stderr = String::from_utf8_lossy(&packet_output.stderr);
        let readiness_output = format!(
            "{}\n{}\n{}\n{}",
            channel_stdout, channel_stderr, packet_stdout, packet_stderr
        )
        .to_lowercase();
        let has_packet_commitment =
            !packet_stdout.contains("seqs: []") && !packet_stdout.contains("SUCCESS []");

        if packet_output.status.success() && has_packet_commitment {
            logger::verbose(&format!(
                "Cardano ICQ packet became relay-ready on attempt {}/{} for {}/{}{}",
                attempt,
                max_retries,
                CARDANO_MESSAGE_PORT_ID,
                channel_pair.cardano_channel_id,
                if channel_output.status.success() {
                    ""
                } else {
                    " (packet commitments are provable; channel-end proof may still be catching up)"
                }
            ));
            return Ok(());
        }

        let is_transient = readiness_output.contains("not yet stability-accepted")
            || readiness_output.contains("stability thresholds not met")
            || readiness_output.contains("current hoststate root is not yet stability-accepted")
            || readiness_output
                .contains("historical tx evidence unavailable for current live hoststate tx")
            || !has_packet_commitment;
        if !is_transient {
            return Err(format!(
                "Failed waiting for Cardano ICQ packet relay readiness:\nchannel stdout:\n{}\nchannel stderr:\n{}\npacket stdout:\n{}\npacket stderr:\n{}",
                channel_stdout.trim(),
                channel_stderr.trim(),
                packet_stdout.trim(),
                packet_stderr.trim()
            ));
        }

        logger::verbose(&format!(
            "Waiting for Cardano ICQ packet to become proof-relayable (attempt {}/{} on {}/{}).",
            attempt, max_retries, CARDANO_MESSAGE_PORT_ID, channel_pair.cardano_channel_id
        ));
        std::thread::sleep(Duration::from_secs(retry_delay_secs));
    }

    Err(format!(
        "Timed out waiting for Cardano ICQ packet relay readiness on {}/{}",
        CARDANO_MESSAGE_PORT_ID, channel_pair.cardano_channel_id
    ))
}
