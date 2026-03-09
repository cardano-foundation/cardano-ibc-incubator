use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::{
    chains::{
        self,
        injective::{
            configure_hermes_for_demo as configure_injective_hermes_for_demo,
            configure_hermes_for_testnet_demo as configure_injective_hermes_for_testnet_demo,
            local_chain_id as injective_local_chain_id, stop_local as stop_injective_local,
            stop_testnet as stop_injective_testnet,
            testnet_chain_id as injective_testnet_chain_id,
            workspace_dir as injective_workspace_dir,
        },
        osmosis::{configure_hermes_for_demo, stop_local, workspace_dir},
    },
    config, logger,
    start::{self, run_hermes_command},
    stop::stop_relayer,
    utils::{execute_script, parse_tendermint_client_id, parse_tendermint_connection_id},
    DemoChain,
};

const TOKEN_SWAP_DEFAULT_CHAIN: DemoChain = DemoChain::Osmosis;
const TOKEN_SWAP_SUPPORTED_TARGETS: [(&str, &str); 3] = [
    ("osmosis", "local"),
    ("injective", "local"),
    ("injective", "testnet"),
];
const INJECTIVE_TESTNET_MIN_FIRST_BLOCK_WAIT_MS: u64 = 30 * 60 * 1000;
const INJECTIVE_TESTNET_RECOVERY_HINT: &str =
    "caribic start injective --network testnet --chain-flag stateful=false";

fn cardano_chain_id() -> String {
    config::get_config().chains.cardano.chain_id
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

const TRANSFER_PORT_ID: &str = "transfer";

#[derive(Debug, Clone)]
struct TransferChannelPair {
    a_channel_id: String,
    b_channel_id: String,
}

/// Runs the full token swap demo and validates required services before execution.
pub async fn run_token_swap_demo(
    project_root_path: &Path,
    chain: Option<DemoChain>,
    network: Option<&str>,
) -> Result<(), String> {
    let (chain_id, resolved_network) = resolve_token_swap_target(chain, network)?;
    match (chain_id.as_str(), resolved_network.as_str()) {
        ("osmosis", "local") => run_osmosis_local_token_swap_demo(project_root_path).await,
        ("injective", "local") => run_injective_local_token_swap_demo(project_root_path).await,
        ("injective", "testnet") => {
            run_injective_testnet_token_swap_demo(project_root_path).await
        }
        _ => Err(format!(
            "Token-swap demo is not implemented for chain '{}' on network '{}'. Currently supported: {}",
            chain_id,
            resolved_network,
            TOKEN_SWAP_SUPPORTED_TARGETS
                .iter()
                .map(|(chain, network)| format!("--chain {} --network {}", chain, network))
                .collect::<Vec<String>>()
                .join(", ")
        )),
    }
}

fn resolve_token_swap_target(
    chain: Option<DemoChain>,
    network: Option<&str>,
) -> Result<(String, String), String> {
    let resolved_chain = chain.unwrap_or(TOKEN_SWAP_DEFAULT_CHAIN);
    let chain_id = match resolved_chain {
        DemoChain::Osmosis => "osmosis",
        DemoChain::Injective => "injective",
    };

    let adapter = chains::get_chain_adapter(chain_id)
        .ok_or_else(|| format!("Optional chain adapter '{}' is not registered", chain_id))?;
    let resolved_network = adapter.resolve_network(network)?;
    Ok((chain_id.to_string(), resolved_network))
}

async fn run_osmosis_local_token_swap_demo(project_root_path: &Path) -> Result<(), String> {
    let osmosis_dir = workspace_dir(project_root_path);
    logger::verbose(&format!("{}", osmosis_dir.display()));

    let required_services = [
        "gateway",
        "cardano",
        "postgres",
        "kupo",
        "ogmios",
        "mithril",
        "entrypoint",
        "osmosis",
        "redis",
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

    let cardano_entrypoint_channel_pair = match ensure_cardano_entrypoint_transfer_channel() {
        Ok(pair) => pair,
        Err(error) => {
        return fail_with_cleanup(
            osmosis_dir.as_path(),
            &format!(
                "ERROR: Failed to prepare Cardano↔Entrypoint transfer path: {}",
                error
            ),
        )
        }
    };

    match configure_hermes_for_demo(osmosis_dir.as_path()) {
        Ok(_) => logger::log("PASS: Hermes configured successfully and channels built"),
        Err(error) => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                &format!("ERROR: Failed to configure Hermes: {}", error),
            )
        }
    }

    let entrypoint_osmosis_channel_pair = match query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        "localosmosis",
        TRANSFER_PORT_ID,
    ) {
        Ok(Some(pair)) => pair,
        Ok(None) => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                "ERROR: No open Entrypoint↔Osmosis transfer channel pair is currently usable",
            )
        }
        Err(error) => {
            return fail_with_cleanup(
                osmosis_dir.as_path(),
                &format!(
                    "ERROR: Failed to resolve Entrypoint↔Osmosis transfer channel pair: {}",
                    error
                ),
            )
        }
    };

    if let Err(error) =
        ensure_hermes_daemon_for_token_swap(project_root_path, restart_relayer_after_setup)
    {
        return fail_with_cleanup(osmosis_dir.as_path(), &error);
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
        Some(vec![
            ("CARIBIC_CLEAR_SWAP_PACKETS", "true"),
            (
                "CARIBIC_PROJECT_ROOT",
                project_root_path
                    .to_str()
                    .ok_or_else(|| "ERROR: Invalid project root path".to_string())?,
            ),
            (
                "CARIBIC_OSMOSIS_DIR",
                osmosis_dir
                    .to_str()
                    .ok_or_else(|| "ERROR: Invalid osmosis workspace path".to_string())?,
            ),
            (
                "CARDANO_ENTRYPOINT_CHANNEL_ID",
                cardano_entrypoint_channel_pair.a_channel_id.as_str(),
            ),
            (
                "ENTRYPOINT_OSMOSIS_CHANNEL_ID",
                entrypoint_osmosis_channel_pair.a_channel_id.as_str(),
            ),
            (
                "OSMOSIS_ENTRYPOINT_CHANNEL_ID",
                entrypoint_osmosis_channel_pair.b_channel_id.as_str(),
            ),
        ]),
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

async fn run_injective_local_token_swap_demo(project_root_path: &Path) -> Result<(), String> {
    run_injective_token_swap_demo(project_root_path, "local").await
}

async fn run_injective_testnet_token_swap_demo(project_root_path: &Path) -> Result<(), String> {
    run_injective_token_swap_demo(project_root_path, "testnet").await
}

async fn run_injective_token_swap_demo(
    project_root_path: &Path,
    network: &str,
) -> Result<(), String> {
    let injective_dir = injective_workspace_dir(project_root_path);
    logger::verbose(&format!("{}", injective_dir.display()));

    let required_services = [
        "gateway", "cardano", "postgres", "kupo", "ogmios", "mithril", "cosmos",
    ];
    if let Err(error) =
        ensure_demo_services_ready(project_root_path, &required_services, "token-swap")
    {
        return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
    }

    if let Err(error) = ensure_optional_chain_network_ready(project_root_path, "injective", network)
    {
        return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
    }

    if network == "testnet" {
        if let Err(initial_error) =
            wait_for_injective_first_block_for_demo(network, injective_dir.as_path()).await
        {
            logger::warn(&format!(
                "WARN: Initial Injective testnet readiness failed. Attempting one clean recovery restart.\n{}",
                initial_error
            ));

            if let Err(recovery_error) =
                recover_injective_testnet_for_demo(project_root_path, injective_dir.as_path())
                    .await
            {
                return fail_with_injective_cleanup(
                    injective_dir.as_path(),
                    network,
                    &format!("{}\n{}", initial_error, recovery_error),
                );
            }

            if let Err(error) =
                wait_for_injective_first_block_for_demo(network, injective_dir.as_path()).await
            {
                return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
            }
        }
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

    let cardano_entrypoint_channel_pair = match ensure_cardano_entrypoint_transfer_channel() {
        Ok(pair) => pair,
        Err(error) => {
        return fail_with_injective_cleanup(
            injective_dir.as_path(),
            network,
            &format!(
                "ERROR: Failed to prepare Cardano↔Entrypoint transfer path: {}",
                error
            ),
        )
        }
    };

    let configure_hermes_result = match network {
        "local" => configure_injective_hermes_for_demo(project_root_path, injective_dir.as_path()),
        "testnet" => {
            configure_injective_hermes_for_testnet_demo(project_root_path, injective_dir.as_path())
        }
        _ => Err(format!(
            "Unsupported Injective network '{}' for token-swap demo",
            network
        )
        .into()),
    };

    match configure_hermes_result {
        Ok(_) => logger::log("PASS: Hermes configured successfully and channels built"),
        Err(error) => {
            return fail_with_injective_cleanup(
                injective_dir.as_path(),
                network,
                &format!("ERROR: Failed to configure Hermes for Injective: {}", error),
            )
        }
    }

    let injective_chain_id = match network {
        "local" => injective_local_chain_id(),
        "testnet" => injective_testnet_chain_id(),
        _ => {
            return Err(format!(
                "Unsupported Injective network '{}' for token-swap demo",
                network
            ))
        }
    };

    let entrypoint_injective_channel_pair = match query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        injective_chain_id,
        TRANSFER_PORT_ID,
    ) {
        Ok(Some(pair)) => pair,
        Ok(None) => {
            return fail_with_injective_cleanup(
                injective_dir.as_path(),
                network,
                "ERROR: No open Entrypoint↔Injective transfer channel pair is currently usable",
            )
        }
        Err(error) => {
            return fail_with_injective_cleanup(
                injective_dir.as_path(),
                network,
                &format!(
                    "ERROR: Failed to resolve Entrypoint↔Injective transfer channel pair: {}",
                    error
                ),
            )
        }
    };

    if let Err(error) =
        ensure_hermes_daemon_for_token_swap(project_root_path, restart_relayer_after_setup)
    {
        return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
    }

    let swap_script_path = project_root_path
        .join("chains")
        .join("injective")
        .join("scripts")
        .join("run_injective_token_swap.sh");
    let swap_script = swap_script_path
        .to_str()
        .ok_or_else(|| "ERROR: Invalid run_injective_token_swap.sh path".to_string())?;

    execute_script(
        project_root_path,
        swap_script,
        Vec::new(),
        Some(vec![
            (
                "CARIBIC_PROJECT_ROOT",
                project_root_path
                    .to_str()
                    .ok_or_else(|| "ERROR: Invalid project root path".to_string())?,
            ),
            (
                "CARIBIC_INJECTIVE_DIR",
                injective_dir
                    .to_str()
                    .ok_or_else(|| "ERROR: Invalid injective workspace path".to_string())?,
            ),
            ("INJECTIVE_CHAIN_ID", injective_chain_id),
            ("INJECTIVE_NETWORK", network),
            (
                "CARDANO_ENTRYPOINT_CHANNEL_ID",
                cardano_entrypoint_channel_pair.a_channel_id.as_str(),
            ),
            (
                "ENTRYPOINT_CARDANO_CHANNEL_ID",
                cardano_entrypoint_channel_pair.b_channel_id.as_str(),
            ),
            (
                "ENTRYPOINT_INJECTIVE_CHANNEL_ID",
                entrypoint_injective_channel_pair.a_channel_id.as_str(),
            ),
            (
                "INJECTIVE_ENTRYPOINT_CHANNEL_ID",
                entrypoint_injective_channel_pair.b_channel_id.as_str(),
            ),
        ]),
    )
    .map_err(|error| {
        format!(
            "ERROR: Failed to run injective token swap transfer script: {}",
            error
        )
    })?;

    logger::log(&format!(
        "PASS: Cardano-to-Injective token swap completed (network: {})",
        network
    ));
    logger::log("\nPASS: Token swap demo flow completed successfully");

    Ok(())
}

fn injective_status_url_for_network(network: &str) -> Result<&'static str, String> {
    match network {
        "local" => Ok("http://127.0.0.1:26660/status"),
        "testnet" => Ok("http://127.0.0.1:26659/status"),
        _ => Err(format!(
            "Unsupported Injective network '{}' for status readiness check",
            network
        )),
    }
}

async fn wait_for_injective_first_block_for_demo(
    network: &str,
    injective_dir: &Path,
) -> Result<(), String> {
    let status_url = injective_status_url_for_network(network)?;
    let health_config = config::get_config().health;
    let retry_interval_ms = health_config.cosmos_retry_interval_ms.max(500);
    let configured_retries = health_config.cosmos_max_retries.max(1);
    let min_testnet_retries = (INJECTIVE_TESTNET_MIN_FIRST_BLOCK_WAIT_MS / retry_interval_ms)
        .max(1)
        .min(u32::MAX as u64) as u32;
    let max_retries = if network == "testnet" {
        configured_retries.max(min_testnet_retries)
    } else {
        configured_retries
    };
    let log_every_attempts = 6_u32;
    let mut stagnant_not_syncing_checks = 0_u32;

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| {
            format!(
                "Failed to build HTTP client for Injective readiness check: {}",
                error
            )
        })?;

    logger::log(&format!(
        "Waiting for Injective {} to produce first block before Hermes client creation...",
        network
    ));
    if network == "testnet" && max_retries > configured_retries {
        logger::log(&format!(
            "Injective testnet readiness window extended to {} attempts (~{} min) to allow snapshot restore and p2p catch-up.",
            max_retries,
            (max_retries as u64 * retry_interval_ms) / 60_000
        ));
    }

    for attempt in 1..=max_retries {
        let (latest_height, catching_up) = match client.get(status_url).send().await {
            Ok(response) if response.status().is_success() => {
                let payload = response.json::<Value>().await.unwrap_or_default();
                payload["result"]["sync_info"]["latest_block_height"]
                    .as_str()
                    .and_then(|raw| raw.parse::<u64>().ok())
                    .or_else(|| payload["result"]["sync_info"]["latest_block_height"].as_u64())
                    .map(|height| {
                        (
                            height,
                            payload["result"]["sync_info"]["catching_up"]
                                .as_bool()
                                .unwrap_or(false),
                        )
                    })
                    .unwrap_or((0, false))
            }
            _ => (0, false),
        };

        if latest_height > 0 {
            logger::log(&format!(
                "PASS: Injective {} produced first block at height {}",
                network, latest_height
            ));
            return Ok(());
        }

        if network == "testnet" {
            if !catching_up {
                stagnant_not_syncing_checks = stagnant_not_syncing_checks.saturating_add(1);
            } else {
                stagnant_not_syncing_checks = 0;
            }

            if stagnant_not_syncing_checks >= 6 {
                let log_tail = injective_testnet_log_tail(injective_dir);
                return Err(format!(
                    "Injective testnet RPC is reachable but still at height 0 with catching_up=false.\n\
                     This usually means snapshot bootstrap or peer synchronization stalled.\n\
                     Restart with a clean bootstrap, for example:\n\
                     {}\n\
                     Status endpoint checked: {}\n{}",
                    INJECTIVE_TESTNET_RECOVERY_HINT, status_url, log_tail
                ));
            }
        }

        if network == "testnet" && !injective_testnet_container_running(injective_dir) {
            let log_tail = injective_testnet_log_tail(injective_dir);
            return Err(format!(
                "Injective testnet container is no longer running before first block.\n\
                 Status endpoint checked: {}\n{}",
                status_url, log_tail
            ));
        }

        if network == "testnet" && (attempt == 1 || attempt % log_every_attempts == 0) {
            let log_tail = injective_testnet_log_tail(injective_dir);
            if injective_testnet_bootstrap_failed(log_tail.as_str()) {
                return Err(format!(
                    "Injective testnet snapshot bootstrap failed while latest block height is still 0.\n\
                     Hermes client creation would fail until the local testnet node produces blocks.\n\
                     Status endpoint checked: {}\n{}",
                    status_url, log_tail
                ));
            }
        }

        if attempt == 1 || attempt % log_every_attempts == 0 || attempt == max_retries {
            if network == "testnet" {
                logger::log(&format!(
                    "Injective {} not ready yet (attempt {}/{}): latest block height is {}, catching_up={}",
                    network, attempt, max_retries, latest_height, catching_up
                ));
            } else {
                logger::log(&format!(
                    "Injective {} not ready yet (attempt {}/{}): latest block height is {}",
                    network, attempt, max_retries, latest_height
                ));
            }
        }

        tokio::time::sleep(Duration::from_millis(retry_interval_ms)).await;
    }

    let log_tail = injective_testnet_log_tail(injective_dir);
    let mut message = format!(
        "Injective {} stayed at block height 0 during readiness window. Hermes client creation would fail.\n\
         Status endpoint checked: {}",
        network, status_url
    );
    if network == "testnet" {
        let lower_log_tail = log_tail.to_ascii_lowercase();
        if lower_log_tail.contains("snapshot bootstrap failed")
            || lower_log_tail.contains("unable to resolve injective testnet snapshot url")
            || lower_log_tail.contains("no space left on device")
            || lower_log_tail.contains("failed to fetch snapshot")
        {
            message.push_str(
                "\nSnapshot bootstrap failed before Injective testnet produced first block.\n\
                 Retry with a clean bootstrap:\n",
            );
            message.push_str(INJECTIVE_TESTNET_RECOVERY_HINT);
        }
        message.push('\n');
        message.push_str(log_tail.as_str());
    }
    Err(message)
}

async fn recover_injective_testnet_for_demo(
    project_root_path: &Path,
    injective_dir: &Path,
) -> Result<(), String> {
    logger::warn("WARN: Restarting Injective testnet with clean snapshot bootstrap...");
    stop_injective_testnet(injective_dir);

    let adapter = chains::get_chain_adapter("injective")
        .ok_or_else(|| "Injective chain adapter is not registered".to_string())?;
    let mut recovery_flags = chains::ChainFlags::new();
    recovery_flags.insert("stateful".to_string(), "false".to_string());
    let request = chains::ChainStartRequest {
        network: "testnet",
        flags: &recovery_flags,
    };
    adapter
        .start(project_root_path, &request)
        .await
        .map_err(|error| {
            format!(
                "ERROR: Automatic Injective testnet recovery start failed: {}",
                error
            )
        })?;

    logger::log("PASS: Injective testnet recovered with clean bootstrap");
    Ok(())
}

fn injective_testnet_bootstrap_failed(log_tail: &str) -> bool {
    let lower = log_tail.to_ascii_lowercase();
    lower.contains("snapshot bootstrap failed")
        || lower.contains("unable to resolve injective testnet snapshot url")
        || lower.contains("snapshot restore completed but")
        || lower.contains("no space left on device")
}

fn injective_testnet_container_running(injective_dir: &Path) -> bool {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "ps",
            "-q",
            "injectived-testnet",
        ])
        .output();

    let Ok(output) = output else {
        return false;
    };

    if !output.status.success() {
        return false;
    }

    let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if container_id.is_empty() {
        return false;
    }

    let inspect_output = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{.State.Status}}",
            container_id.as_str(),
        ])
        .output();

    let Ok(inspect_output) = inspect_output else {
        return false;
    };
    if !inspect_output.status.success() {
        return false;
    }

    String::from_utf8_lossy(&inspect_output.stdout).trim() == "running"
}

fn injective_testnet_log_tail(injective_dir: &Path) -> String {
    let output = Command::new("docker")
        .current_dir(injective_dir)
        .args([
            "compose",
            "-f",
            "configuration/docker-compose.yml",
            "logs",
            "--tail",
            "300",
            "injectived-testnet",
        ])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                "Injective testnet container log is empty".to_string()
            } else {
                stdout.to_string()
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            format!(
                "Unable to read Injective testnet container logs:\n{}",
                stderr.trim()
            )
        }
        Err(error) => format!(
            "Unable to run docker compose logs for Injective testnet container: {}",
            error
        ),
    }
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
        "\nStart services first:\n  - caribic start --clean --with-mithril\n  - caribic start <chain> --network <network>",
    );

    Err(message)
}

fn ensure_optional_chain_network_ready(
    project_root_path: &Path,
    chain_id: &str,
    network: &str,
) -> Result<(), String> {
    let adapter = chains::get_chain_adapter(chain_id)
        .ok_or_else(|| format!("Optional chain adapter '{}' is not registered", chain_id))?;
    let flags = chains::ChainFlags::new();
    let statuses = adapter
        .health(project_root_path, network, &flags)
        .map_err(|error| {
            format!(
                "Failed to check '{}' health for network '{}': {}",
                chain_id, network, error
            )
        })?;

    let unhealthy = statuses
        .into_iter()
        .filter(|status| !status.healthy)
        .map(|status| format!("{}: {}", status.label, status.status))
        .collect::<Vec<_>>();

    if unhealthy.is_empty() {
        return Ok(());
    }

    let mut message = format!(
        "ERROR: '{}' chain network '{}' is not healthy for token-swap demo.\n",
        chain_id, network
    );
    for failure in unhealthy {
        message.push_str(&format!("  - {}\n", failure));
    }
    message.push_str(&format!(
        "\nStart services first:\n  - caribic start {} --network {}",
        chain_id, network
    ));

    Err(message)
}

fn ensure_hermes_daemon_for_token_swap(
    project_root_path: &Path,
    was_running_before_setup: bool,
) -> Result<(), String> {
    if let Ok((true, _)) = start::check_service_health(project_root_path, "hermes") {
        if was_running_before_setup {
            logger::log("PASS: Hermes daemon restarted for token relay");
        } else {
            logger::log("PASS: Hermes daemon is running for token relay");
        }
        return Ok(());
    }

    let action = if was_running_before_setup {
        "restart"
    } else {
        "start"
    };
    logger::verbose(&format!(
        "Hermes daemon not running after setup; attempting to {} it before token relay",
        action
    ));

    start::start_hermes_daemon()
        .map_err(|error| format!("ERROR: Failed to {} Hermes daemon: {}", action, error))?;

    if was_running_before_setup {
        logger::log("PASS: Hermes daemon restarted for token relay");
    } else {
        logger::log("PASS: Hermes daemon started for token relay");
    }
    Ok(())
}

/// Waits until Mithril exposes stake and transaction artifacts needed by demo client creation.
async fn wait_for_mithril_artifacts_for_demo() -> Result<(), String> {
    let demo_config = crate::config::get_config().demo;
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

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .expect("Failed to build reqwest client for Mithril artifact check");

    for attempt in 1..=max_retries {
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
            "Mithril artifact readiness check (attempt {attempt}/{}): stake_distributions={stake_ready}, cardano_transactions={tx_ready}",
            max_retries
        ));

        if stake_ready && tx_ready {
            logger::log("PASS: Mithril artifacts are available");
            return Ok(());
        }

        tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
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
    port_id: &str,
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
        port_id,
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

fn query_open_transfer_channel_pair(
    a_chain_id: &str,
    a_port_id: &str,
    b_chain_id: &str,
    b_port_id: &str,
) -> Result<Option<TransferChannelPair>, String> {
    let output = run_hermes_command(&[
        "--json",
        "query",
        "channels",
        "--chain",
        a_chain_id,
        "--counterparty-chain",
        b_chain_id,
    ])
    .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Hermes query channels failed for {}↔{}:\n{}",
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
        let Some(a_end) = query_transfer_channel_end_status(a_chain_id, a_port_id, a_channel_id.as_str())?
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
    let cardano_chain_id = cardano_chain_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    let Some(cardano_end) =
        query_connection_end_status(cardano_chain_id.as_str(), cardano_connection_id)?
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
        query_connection_end_status(entrypoint_chain_id.as_str(), entrypoint_connection_id)?
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

fn create_cardano_entrypoint_transfer_channel_on_connection(
    connection_id: &str,
) -> Result<(), String> {
    let cardano_chain_id = cardano_chain_id();
    let cardano_port_id = cardano_message_port_id();
    let entrypoint_port_id = entrypoint_message_port_id();
    logger::verbose("Creating transfer channel on the Cardano↔Entrypoint connection");
    logger::verbose(&format!(
        "Creating transfer channel on connection {connection_id} (Cardano↔Entrypoint)"
    ));
    let create_channel_output = run_hermes_command(&[
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
fn ensure_cardano_entrypoint_transfer_channel() -> Result<TransferChannelPair, String> {
    let cardano_chain_id = cardano_chain_id();
    let entrypoint_chain_id = entrypoint_chain_id();
    if let Some(open_channel_pair) = query_cardano_entrypoint_channel_pair()? {
        logger::log(&format!(
            "PASS: Cardano->Entrypoint transfer channel already exists and is open ({})",
            open_channel_pair.a_channel_id
        ));
        return Ok(open_channel_pair);
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

        let Some(open_channel_pair) = query_cardano_entrypoint_channel_pair()? else {
            return Err(
                "Created transfer channel on an open Cardano↔Entrypoint connection, but no open transfer channel is currently usable".to_string(),
            );
        };
        logger::log(&format!(
            "PASS: Created Cardano<->Entrypoint transfer channel for token-swap demo ({})",
            open_channel_pair.a_channel_id
        ));
        return Ok(open_channel_pair);
    }

    logger::verbose("Creating Cardano-devnet client with entrypoint reference");

    let create_cardano_client_output = run_hermes_command(&[
        "create",
        "client",
        "--host-chain",
        cardano_chain_id.as_str(),
        "--reference-chain",
        entrypoint_chain_id.as_str(),
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
        entrypoint_chain_id.as_str(),
        "--reference-chain",
        cardano_chain_id.as_str(),
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
        cardano_chain_id.as_str(),
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
    let Some(open_channel_pair) = query_cardano_entrypoint_channel_pair()? else {
        return Err(
            "Created Cardano↔Entrypoint channel artifacts but no open transfer channel is currently usable".to_string(),
        );
    };

    logger::log(&format!(
        "PASS: Created Cardano<->Entrypoint transfer channel for token-swap demo ({})",
        open_channel_pair.a_channel_id
    ));
    Ok(open_channel_pair)
}

/// Logs an error, stops Osmosis demo services, and returns the original error message.
fn fail_with_cleanup(osmosis_dir: &Path, message: &str) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    stop_local(osmosis_dir);
    Err(message.to_string())
}

fn fail_with_injective_cleanup(
    injective_dir: &Path,
    network: &str,
    message: &str,
) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    if network == "local" {
        stop_injective_local(injective_dir);
    } else if network == "testnet" {
        stop_injective_testnet(injective_dir);
    }
    Err(message.to_string())
}
