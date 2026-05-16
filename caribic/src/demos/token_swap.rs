use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::{
    chains::{
        self,
        injective::{
            stop_local as stop_injective_local, stop_testnet as stop_injective_testnet,
            testnet_status_url as injective_testnet_status_url,
            workspace_dir as injective_workspace_dir,
        },
        osmosis::{
            demo_chain_id as osmosis_demo_chain_id, demo_node_rpc_url as osmosis_demo_node_rpc_url,
            stop_for_network as stop_osmosis_for_network,
            sync_workspace_assets as sync_osmosis_workspace_assets, workspace_dir,
        },
    },
    config, logger,
    route_setup::{self, RouteChain, RouteEndpoint},
    start::{self, CoreServiceId, HealthTarget, OptionalChainId, OptionalChainNetwork},
    stop::stop_relayer,
    utils::execute_script,
};

const TOKEN_SWAP_DEFAULT_CHAIN: OptionalChainId = OptionalChainId::Osmosis;
const INJECTIVE_TESTNET_RECOVERY_HINT: &str =
    "caribic chain start --chain injective --network testnet";
const OSMOSIS_TESTNET_DEPLOYER_MNEMONIC_FILENAME: &str = "testnet-deployer.mnemonic";
fn token_swap_core_targets(project_root_path: &Path) -> Vec<HealthTarget> {
    let mut targets = vec![
        HealthTarget::Core(CoreServiceId::Gateway),
        HealthTarget::Core(CoreServiceId::Postgres),
        HealthTarget::Core(CoreServiceId::Kupo),
        HealthTarget::Core(CoreServiceId::Ogmios),
        HealthTarget::Core(CoreServiceId::Mithril),
        HealthTarget::Core(CoreServiceId::CardanoEntrypoint),
    ];

    if matches!(
        config::active_core_cardano_network(project_root_path),
        config::CoreCardanoNetwork::Local
    ) {
        targets.insert(1, HealthTarget::Core(CoreServiceId::Cardano));
    }

    targets
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

fn optional_chain_target(chain: OptionalChainId, network: &str) -> Result<HealthTarget, String> {
    let network = OptionalChainNetwork::from_name(network).ok_or_else(|| {
        format!(
            "Unsupported optional-chain network '{}' in token-swap demo",
            network
        )
    })?;
    Ok(HealthTarget::CosmosChain { chain, network })
}

fn cardano_chain_id() -> String {
    let config = config::get_config();
    let active_network = config::active_core_cardano_network(Path::new(&config.project_root));
    config::cardano_network_profile(active_network).chain_id
}

fn cardano_handler_json_path() -> String {
    let config = config::get_config();
    let active_network = config::active_core_cardano_network(Path::new(&config.project_root));
    config::cardano_network_profile(active_network).handler_json_path
}

fn entrypoint_chain_id() -> String {
    config::get_config().chains.cardano_entrypoint.chain_id
}

/// Runs the full token swap demo and validates required services before execution.
pub async fn run_token_swap_demo(
    project_root_path: &Path,
    chain: Option<OptionalChainId>,
    network: Option<&str>,
) -> Result<(), String> {
    let (resolved_chain, resolved_network) = resolve_token_swap_target(chain, network)?;
    match resolved_chain {
        OptionalChainId::Osmosis => {
            run_osmosis_token_swap_demo(project_root_path, resolved_network.as_str()).await
        }
        OptionalChainId::Injective => {
            run_injective_token_swap_demo(project_root_path, resolved_network.as_str()).await
        }
        OptionalChainId::Cheqd => {
            Err("ERROR: Token-swap demo is not implemented for chain 'cheqd'.".to_string())
        }
    }
}

fn resolve_token_swap_target(
    chain: Option<OptionalChainId>,
    network: Option<&str>,
) -> Result<(OptionalChainId, String), String> {
    let resolved_chain = chain.unwrap_or(TOKEN_SWAP_DEFAULT_CHAIN);
    let chain_id = resolved_chain.adapter_id();

    let adapter = chains::get_chain_adapter(chain_id)
        .ok_or_else(|| format!("Optional chain adapter '{}' is not registered", chain_id))?;
    let resolved_network = adapter.resolve_network(network)?;
    Ok((resolved_chain, resolved_network))
}

async fn run_osmosis_token_swap_demo(
    project_root_path: &Path,
    network: &str,
) -> Result<(), String> {
    let osmosis_dir = workspace_dir(project_root_path);
    logger::verbose(&format!("{}", osmosis_dir.display()));
    sync_osmosis_workspace_assets(project_root_path, osmosis_dir.as_path()).map_err(|error| {
        format!(
            "ERROR: Failed to refresh Osmosis workspace assets before token-swap demo: {}",
            error
        )
    })?;
    let osmosis_chain_id = osmosis_demo_chain_id(network)?;
    let osmosis_node_rpc_url = osmosis_demo_node_rpc_url(network)?;
    validate_osmosis_demo_prerequisites(network)?;

    let mut required_targets = token_swap_core_targets(project_root_path);
    required_targets.push(optional_chain_target(OptionalChainId::Osmosis, network)?);
    if let Err(error) = ensure_demo_health_targets_ready(
        project_root_path,
        required_targets.as_slice(),
        "token-swap",
    ) {
        return fail_with_osmosis_cleanup(osmosis_dir.as_path(), network, &error);
    }

    logger::log("PASS: Required token-swap services are running");

    if gateway_uses_mithril(project_root_path) {
        logger::verbose("Checking Mithril artifact readiness before setting up transfer paths");
        // Hermes client creation against Cardano depends on Mithril artifact availability only
        // when the active Gateway mode is Mithril-based.
        wait_for_mithril_artifacts_for_demo().await?;
    } else {
        logger::verbose(
            "Skipping Mithril artifact readiness check for active Gateway mode: stake-weighted-stability",
        );
    }

    let relayer_path = project_root_path.join("relayer");
    let mut restart_relayer_after_setup = false;
    if let Ok((true, _)) =
        start::check_health_target(project_root_path, HealthTarget::Core(CoreServiceId::Hermes))
    {
        logger::verbose(
            "Stopping Hermes daemon during token-swap setup to avoid account sequence contention",
        );
        stop_relayer(relayer_path.as_path());
        restart_relayer_after_setup = true;
    }

    let transfer_route = match route_setup::setup_transfer_route(
        project_root_path,
        RouteEndpoint::new(RouteChain::Cardano, None),
        RouteEndpoint::new(RouteChain::Osmosis, Some(network.to_string())),
    ) {
        Ok(route) => route,
        Err(error) => {
            return fail_with_osmosis_cleanup(
                osmosis_dir.as_path(),
                network,
                &format!(
                "ERROR: Failed to prepare Cardano->Cardano Entrypoint->Osmosis transfer path: {}",
                error
            ),
            )
        }
    };
    let cardano_entrypoint_channel_pair = transfer_route.cardano_entrypoint_channel_pair;
    let entrypoint_osmosis_channel_pair = transfer_route.entrypoint_destination_channel_pair;

    if let Err(error) =
        ensure_hermes_daemon_for_token_swap(project_root_path, restart_relayer_after_setup)
    {
        return fail_with_osmosis_cleanup(osmosis_dir.as_path(), network, &error);
    }

    let deployer_mnemonic = osmosis_deployer_mnemonic();
    let preconfigured_crosschain_swaps_address =
        env_var_non_empty("OSMOSIS_CROSSCHAIN_SWAPS_ADDRESS");
    let preconfigured_swap_receiver = env_var_non_empty("OSMOSIS_SWAP_RECEIVER");
    let (crosschain_swaps_address, osmosis_swap_receiver) = if let Some(address) =
        preconfigured_crosschain_swaps_address
    {
        let receiver = preconfigured_swap_receiver.ok_or_else(|| {
                "ERROR: OSMOSIS_SWAP_RECEIVER is required when OSMOSIS_CROSSCHAIN_SWAPS_ADDRESS is preconfigured."
                    .to_string()
            })?;
        logger::log(&format!(
            "PASS: Using preconfigured crosschain_swaps address {} for Osmosis {}",
            address, network
        ));
        (address, receiver)
    } else {
        let setup_script_path = project_root_path
            .join("chains")
            .join("osmosis")
            .join("scripts")
            .join("setup_crosschain_swaps.sh");
        let setup_script = setup_script_path
            .to_str()
            .ok_or_else(|| "ERROR: Invalid setup_crosschain_swaps.sh path".to_string())?;

        // First stage script wires Osmosis-side contracts and creates the incoming routing path
        // for Cardano vouchers. We parse its stdout to recover the deployed contract address.
        // The second-stage swap receiver is derived locally from the Entrypoint Hermes key and
        // the known Osmosis->Cardano Entrypoint channel so it always matches the deployed registry.
        let mut setup_env = vec![
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
            ("OSMOSIS_NETWORK", network),
            ("HERMES_OSMOSIS_NAME", osmosis_chain_id),
            ("OSMOSIS_CHAIN_ID", osmosis_chain_id),
            ("OSMOSIS_NODE", osmosis_node_rpc_url),
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
        ];
        if let Some(ref mnemonic) = deployer_mnemonic {
            setup_env.push(("OSMOSIS_DEPLOYER_MNEMONIC", mnemonic.as_str()));
        }

        let setup_output =
            match execute_script(project_root_path, setup_script, Vec::new(), Some(setup_env)) {
                Ok(output) => {
                    logger::log("\nPASS: Token swap demo setup script completed");
                    output
                }
                Err(error) => {
                    return fail_with_osmosis_cleanup(
                        osmosis_dir.as_path(),
                        network,
                        &format!("ERROR: Failed to run token swap setup script: {}", error),
                    );
                }
            };

        let crosschain_swaps_address =
            parse_setup_output_value(setup_output.as_str(), "crosschain_swaps address:")
                .ok_or_else(|| {
                    fail_with_osmosis_cleanup(
                        osmosis_dir.as_path(),
                        network,
                        "ERROR: Could not parse crosschain_swaps address from setup script output",
                    )
                    .unwrap_err()
                })?;
        let swap_receiver = match preconfigured_swap_receiver {
            Some(receiver) => receiver,
            None => resolve_entrypoint_swap_receiver(
                project_root_path,
                entrypoint_osmosis_channel_pair.b_channel_id.as_str(),
            )
            .map_err(|error| {
                fail_with_osmosis_cleanup(osmosis_dir.as_path(), network, error.as_str())
                    .unwrap_err()
            })?,
        };
        (crosschain_swaps_address, swap_receiver)
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
        Some(vec![
            (
                "CROSSCHAIN_SWAPS_ADDRESS",
                crosschain_swaps_address.as_str(),
            ),
            ("HERMES_OSMOSIS_NAME", osmosis_chain_id),
            ("OSMOSIS_SWAP_RECEIVER", osmosis_swap_receiver.as_str()),
        ]),
    )
    .map_err(|error| format!("ERROR: Failed to run token swap transfer script: {}", error))?;
    logger::log("PASS: Cardano-to-Osmosis token swap completed");
    logger::log("\nPASS: Token swap demo flow completed successfully");

    Ok(())
}

async fn run_injective_token_swap_demo(
    project_root_path: &Path,
    network: &str,
) -> Result<(), String> {
    let injective_dir = injective_workspace_dir(project_root_path);
    logger::verbose(&format!("{}", injective_dir.display()));

    let mut required_targets = token_swap_core_targets(project_root_path);
    required_targets.push(optional_chain_target(OptionalChainId::Injective, network)?);
    if let Err(error) = ensure_demo_health_targets_ready(
        project_root_path,
        required_targets.as_slice(),
        "token-swap",
    ) {
        return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
    }

    if network == "testnet" {
        if let Err(initial_error) =
            wait_for_injective_first_block_for_demo(network, injective_dir.as_path()).await
        {
            return fail_with_injective_cleanup(injective_dir.as_path(), network, &initial_error);
        }
    }

    logger::log("PASS: Required token-swap services are running");

    if gateway_uses_mithril(project_root_path) {
        logger::verbose("Checking Mithril artifact readiness before setting up transfer paths");
        wait_for_mithril_artifacts_for_demo().await?;
    } else {
        logger::verbose(
            "Skipping Mithril artifact readiness check for active Gateway mode: stake-weighted-stability",
        );
    }

    let relayer_path = project_root_path.join("relayer");
    let mut restart_relayer_after_setup = false;
    if let Ok((true, _)) =
        start::check_health_target(project_root_path, HealthTarget::Core(CoreServiceId::Hermes))
    {
        logger::verbose(
            "Stopping Hermes daemon during token-swap setup to avoid account sequence contention",
        );
        stop_relayer(relayer_path.as_path());
        restart_relayer_after_setup = true;
    }

    let transfer_route = match route_setup::setup_transfer_route(
        project_root_path,
        RouteEndpoint::new(RouteChain::Cardano, None),
        RouteEndpoint::new(RouteChain::Injective, Some(network.to_string())),
    ) {
        Ok(route) => route,
        Err(error) => {
            return fail_with_injective_cleanup(
                injective_dir.as_path(),
                network,
                &format!(
                "ERROR: Failed to prepare Cardano->Cardano Entrypoint->Injective transfer path: {}",
                error
            ),
            )
        }
    };
    let injective_chain_id = transfer_route.destination_chain_id.clone();
    let cardano_entrypoint_channel_pair = transfer_route.cardano_entrypoint_channel_pair;
    let entrypoint_injective_channel_pair = transfer_route.entrypoint_destination_channel_pair;

    if let Err(error) =
        ensure_hermes_daemon_for_token_swap(project_root_path, restart_relayer_after_setup)
    {
        return fail_with_injective_cleanup(injective_dir.as_path(), network, &error);
    }

    let cardano_chain_id = cardano_chain_id();
    let handler_json_path = cardano_handler_json_path();
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
            ("CARDANO_CHAIN_ID", cardano_chain_id.as_str()),
            ("HANDLER_JSON", handler_json_path.as_str()),
            ("INJECTIVE_CHAIN_ID", injective_chain_id.as_str()),
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
        "testnet" => Ok(injective_testnet_status_url()),
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
    let max_retries = health_config.cosmos_max_retries.max(1);
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
                     The configured external testnet endpoint is not returning usable block data.\n\
                     Re-check Injective testnet setup with:\n\
                     {}\n\
                     Status endpoint checked: {}\n{}",
                    INJECTIVE_TESTNET_RECOVERY_HINT, status_url, log_tail
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

    let mut message = format!(
        "Injective {} stayed at block height 0 during readiness window. Hermes client creation would fail.\n\
         Status endpoint checked: {}",
        network, status_url
    );
    if network == "testnet" {
        message.push_str("\nRe-check Injective testnet setup with:\n");
        message.push_str(INJECTIVE_TESTNET_RECOVERY_HINT);
    }
    Err(message)
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

/// Ensures all health targets required by a demo flow are healthy before continuing.
fn ensure_demo_health_targets_ready(
    project_root_path: &Path,
    required_targets: &[HealthTarget],
    use_case_label: &str,
) -> Result<(), String> {
    let mut failures = Vec::new();

    for target in required_targets {
        if matches!(target, HealthTarget::Core(CoreServiceId::Mithril))
            && !gateway_uses_mithril(project_root_path)
        {
            continue;
        }

        match start::check_health_target(project_root_path, *target) {
            Ok((true, _)) => {}
            Ok((false, status)) => failures.push(format!("{}: {}", target.name(), status)),
            Err(error) => failures.push(format!("{}: {}", target.name(), error)),
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
    if gateway_uses_mithril(project_root_path) {
        message.push_str(
            "\nStart services first:\n  - caribic start --clean\n  - caribic start <chain> --network <network>\n\nMithril setup is deprecated and disabled; restart with the maintained default stack.",
        );
    } else {
        message.push_str(
            "\nStart services first:\n  - caribic start --clean\n  - caribic start <chain> --network <network>",
        );
    }

    Err(message)
}

fn ensure_hermes_daemon_for_token_swap(
    project_root_path: &Path,
    was_running_before_setup: bool,
) -> Result<(), String> {
    if let Ok((true, _)) =
        start::check_health_target(project_root_path, HealthTarget::Core(CoreServiceId::Hermes))
    {
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
    let config = crate::config::get_config();
    let active_network =
        crate::config::active_core_cardano_network(Path::new(&config.project_root));
    let aggregator_base_url = crate::config::cardano_network_profile(active_network)
        .mithril_aggregator_url
        .trim_end_matches('/')
        .trim_end_matches("/aggregator")
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

fn env_var_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_osmosis_demo_prerequisites(network: &str) -> Result<(), String> {
    if network == "local" {
        return Ok(());
    }

    let preconfigured_crosschain_swaps_address =
        env_var_non_empty("OSMOSIS_CROSSCHAIN_SWAPS_ADDRESS");
    let preconfigured_swap_receiver = env_var_non_empty("OSMOSIS_SWAP_RECEIVER");
    let deployer_mnemonic = osmosis_deployer_mnemonic();

    if let Some(_address) = preconfigured_crosschain_swaps_address {
        if preconfigured_swap_receiver.is_none() {
            return Err(
                "ERROR: OSMOSIS_SWAP_RECEIVER is required when OSMOSIS_CROSSCHAIN_SWAPS_ADDRESS is preconfigured."
                    .to_string(),
            );
        }
        return Ok(());
    }

    if deployer_mnemonic.is_some() {
        return Ok(());
    }

    Err(format!(
        "ERROR: Osmosis token-swap demo for network '{}' requires either: \
OSMOSIS_DEPLOYER_MNEMONIC for contract provisioning, or both \
OSMOSIS_CROSSCHAIN_SWAPS_ADDRESS and OSMOSIS_SWAP_RECEIVER to use a predeployed setup.",
        network
    ))
}

fn osmosis_deployer_mnemonic() -> Option<String> {
    env_var_non_empty("OSMOSIS_DEPLOYER_MNEMONIC").or_else(read_osmosis_deployer_mnemonic_from_file)
}

fn read_osmosis_deployer_mnemonic_from_file() -> Option<String> {
    let path = osmosis_testnet_deployer_mnemonic_path()?;
    std::fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn osmosis_testnet_deployer_mnemonic_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".caribic")
            .join("osmosis")
            .join(OSMOSIS_TESTNET_DEPLOYER_MNEMONIC_FILENAME)
    })
}

fn parse_setup_output_value(output: &str, prefix: &str) -> Option<String> {
    output
        .lines()
        .filter_map(|line| line.trim().strip_prefix(prefix))
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

fn resolve_entrypoint_swap_receiver(
    project_root: &Path,
    osmosis_entrypoint_channel_id: &str,
) -> Result<String, String> {
    let hermes_binary = project_root.join("relayer/target/release/hermes");
    let output = Command::new(&hermes_binary)
        .args(["keys", "list", "--chain", entrypoint_chain_id().as_str()])
        .output()
        .map_err(|error| format!("ERROR: Failed to query Hermes entrypoint keys: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "ERROR: Hermes keys list failed for entrypoint:\n{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        let cleaned =
            token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-');

        if cleaned.starts_with("cosmos1") {
            return Ok(format!("ibc:{}/{}", osmosis_entrypoint_channel_id, cleaned));
        }
    }

    Err(format!(
        "ERROR: Could not parse Entrypoint receiver from Hermes keys list output:\n{}",
        stdout.trim()
    ))
}

/// Logs an error, stops local Osmosis demo services when relevant, and returns the original error message.
fn fail_with_osmosis_cleanup(
    osmosis_dir: &Path,
    network: &str,
    message: &str,
) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    let _ = stop_osmosis_for_network(osmosis_dir, network);
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
