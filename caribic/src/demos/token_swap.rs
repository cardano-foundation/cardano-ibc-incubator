use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;

use serde_json::Value;

use crate::{
    chains::{
        self,
        injective::{
            configure_hermes_for_demo as configure_injective_hermes_for_demo,
            configure_hermes_for_testnet_demo as configure_injective_hermes_for_testnet_demo,
            local_chain_id as injective_local_chain_id, stop_local as stop_injective_local,
            stop_testnet as stop_injective_testnet, testnet_chain_id as injective_testnet_chain_id,
            testnet_status_url as injective_testnet_status_url,
            workspace_dir as injective_workspace_dir,
        },
        osmosis::{
            configure_hermes_for_demo as configure_osmosis_hermes_for_demo,
            demo_chain_id as osmosis_demo_chain_id, demo_node_rpc_url as osmosis_demo_node_rpc_url,
            stop_for_network as stop_osmosis_for_network,
            sync_workspace_assets as sync_osmosis_workspace_assets, workspace_dir,
        },
    },
    config, logger,
    start::{
        self, run_hermes_command, CoreServiceId, HealthTarget, OptionalChainId,
        OptionalChainNetwork,
    },
    stop::stop_relayer,
    utils::{execute_script, parse_tendermint_client_id, parse_tendermint_connection_id},
};

const TOKEN_SWAP_DEFAULT_CHAIN: OptionalChainId = OptionalChainId::Osmosis;
const INJECTIVE_TESTNET_RECOVERY_HINT: &str =
    "caribic chain start --chain injective --network testnet";
const OSMOSIS_TESTNET_DEPLOYER_MNEMONIC_FILENAME: &str = "testnet-deployer.mnemonic";
fn token_swap_core_targets() -> Vec<HealthTarget> {
    vec![
        HealthTarget::Core(CoreServiceId::Gateway),
        HealthTarget::Core(CoreServiceId::Cardano),
        HealthTarget::Core(CoreServiceId::Postgres),
        HealthTarget::Core(CoreServiceId::Kupo),
        HealthTarget::Core(CoreServiceId::Ogmios),
        HealthTarget::Core(CoreServiceId::Mithril),
        HealthTarget::Core(CoreServiceId::Entrypoint),
    ]
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

    let mut required_targets = token_swap_core_targets();
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

    let cardano_entrypoint_channel_pair = match ensure_cardano_entrypoint_transfer_channel() {
        Ok(pair) => pair,
        Err(error) => {
            return fail_with_osmosis_cleanup(
                osmosis_dir.as_path(),
                network,
                &format!(
                    "ERROR: Failed to prepare Cardano↔Entrypoint transfer path: {}",
                    error
                ),
            )
        }
    };

    match configure_osmosis_hermes_for_demo(osmosis_dir.as_path(), network) {
        Ok(_) => logger::log("PASS: Hermes configured successfully for Osmosis demo routing"),
        Err(error) => {
            return fail_with_osmosis_cleanup(
                osmosis_dir.as_path(),
                network,
                &format!("ERROR: Failed to configure Hermes: {}", error),
            )
        }
    }

    let entrypoint_osmosis_channel_pair = match query_open_transfer_channel_pair(
        entrypoint_chain_id().as_str(),
        TRANSFER_PORT_ID,
        osmosis_chain_id,
        TRANSFER_PORT_ID,
    ) {
        Ok(Some(pair)) => pair,
        Ok(None) => {
            return fail_with_osmosis_cleanup(
                osmosis_dir.as_path(),
                network,
                &format!(
                    "ERROR: No open Entrypoint↔Osmosis transfer channel pair is currently usable for chain '{}'",
                    osmosis_chain_id
                ),
            )
        }
        Err(error) => {
            return fail_with_osmosis_cleanup(
                osmosis_dir.as_path(),
                network,
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
        // the known Osmosis->Entrypoint channel so it always matches the deployed registry.
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

    let mut required_targets = token_swap_core_targets();
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

    let cardano_chain_id = cardano_chain_id();
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
            "\nStart services first:\n  - caribic start --clean --with-mithril\n  - caribic start <chain> --network <network>",
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
    let entrypoint_chain_id = entrypoint_chain_id();
    let entrypoint_port_id = entrypoint_message_port_id();
    logger::verbose("Creating transfer channel on the Cardano↔Entrypoint connection");
    logger::verbose(&format!(
        "Creating transfer channel on connection {connection_id} (Cardano↔Entrypoint)"
    ));
    run_hermes_command_with_provider_retry(
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
        "Parsed {cardano_chain_id} client id: {cardano_client_id}"
    ));

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
    logger::verbose(&format!(
        "Parsed entrypoint client id: {entrypoint_client_id}"
    ));

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
