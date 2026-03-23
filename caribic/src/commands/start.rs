use std::fs;
use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

use crate::{
    chains::{self, ChainStartRequest},
    config, logger,
    start::{
        build_aiken_validators_if_needed, build_hermes_if_needed, deploy_contracts,
        deploy_preprod_bridge, start_cosmos_entrypoint_chain,
        start_cosmos_entrypoint_chain_services, start_gateway, start_hermes_daemon, start_mithril,
        start_relayer, wait_for_cosmos_entrypoint_chain_ready,
    },
    utils::{prompt_runtime_deployer_sk, query_balance},
    StartTarget, StopTarget,
};

const HERMES_BUILD_PROGRESS_LOG_INTERVAL_SECS: u64 = 10;
const HERMES_BUILD_POLL_INTERVAL_SECS: u64 = 2;

fn require_preprod_bridge_artifact(artifact_path: &Path, label: &str) -> Result<(), String> {
    if artifact_path.exists() {
        return Ok(());
    }

    Err(format!(
        "ERROR: Missing required preprod {} at {}.\nProvide an existing preprod bridge deployment artifact before starting against --network preprod.",
        label,
        artifact_path.display()
    ))
}

fn require_preprod_gateway_bootstrap_artifact(
    manifest_path: Option<&str>,
    handler_path: &Path,
) -> Result<(), String> {
    if manifest_path
        .map(Path::new)
        .is_some_and(|path| path.exists())
        || handler_path.exists()
    {
        return Ok(());
    }

    Err(format!(
        "ERROR: Missing required preprod gateway bootstrap artifact.\nExpected either bridge manifest at {} or handler.json at {}.",
        manifest_path.unwrap_or("<unset>"),
        handler_path.display()
    ))
}

fn target_requires_runtime_deployer_sk(target: Option<StartTarget>) -> bool {
    target.is_none()
        || target == Some(StartTarget::All)
        || target == Some(StartTarget::Bridge)
        || target == Some(StartTarget::Relayer)
}

/// Starts the requested target and orchestrates startup dependencies for network and bridge components.
pub async fn run_start(
    target: Option<StartTarget>,
    clean: bool,
    with_mithril: bool,
    network: Option<String>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let start_elapsed_timer = Instant::now();

    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    // Determine what to start.
    let start_all = target.is_none() || target == Some(StartTarget::All);
    let start_network = start_all || target == Some(StartTarget::Network);
    let start_cosmos = start_all || target == Some(StartTarget::Entrypoint);
    let start_bridge = start_all || target == Some(StartTarget::Bridge);
    let optional_chain_alias = resolve_optional_chain_alias(target.as_ref());

    if let Some(optional_chain_id) = optional_chain_alias {
        let chain_adapter = chains::get_chain_adapter(optional_chain_id).ok_or_else(|| {
            format!(
                "ERROR: Optional chain adapter '{}' is not registered",
                optional_chain_id
            )
        })?;
        let resolved_network = chain_adapter.resolve_network(network.as_deref())?;
        let parsed_flags = chains::parse_chain_flags(chain_flags.as_slice())?;
        chain_adapter.validate_flags(resolved_network.as_str(), &parsed_flags)?;
        let request = ChainStartRequest {
            network: resolved_network.as_str(),
            flags: &parsed_flags,
        };

        let optional_progress_bar = match logger::get_verbosity() {
            logger::Verbosity::Verbose => None,
            _ => Some(ProgressBar::new_spinner()),
        };

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.enable_steady_tick(Duration::from_millis(100));
            progress_bar.set_style(
                ProgressStyle::with_template(
                    "{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}",
                )
                .unwrap()
                .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
            );
            progress_bar
                .set_prefix(format!("Starting {} ...", chain_adapter.display_name()).to_owned());
            progress_bar.set_message(format!(
                "network={} (this can take a while)",
                resolved_network
            ));
        } else {
            logger::log(&format!(
                "Starting {} (network: {}) ...",
                chain_adapter.display_name(),
                resolved_network
            ));
        }

        let start_result = chain_adapter
            .start(project_root_path, &request)
            .await
            .map_err(|error| {
                format!(
                    "ERROR: Failed to start {}: {}",
                    chain_adapter.display_name(),
                    error
                )
            });

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        start_result?;

        logger::log(&format!(
            "PASS: {} started successfully (network: {})",
            chain_adapter.display_name(),
            resolved_network,
        ));
        logger::log(&format!(
            "\ncaribic start completed in {}",
            format_elapsed_duration(start_elapsed_timer.elapsed())
        ));
        return Ok(());
    }

    if !chain_flags.is_empty() {
        return Err(
            "ERROR: --chain-flag requires an optional chain target. Use `caribic start <optional-chain-alias> --network <network>` or `caribic chain start ...`."
                .to_string(),
        );
    }

    let core_cardano_network = config::CoreCardanoNetwork::parse(network.as_deref())?;
    let core_cardano_profile = config::cardano_network_profile(core_cardano_network);

    if core_cardano_network == config::CoreCardanoNetwork::Preprod && with_mithril {
        return Err(
            "ERROR: --with-mithril is not supported with --network preprod. Use public Mithril release-preprod instead.".to_string(),
        );
    }

    let runtime_deployer_sk = if core_cardano_network != config::CoreCardanoNetwork::Local
        && target_requires_runtime_deployer_sk(target.clone())
    {
        Some(
            prompt_runtime_deployer_sk()
                .map_err(|error| format!("ERROR: Failed to load DEPLOYER_SK: {}", error))?,
        )
    } else {
        None
    };

    let mut aiken_build_handle = None;
    let mut cosmos_entrypoint_chain_start_handle = None;
    let mut hermes_build_handle = None;
    let mut mithril_genesis_handle = None;

    if start_all {
        if start_cosmos {
            let cosmos_dir = project_root_path.join("cosmos");
            cosmos_entrypoint_chain_start_handle = Some(tokio::task::spawn_blocking(move || {
                start_cosmos_entrypoint_chain_services(cosmos_dir.as_path(), clean)
                    .map_err(|e| e.to_string())
            }));
        }

        if start_bridge {
            let relayer_dir = project_root_path.join("relayer");
            hermes_build_handle = Some(tokio::task::spawn_blocking(move || {
                build_hermes_if_needed(relayer_dir.as_path()).map_err(|e| e.to_string())
            }));
        }

        if start_bridge {
            let project_root_path = project_root_path.to_path_buf();
            aiken_build_handle = Some(tokio::task::spawn_blocking(move || {
                build_aiken_validators_if_needed(project_root_path.as_path(), clean)
                    .map_err(|e| e.to_string())
            }));
        }
    }

    if target == Some(StartTarget::Gateway) {
        if core_cardano_network == config::CoreCardanoNetwork::Preprod {
            require_preprod_gateway_bootstrap_artifact(
                core_cardano_profile.bridge_manifest_path.as_deref(),
                Path::new(core_cardano_profile.handler_json_path.as_str()),
            )?;
            crate::start::ensure_managed_cardano_runtime(
                project_root_path,
                clean,
                core_cardano_network,
            )
            .await
            .map_err(|error| {
                format!(
                    "ERROR: Failed to start preprod history sidecar runtime: {}",
                    error
                )
            })?;
            crate::setup::prepare_db_sync_and_gateway(
                project_root_path.join("chains/cardano").as_path(),
                clean,
                core_cardano_network,
            )
            .map_err(|error| format!("ERROR: Failed to prepare gateway runtime: {}", error))?;
        }
        match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
            Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
            Err(error) => return Err(format!("ERROR: Failed to start gateway: {}", error)),
        };
        return Ok(());
    }

    if target == Some(StartTarget::Relayer) {
        if core_cardano_network == config::CoreCardanoNetwork::Preprod {
            require_preprod_bridge_artifact(
                Path::new(core_cardano_profile.handler_json_path.as_str()),
                "handler.json",
            )?;
        }

        match start_relayer(
            project_root_path.join("relayer").as_path(),
            project_root_path.join("relayer/.env.example").as_path(),
            project_root_path.join("relayer/examples").as_path(),
            Path::new(core_cardano_profile.handler_json_path.as_str()),
            core_cardano_profile.chain_id.as_str(),
            core_cardano_network == config::CoreCardanoNetwork::Local,
            runtime_deployer_sk.as_deref(),
        ) {
            Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
            Err(error) => {
                return Err(format!(
                    "ERROR: Failed to configure Hermes relayer: {}",
                    error
                ))
            }
        };

        match start_hermes_daemon() {
            Ok(_) => logger::log("PASS: Hermes daemon started successfully"),
            Err(error) => return Err(format!("ERROR: Failed to start Hermes daemon: {}", error)),
        };
        logger::log(&format!(
            "\ncaribic start completed in {}",
            format_elapsed_duration(start_elapsed_timer.elapsed())
        ));
        return Ok(());
    }

    if target == Some(StartTarget::Mithril) {
        if !core_cardano_network.uses_local_mithril() {
            return Err(
                "ERROR: Local Mithril containers are not used with --network preprod.".to_string(),
            );
        }

        match start_mithril(project_root_path).await {
            Ok(cardano_epoch_on_mithril_start) => {
                logger::log("PASS: Mithril services started (1 aggregator, 2 signers)");

                let project_root_path = project_root_path.to_path_buf();
                let bootstrap_result = tokio::task::spawn_blocking(move || {
                    crate::start::wait_and_start_mithril_genesis(
                        project_root_path.as_path(),
                        cardano_epoch_on_mithril_start,
                    )
                    .map_err(|e| e.to_string())
                })
                .await;

                match bootstrap_result {
                    Ok(Ok(())) => logger::log(
                        "PASS: Mithril genesis bootstrap completed (certificates/artifacts ready)",
                    ),
                    Ok(Err(error)) => {
                        return Err(format!(
                            "ERROR: Mithril genesis bootstrap failed: {}",
                            error
                        ))
                    }
                    Err(error) => {
                        return Err(format!(
                            "ERROR: Mithril genesis bootstrap task failed: {}",
                            error
                        ))
                    }
                }
            }
            Err(error) => return Err(format!("ERROR: Failed to start Mithril: {}", error)),
        }
        logger::log(&format!(
            "\ncaribic start completed in {}",
            format_elapsed_duration(start_elapsed_timer.elapsed())
        ));
        return Ok(());
    }

    if start_network {
        match crate::start::start_local_cardano_network(
            project_root_path,
            clean,
            with_mithril && start_all,
            core_cardano_network,
        )
        .await
        {
            Ok(handle) => {
                mithril_genesis_handle = handle;
                let managed_services = match core_cardano_network {
                    config::CoreCardanoNetwork::Local => {
                        "cardano-node, ogmios, kupo, postgres, yaci-store, yaci-store-postgres"
                    }
                    config::CoreCardanoNetwork::Preprod => {
                        "cardano-node, postgres, yaci-store, yaci-store-postgres"
                    }
                };
                logger::log(&format!(
                    "PASS: Managed Cardano {} containers started ({})",
                    core_cardano_network.as_str(),
                    managed_services
                ));
            }
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Network,
                    &format!(
                        "ERROR: Failed to start managed Cardano {} runtime: {}",
                        core_cardano_network.as_str(),
                        error
                    ),
                );
            }
        }
        logger::log(&format!(
            "\nPASS: Cardano {} runtime started successfully",
            core_cardano_network.as_str()
        ));
    }

    if start_cosmos && !start_all {
        match start_cosmos_entrypoint_chain(project_root_path.join("cosmos").as_path(), clean).await
        {
            Ok(_) => logger::log(
                "PASS: Entrypoint chain started (packet-forwarding chain on port 26657)",
            ),
            Err(error) => {
                return Err(format!(
                    "ERROR: Failed to start Entrypoint chain: {}",
                    error
                ))
            }
        }
    }

    if start_bridge {
        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            );
            logger::info(&format!(
                "Initial balance {}",
                &balance.to_string().as_str()
            ));
        }

        let mut validators_built = false;
        if let Some(handle) = aiken_build_handle.take() {
            match handle.await {
                Ok(Ok(())) => validators_built = true,
                Ok(Err(error)) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to build Aiken validators: {}", error),
                    )
                }
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to build Aiken validators: {}", error),
                    )
                }
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Preprod {
            if !start_network {
                crate::start::ensure_managed_cardano_runtime(
                    project_root_path,
                    clean,
                    core_cardano_network,
                )
                .await
                .map_err(|error| {
                    format!(
                        "ERROR: Failed to start preprod history sidecar runtime: {}",
                        error
                    )
                })?;
            }
            crate::setup::prepare_db_sync_and_gateway(
                project_root_path.join("chains/cardano").as_path(),
                clean,
                core_cardano_network,
            )
            .map_err(|error| {
                format!(
                    "ERROR: Failed to prepare preprod gateway runtime: {}",
                    error
                )
            })?;
        }

        match core_cardano_network {
            config::CoreCardanoNetwork::Local => {
                match deploy_contracts(project_root_path, clean, validators_built).await {
                    Ok(_) => logger::log(
                        "PASS: IBC smart contracts deployed (client, connection, channel, packet handlers)",
                    ),
                    Err(error) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to deploy Cardano Scripts: {}", error),
                        )
                    }
                }
            }
            config::CoreCardanoNetwork::Preprod => {
                match deploy_preprod_bridge(
                    project_root_path,
                    validators_built,
                    runtime_deployer_sk
                        .as_deref()
                        .ok_or("ERROR: Missing runtime DEPLOYER_SK for preprod deploy")?,
                )
                .await
                {
                    Ok(_) => logger::log(
                        "PASS: IBC smart contracts deployed to Cardano preprod and deployment artifacts exported",
                    ),
                    Err(error) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to deploy Cardano preprod bridge: {}", error),
                        )
                    }
                }
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            );
            logger::info(&format!(
                "Post deploy contract balance {}",
                &balance.to_string().as_str()
            ));
        }

        match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
            Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    &format!("ERROR: Failed to start gateway: {}", error),
                )
            }
        }

        if start_all && start_cosmos {
            if let Some(handle) = cosmos_entrypoint_chain_start_handle.take() {
                logger::log(
                    "Waiting for Entrypoint startup task to complete (build/init may take a few minutes) ...",
                );
                match handle.await {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to start Entrypoint chain: {}", error),
                        );
                    }
                    Err(error) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to start Entrypoint chain: {}", error),
                        );
                    }
                }
            }

            match wait_for_cosmos_entrypoint_chain_ready().await {
                Ok(_) => logger::log(
                    "PASS: Entrypoint chain started (packet-forwarding chain on port 26657)",
                ),
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to start Entrypoint chain: {}", error),
                    );
                }
            }
        }

        if let Some(handle) = hermes_build_handle.take() {
            logger::log(
                "Waiting for Hermes relayer build to complete (this can take a few minutes) ...",
            );
            let mut handle = handle;
            let hermes_started_at = Instant::now();
            let mut next_progress_log =
                Duration::from_secs(HERMES_BUILD_PROGRESS_LOG_INTERVAL_SECS);
            let relayer_release_deps_dir = project_root_path.join("relayer/target/release/deps");
            let mut last_artifact_count =
                count_release_artifacts(relayer_release_deps_dir.as_path());

            let join_result = loop {
                match tokio::time::timeout(
                    Duration::from_secs(HERMES_BUILD_POLL_INTERVAL_SECS),
                    &mut handle,
                )
                .await
                {
                    Ok(result) => break result,
                    Err(_) => {
                        let elapsed = hermes_started_at.elapsed();
                        if elapsed >= next_progress_log {
                            let artifact_count =
                                count_release_artifacts(relayer_release_deps_dir.as_path());
                            if artifact_count > last_artifact_count {
                                logger::log(&format!(
                                    "Hermes build progress: {} compiled release artifacts ({}s elapsed)",
                                    artifact_count,
                                    elapsed.as_secs()
                                ));
                                last_artifact_count = artifact_count;
                            } else {
                                logger::log(&format!(
                                    "Hermes build still running ({}s elapsed, artifacts: {})",
                                    elapsed.as_secs(),
                                    artifact_count
                                ));
                            }
                            next_progress_log +=
                                Duration::from_secs(HERMES_BUILD_PROGRESS_LOG_INTERVAL_SECS);
                        }
                    }
                }
            };

            match join_result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to build Hermes relayer: {}", error),
                    )
                }
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to build Hermes relayer: {}", error),
                    )
                }
            }
        }

        match start_relayer(
            project_root_path.join("relayer").as_path(),
            project_root_path.join("relayer/.env.example").as_path(),
            project_root_path.join("relayer/examples").as_path(),
            Path::new(core_cardano_profile.handler_json_path.as_str()),
            core_cardano_profile.chain_id.as_str(),
            core_cardano_network == config::CoreCardanoNetwork::Local,
            runtime_deployer_sk.as_deref(),
        ) {
            Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    &format!("ERROR: Failed to configure Hermes relayer: {}", error),
                )
            }
        }

        match start_hermes_daemon() {
            Ok(_) => {
                logger::log("PASS: Hermes relayer started (check logs at ~/.hermes/hermes.log)")
            }
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    &format!("ERROR: Failed to start Hermes daemon: {}", error),
                )
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            );
            logger::log(&format!("Final balance {}", &balance.to_string().as_str()));
        }

        if let Some(handle) = mithril_genesis_handle.take() {
            let optional_progress_bar = match logger::get_verbosity() {
                logger::Verbosity::Verbose => None,
                _ => Some(ProgressBar::new_spinner()),
            };

            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.enable_steady_tick(Duration::from_millis(100));
                progress_bar.set_style(
                    ProgressStyle::with_template(
                        "{prefix:.bold} {spinner} [{elapsed_precise}] {wide_msg}",
                    )
                    .unwrap()
                    .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
                );
                progress_bar.set_prefix("Waiting for Mithril to become ready ...".to_owned());
                progress_bar
                    .set_message("This can take a few minutes on a fresh devnet".to_owned());
            } else {
                logger::log(
                    "Waiting for Mithril to become ready (this can take a few minutes on a fresh devnet) ...",
                );
            }

            let result = handle.await;

            if let Some(progress_bar) = &optional_progress_bar {
                progress_bar.finish_and_clear();
            }

            match result {
                Ok(Ok(())) => logger::log(
                    "PASS: Immutable Cardano node files have been created, and Mithril is working as expected",
                ),
                Ok(Err(error)) => {
                    return fail_and_stop_started_services(project_root_path, StopTarget::Bridge, &format!(
                        "ERROR: Mithril failed to read the immutable cardano node files: {}",
                        error
                    ))
                }
                Err(error) => {
                    return fail_and_stop_started_services(project_root_path, StopTarget::Bridge, &format!(
                        "ERROR: Mithril genesis bootstrap task failed: {}",
                        error
                    ))
                }
            }
        }

        logger::log("\nBridge started successfully!");
        if core_cardano_network == config::CoreCardanoNetwork::Local {
            logger::log(
                "Keys have been automatically configured for cardano-devnet and the Entrypoint chain.",
            );
            logger::log("Next steps:");
            logger::log("   1. Check health: caribic health-check");
            logger::log("   2. View keys: caribic keys list");
            logger::log("   3. Run tests: caribic test");
        } else {
            logger::log("Next steps:");
            logger::log("   1. Check health: caribic health-check");
            logger::log("   2. Review exported preprod artifacts in cardano/offchain/deployments");
            logger::log("   3. Restart gateway/relayer independently with `caribic start gateway --network preprod` or `caribic start relayer --network preprod`");
        }
    }

    logger::log(&format!(
        "\ncaribic start completed in {}",
        format_elapsed_duration(start_elapsed_timer.elapsed())
    ));
    Ok(())
}

/// Returns the optional-chain alias handled by `caribic start <target>` aliases.
fn resolve_optional_chain_alias(target: Option<&StartTarget>) -> Option<&'static str> {
    match target {
        Some(StartTarget::Osmosis) => Some("osmosis"),
        Some(StartTarget::Cheqd) => Some("cheqd"),
        Some(StartTarget::Injective) => Some("injective"),
        _ => None,
    }
}

/// Logs a startup failure, stops the requested service group, and returns the same error.
fn fail_and_stop_started_services(
    _project_root_path: &Path,
    stop_target: StopTarget,
    message: &str,
) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    crate::commands::stop::run_stop(Some(stop_target), None, Vec::new()).unwrap_or_default();
    Err(message.to_string())
}

fn count_release_artifacts(path: &Path) -> usize {
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .count()
        })
        .unwrap_or(0)
}

/// Formats elapsed time in human readable units for user-facing logs.
fn format_elapsed_duration(duration: Duration) -> String {
    let total_seconds = duration.as_secs();
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if hours > 0 {
        format!("{hours}h {minutes}m {seconds}s")
    } else if minutes > 0 {
        format!("{minutes}m {seconds}s")
    } else if total_seconds > 0 {
        format!("{seconds}s")
    } else {
        format!("{}ms", duration.subsec_millis())
    }
}
