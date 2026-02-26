use std::fs;
use std::path::Path;
use std::time::Duration;

use dirs::home_dir;
use serde_json::Value;

use crate::{
    constants::{
        CARDANO_CHAIN_ID, CARDANO_MESSAGE_PORT_ID, ENTRYPOINT_CHAIN_ID, ENTRYPOINT_CONTAINER_NAME,
        ENTRYPOINT_GRPC_ADDR, ENTRYPOINT_KEYRING_CONTAINER_PATH, ENTRYPOINT_MESSAGE_PORT_ID,
        ENTRYPOINT_RELAYER_KEY_NAME, ENTRYPOINT_RPC_ADDR,
    },
    logger,
    start::{self, run_hermes_command},
    stop::stop_relayer,
    utils::{
        execute_script, get_cardano_tip_state, parse_tendermint_client_id,
        parse_tendermint_connection_id,
    },
};

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

/// Runs the full message-exchange demo and executes datasource report/consolidate/transmit.
pub async fn run_message_exchange_demo(project_root_path: &Path) -> Result<(), String> {
    let message_exchange_config = ensure_message_exchange_prerequisites(project_root_path)?;

    logger::log("PASS: Native Cosmos Entrypoint chain is up and running");

    start::start_relayer(
        project_root_path.join("relayer").as_path(),
        project_root_path.join("relayer/.env.example").as_path(),
        project_root_path.join("relayer/examples").as_path(),
        project_root_path
            .join("cardano/offchain/deployments/handler.json")
            .as_path(),
    )
    .map_err(|error| format!("ERROR: Failed to prepare Hermes relayer: {}", error))?;
    logger::log("PASS: Hermes relayer configuration prepared");

    stop_relayer(project_root_path.join("relayer").as_path());
    configure_hermes_for_message_exchange()?;
    logger::verbose("Checking Mithril artifact readiness before message-exchange channel setup");
    wait_for_mithril_artifacts_for_message_exchange().await?;
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
    run_datasource_command(
        datasource_dir.as_path(),
        &["run", ".", "report", "-simulate"],
        datasource_home.as_str(),
    )?;
    logger::log("Consolidating submitted vessel reports");
    run_datasource_command(
        datasource_dir.as_path(),
        &["run", ".", "consolidate"],
        datasource_home.as_str(),
    )?;

    let consolidated_timestamp =
        query_latest_consolidated_timestamp(&message_exchange_config.vessel_default_imo).await?;
    let channel_arg = channel_pair.vessel_channel_id.clone();
    let timestamp_arg = consolidated_timestamp.to_string();
    logger::log("Transmitting consolidated report over IBC");
    run_datasource_command(
        datasource_dir.as_path(),
        &[
            "run",
            ".",
            "transmit",
            "-channelid",
            channel_arg.as_str(),
            "-imo",
            &message_exchange_config.vessel_default_imo,
            "-ts",
            timestamp_arg.as_str(),
        ],
        datasource_home.as_str(),
    )?;

    relay_vessel_message_packet(&channel_pair)?;

    logger::log("\nPASS: Message exchange demo flow completed successfully");
    Ok(())
}

fn ensure_message_exchange_prerequisites(
    project_root_path: &Path,
) -> Result<crate::config::MessageExchangeRuntime, String> {
    let message_exchange_config = crate::config::get_config().runtime.message_exchange;
    if message_exchange_config.vessel_default_imo.trim().is_empty() {
        return Err(
            "Invalid config: runtime.message_exchange.vessel_default_imo must be set in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if message_exchange_config.cardano_min_sync_progress <= 0.0
        || message_exchange_config.cardano_min_sync_progress > 100.0
    {
        return Err(
            "Invalid config: runtime.message_exchange.cardano_min_sync_progress must be in (0, 100] in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if message_exchange_config.cardano_max_safe_epoch == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.cardano_max_safe_epoch must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }

    let required_services = [
        "gateway", "cardano", "postgres", "kupo", "ogmios", "mithril", "cosmos",
    ];
    let mut failures = Vec::new();

    for service in required_services {
        match start::check_service_health(project_root_path, service) {
            Ok((true, _)) => {}
            Ok((false, status)) => failures.push(format!("{service}: {status}")),
            Err(error) => failures.push(format!("{service}: {error}")),
        }
    }

    if failures.is_empty() {
        ensure_cardano_demo_window(project_root_path, &message_exchange_config)?;
        return Ok(message_exchange_config);
    }

    let mut error = String::from(
        "ERROR: Message-exchange demo prerequisites are not met. Start the bridge first.\n",
    );
    for failure in failures {
        error.push_str(format!("  - {failure}\n").as_str());
    }
    error.push_str("\nRequired command:\n  - caribic start --clean --with-mithril");
    Err(error)
}

fn ensure_cardano_demo_window(
    project_root_path: &Path,
    message_exchange_config: &crate::config::MessageExchangeRuntime,
) -> Result<(), String> {
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

    if sync_progress < message_exchange_config.cardano_min_sync_progress
        || epoch >= message_exchange_config.cardano_max_safe_epoch
    {
        return Err(format!(
            "ERROR: Cardano devnet is not in a safe state for the message-exchange demo.\n\
             Tip snapshot: epoch={epoch}, slot={slot}, slotsToEpochEnd={slots_to_epoch_end}, syncProgress={sync_progress:.2}%\n\
             \n\
             This usually indicates stale/lagging Cardano chain state and leads to Hermes create-client failures.\n\
             Recommended recovery:\n\
               1. caribic stop\n\
               2. caribic start --clean --with-mithril\n\
               3. caribic demo message-exchange"
        ));
    }

    Ok(())
}

async fn wait_for_mithril_artifacts_for_message_exchange() -> Result<(), String> {
    let runtime_config = crate::config::get_config().runtime;
    let message_exchange_config = runtime_config.message_exchange;
    let max_retries = runtime_config.mithril_artifact_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: runtime.mithril_artifact_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let retry_delay_secs = runtime_config.mithril_artifact_retry_delay_secs;
    if retry_delay_secs == 0 {
        return Err(
            "Invalid config: runtime.mithril_artifact_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let progress_interval_secs = message_exchange_config.mithril_readiness_progress_interval_secs;
    if progress_interval_secs == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.mithril_readiness_progress_interval_secs must be > 0 in ~/.caribic/config.json"
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
        ENTRYPOINT_CONTAINER_NAME, ENTRYPOINT_KEYRING_CONTAINER_PATH
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
            ENTRYPOINT_CONTAINER_NAME, error
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

async fn query_latest_consolidated_timestamp(imo: &str) -> Result<u64, String> {
    let message_exchange_config = crate::config::get_config().runtime.message_exchange;
    let max_retries = message_exchange_config.consolidated_report_max_retries;
    if max_retries == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.consolidated_report_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let retry_delay_secs = message_exchange_config.consolidated_report_retry_delay_secs;
    if retry_delay_secs == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.consolidated_report_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {}", error))?;
    let query_url = "http://127.0.0.1:1317/vesseloracle/vesseloracle/consolidated_data_report";

    for _ in 0..max_retries {
        let response = client.get(query_url).send().await;
        let Ok(response) = response else {
            tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
            continue;
        };
        if !response.status().is_success() {
            tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
            continue;
        }

        let body = response
            .text()
            .await
            .map_err(|error| format!("Failed to read consolidated report response: {}", error))?;
        let json: Value = serde_json::from_str(body.as_str()).map_err(|error| {
            format!(
                "Failed to parse consolidated report response as JSON: {}",
                error
            )
        })?;

        let reports = json
            .get("consolidatedDataReport")
            .or_else(|| json.get("consolidated_data_report"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut latest_ts = None;
        for report in reports {
            let report_imo = report
                .get("imo")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if report_imo != imo {
                continue;
            }

            let report_ts = report
                .get("ts")
                .and_then(parse_u64_value)
                .unwrap_or_default();
            if latest_ts.is_none() || report_ts > latest_ts.unwrap_or_default() {
                latest_ts = Some(report_ts);
            }
        }

        if let Some(latest_ts) = latest_ts {
            logger::verbose(&format!(
                "Using latest consolidated report timestamp {} for IMO {}",
                latest_ts, imo
            ));
            return Ok(latest_ts);
        }

        tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
    }

    Err(format!(
        "Failed to find a consolidated report for IMO {} after retries",
        imo
    ))
}

fn parse_u64_value(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<u64>().ok()))
}

fn parse_f64_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
}

fn configure_hermes_for_message_exchange() -> Result<(), String> {
    let entrypoint_mnemonic = crate::config::get_config().relayer.entrypoint_mnemonic;
    if entrypoint_mnemonic.trim().is_empty() {
        return Err(
            "Invalid config: relayer.entrypoint_mnemonic must be set in ~/.caribic/config.json"
                .to_string(),
        );
    }
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
        ENTRYPOINT_CHAIN_ID,
        vessel_chain_block().as_str(),
    )?;

    fs::write(config_path.as_path(), updated_config)
        .map_err(|error| format!("Failed to write Hermes config: {}", error))?;
    logger::log("PASS: Hermes config updated for message-exchange on entrypoint chain");

    let mnemonic_file = std::env::temp_dir().join("entrypoint-relayer-mnemonic.txt");
    fs::write(mnemonic_file.as_path(), entrypoint_mnemonic)
    .map_err(|error| format!("Failed to write temporary entrypoint mnemonic file: {}", error))?;

    let mnemonic_file_arg = mnemonic_file.to_string_lossy().to_string();
    let add_key_output = run_hermes_command(&[
        "keys",
        "add",
        "--overwrite",
        "--chain",
        ENTRYPOINT_CHAIN_ID,
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
event_source = {{ mode = 'push', url = '{event_source_url}', batch_delay = '500ms' }}

[chains.packet_filter]
policy = 'allow'
list = [
  ['{vessel_port}', '*'],
  ['{cardano_port}', '*'],
]

address_type = {{ derivation = 'cosmos' }}
"#,
        id = ENTRYPOINT_CHAIN_ID,
        rpc_addr = ENTRYPOINT_RPC_ADDR,
        grpc_addr = ENTRYPOINT_GRPC_ADDR,
        key_name = ENTRYPOINT_RELAYER_KEY_NAME,
        vessel_port = ENTRYPOINT_MESSAGE_PORT_ID,
        cardano_port = CARDANO_MESSAGE_PORT_ID,
        event_source_url = format!(
            "{}{}",
            ENTRYPOINT_RPC_ADDR.replacen("http://", "ws://", 1),
            "/websocket"
        )
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
    let message_exchange_config = crate::config::get_config().runtime.message_exchange;
    let channel_discovery_max_retries = message_exchange_config.channel_discovery_max_retries;
    if channel_discovery_max_retries == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.channel_discovery_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let channel_discovery_max_retries_after_create =
        message_exchange_config.channel_discovery_max_retries_after_create;
    if channel_discovery_max_retries_after_create == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.channel_discovery_max_retries_after_create must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let channel_discovery_retry_delay_secs = message_exchange_config.channel_discovery_retry_delay_secs;
    if channel_discovery_retry_delay_secs == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.channel_discovery_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if let Some(pair) = wait_for_open_message_channel_pair(
        channel_discovery_max_retries,
        channel_discovery_retry_delay_secs,
    )?
    {
        logger::log(&format!(
            "PASS: Message-exchange channel already open (cardano={}, vesseloracle={})",
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
            "Created message-exchange channel, but no open channel pair could be discovered"
                .to_string()
        })?;
    logger::log(&format!(
        "PASS: Created message-exchange channel (cardano={}, vesseloracle={})",
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
        ENTRYPOINT_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Hermes query channels failed for cardano↔vesseloracle:\n{}",
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

    let cardano_port_id = CARDANO_MESSAGE_PORT_ID;
    let vessel_port_id = ENTRYPOINT_MESSAGE_PORT_ID;
    let mut cardano_channels: Vec<String> = channel_entries
        .iter()
        .filter_map(|entry| extract_cardano_message_channel_id(entry, cardano_port_id, vessel_port_id))
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
            cardano_port_id,
            cardano_channel_id.as_str(),
        )?
        else {
            continue;
        };
        if !is_open_channel_state(cardano_end.state.as_str()) {
            continue;
        }
        if cardano_end.remote_port_id.as_deref() != Some(vessel_port_id) {
            continue;
        }
        let Some(vessel_channel_id) = cardano_end.remote_channel_id else {
            continue;
        };

        let Some(vessel_end) = query_channel_end_status(
            ENTRYPOINT_CHAIN_ID,
            vessel_port_id,
            vessel_channel_id.as_str(),
        )?
        else {
            continue;
        };
        if !is_open_channel_state(vessel_end.state.as_str()) {
            continue;
        }
        if vessel_end.remote_port_id.as_deref() != Some(cardano_port_id) {
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

fn extract_cardano_message_channel_id(
    entry: &Value,
    cardano_port_id: &str,
    vessel_port_id: &str,
) -> Option<String> {
    let local_port = entry.get("port_id").and_then(Value::as_str);
    let remote_port = entry
        .get("counterparty")
        .and_then(|counterparty| counterparty.get("port_id"))
        .and_then(Value::as_str);
    if local_port != Some(cardano_port_id) {
        return None;
    }
    if let Some(remote_port) = remote_port {
        if remote_port != vessel_port_id {
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
        return None;
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

    let Some(vessel_end) = query_connection_end_status(ENTRYPOINT_CHAIN_ID, vessel_connection_id)?
    else {
        return Ok(false);
    };

    if !is_open_channel_state(vessel_end.state.as_str()) {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: vesseloracle counterparty {} is {} (expected Open)",
            vessel_connection_id, vessel_end.state
        ));
        return Ok(false);
    }

    if vessel_end.remote_connection_id.as_deref() != Some(cardano_connection_id) {
        logger::verbose(&format!(
            "Skipping {CARDANO_CHAIN_ID} connection {cardano_connection_id}: vesseloracle counterparty {} does not point back to it",
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
    let message_exchange_config = crate::config::get_config().runtime.message_exchange;
    let connection_discovery_max_retries = message_exchange_config.connection_discovery_max_retries;
    if connection_discovery_max_retries == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.connection_discovery_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let connection_discovery_retry_delay_secs =
        message_exchange_config.connection_discovery_retry_delay_secs;
    if connection_discovery_retry_delay_secs == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.connection_discovery_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    if let Some(open_connection_id) =
        wait_for_open_message_connection(
            connection_discovery_max_retries,
            connection_discovery_retry_delay_secs,
        )?
    {
        logger::verbose(&format!(
            "Using existing open Cardano↔vesseloracle connection {}",
            open_connection_id
        ));
        return Ok(open_connection_id);
    }

    logger::verbose(
        "No open Cardano↔vesseloracle connection found, creating dedicated clients and connection",
    );
    // Every step below is strict by design.
    // If client or connection creation fails, we return that error directly.
    let create_cardano_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        CARDANO_CHAIN_ID,
        "--reference-chain",
        ENTRYPOINT_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !create_cardano_client_output.status.success() {
        return Err(format!(
            "Failed to create client for {CARDANO_CHAIN_ID}->{ENTRYPOINT_CHAIN_ID}: {}",
            String::from_utf8_lossy(&create_cardano_client_output.stderr)
        ));
    }
    let cardano_client_stdout =
        String::from_utf8_lossy(&create_cardano_client_output.stdout).to_string();
    let cardano_client_id =
        parse_tendermint_client_id(&cardano_client_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano->vesseloracle client id from Hermes output:\n{}",
                cardano_client_stdout
            )
        })?;

    let create_vessel_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        ENTRYPOINT_CHAIN_ID,
        "--reference-chain",
        CARDANO_CHAIN_ID,
    ])
    .map_err(|error| error.to_string())?;
    if !create_vessel_client_output.status.success() {
        return Err(format!(
            "Failed to create client for {ENTRYPOINT_CHAIN_ID}->{CARDANO_CHAIN_ID}: {}",
            String::from_utf8_lossy(&create_vessel_client_output.stderr)
        ));
    }
    let vessel_client_stdout =
        String::from_utf8_lossy(&create_vessel_client_output.stdout).to_string();
    let vessel_client_id = parse_tendermint_client_id(&vessel_client_stdout).ok_or_else(|| {
        format!(
            "Failed to parse vesseloracle->Cardano client id from Hermes output:\n{}",
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
            "Failed to create Cardano-vesseloracle connection: {}",
            String::from_utf8_lossy(&create_connection_output.stderr)
        ));
    }
    let create_connection_stdout =
        String::from_utf8_lossy(&create_connection_output.stdout).to_string();
    let connection_id =
        parse_tendermint_connection_id(&create_connection_stdout).ok_or_else(|| {
            format!(
                "Failed to parse Cardano-vesseloracle connection id from Hermes output:\n{}",
                create_connection_stdout
            )
        })?;

    let Some(open_connection_id) =
        wait_for_open_message_connection(
            connection_discovery_max_retries,
            connection_discovery_retry_delay_secs,
        )?
    else {
        return Err(format!(
            "Created Cardano↔vesseloracle connection artifacts from {}, but no open symmetric connection is currently usable",
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
        ENTRYPOINT_MESSAGE_PORT_ID,
    ])
    .map_err(|error| format!("Failed to execute Hermes create channel: {}", error))?;
    if !create_output.status.success() {
        return Err(format!(
            "Failed to create Cardano↔vesseloracle message channel on connection {connection_id}:\n{}",
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

fn relay_vessel_message_packet(channel_pair: &MessageChannelPair) -> Result<(), String> {
    let message_exchange_config = crate::config::get_config().runtime.message_exchange;
    let relay_max_retries = message_exchange_config.relay_max_retries;
    if relay_max_retries == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.relay_max_retries must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let relay_retry_delay_secs = message_exchange_config.relay_retry_delay_secs;
    if relay_retry_delay_secs == 0 {
        return Err(
            "Invalid config: runtime.message_exchange.relay_retry_delay_secs must be > 0 in ~/.caribic/config.json"
                .to_string(),
        );
    }
    let mut recv_relayed = false;
    for _ in 0..relay_max_retries {
        let recv_output = run_hermes_command(&[
            "tx",
            "packet-recv",
            "--dst-chain",
            CARDANO_CHAIN_ID,
            "--src-chain",
            ENTRYPOINT_CHAIN_ID,
            "--src-port",
            ENTRYPOINT_MESSAGE_PORT_ID,
            "--src-channel",
            channel_pair.vessel_channel_id.as_str(),
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

        return Err(format!(
            "Failed relaying packet to Cardano:\n{}",
            String::from_utf8_lossy(&recv_output.stderr)
        ));
    }

    if !recv_relayed {
        return Err("Timed out waiting for message packet commitments on vesseloracle".to_string());
    }

    for _ in 0..relay_max_retries {
        let ack_output = run_hermes_command(&[
            "tx",
            "packet-ack",
            "--dst-chain",
            ENTRYPOINT_CHAIN_ID,
            "--src-chain",
            CARDANO_CHAIN_ID,
            "--src-port",
            CARDANO_MESSAGE_PORT_ID,
            "--src-channel",
            channel_pair.cardano_channel_id.as_str(),
        ])
        .map_err(|error| format!("Failed to execute Hermes packet-ack: {}", error))?;

        if ack_output.status.success() {
            logger::log("PASS: Message packet relayed and acknowledged");
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
            "Failed relaying packet acknowledgement back to vesseloracle:\n{}",
            String::from_utf8_lossy(&ack_output.stderr)
        ));
    }

    Err("Timed out waiting for packet acknowledgement on Cardano".to_string())
}
