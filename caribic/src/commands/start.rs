use std::fs;
use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

use crate::{
    config, logger,
    start::{
        build_aiken_validators_if_needed, build_hermes_if_needed, deploy_contracts,
        deploy_preprod_bridge, start_cosmos_entrypoint_chain,
        start_cosmos_entrypoint_chain_services, start_gateway, start_hermes_daemon, start_mithril,
        start_relayer, wait_for_cosmos_entrypoint_chain_ready,
    },
    utils::query_balance,
    BridgeMode, StartTarget, StopTarget,
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

fn resolve_bridge_mode(
    network: config::CoreCardanoNetwork,
    requested_mode: Option<BridgeMode>,
) -> BridgeMode {
    requested_mode.unwrap_or(match network {
        config::CoreCardanoNetwork::Local => BridgeMode::Deploy,
        config::CoreCardanoNetwork::Preprod => BridgeMode::Join,
    })
}

fn target_includes_bridge(target: Option<StartTarget>) -> bool {
    target.is_none() || target == Some(StartTarget::All) || target == Some(StartTarget::Bridge)
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
    chain: Option<String>,
    network: Option<String>,
    bridge_mode: Option<BridgeMode>,
    chain_flags: Vec<String>,
) -> Result<(), String> {
    let start_elapsed_timer = Instant::now();

    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    if let Some(chain_id) = chain.as_deref() {
        if bridge_mode.is_some() {
            return Err(
                "ERROR: --bridge-mode only applies to the managed Cardano runtime. Do not combine it with --chain."
                    .to_string(),
            );
        }

        if target.is_some() {
            return Err(
                "ERROR: --chain cannot be combined with a start target. Use either `caribic start bridge` or `caribic start --chain <chain>`."
                    .to_string(),
            );
        }

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
            progress_bar.set_prefix(format!("Starting {} ...", chain_id));
            progress_bar.set_message(
                network
                    .as_deref()
                    .map(|resolved_network| {
                        format!("network={} (this can take a while)", resolved_network)
                    })
                    .unwrap_or_else(|| "resolving network (this can take a while)".to_string()),
            );
        } else {
            logger::log(&format!(
                "Starting optional chain {}{} ...",
                chain_id,
                network
                    .as_deref()
                    .map(|resolved_network| format!(" (network: {})", resolved_network))
                    .unwrap_or_default()
            ));
        }

        let start_result = crate::commands::chain::start_optional_chain(
            project_root_path,
            chain_id,
            network.as_deref(),
            chain_flags.as_slice(),
        )
        .await;

        if let Some(progress_bar) = &optional_progress_bar {
            progress_bar.finish_and_clear();
        }

        let (display_name, resolved_network) = start_result.map_err(|error| {
            format!(
                "ERROR: Failed to start optional chain '{}': {}",
                chain_id, error
            )
        })?;

        logger::log(&format!(
            "PASS: {} started successfully (network: {})",
            display_name, resolved_network,
        ));
        logger::log(&format!(
            "\ncaribic start completed in {}",
            format_elapsed_duration(start_elapsed_timer.elapsed())
        ));
        return Ok(());
    }

    let core_cardano_network = config::CoreCardanoNetwork::parse(network.as_deref())?;
    let core_cardano_profile = config::cardano_network_profile(core_cardano_network);
    let resolved_bridge_mode = resolve_bridge_mode(core_cardano_network, bridge_mode);

    if !chain_flags.is_empty() {
        return Err(
            "ERROR: --chain-flag requires --chain. Use `caribic start --chain <chain> --network <network>`."
                .to_string(),
        );
    }

    if bridge_mode.is_some() && !target_includes_bridge(target.clone()) {
        return Err(
            "ERROR: --bridge-mode only applies when starting the bridge (target omitted, all, or bridge)."
                .to_string(),
        );
    }

    let runtime_deployer_sk = if core_cardano_network != config::CoreCardanoNetwork::Local
        && target_requires_runtime_deployer_sk(target.clone())
    {
        Some(
            crate::utils::prompt_runtime_deployer_sk()
                .map_err(|error| format!("ERROR: Failed to load DEPLOYER_SK: {}", error))?,
        )
    } else {
        None
    };

    // Determine what to start.
    let start_all = target.is_none() || target == Some(StartTarget::All);
    let start_network = start_all || target == Some(StartTarget::Network);
    let start_cosmos = start_all || target == Some(StartTarget::Entrypoint);
    let start_bridge = start_all || target == Some(StartTarget::Bridge);

    if core_cardano_network == config::CoreCardanoNetwork::Preprod && clean {
        return Err(
            "ERROR: --clean is not supported with --network preprod in this milestone.".to_string(),
        );
    }

    if core_cardano_network == config::CoreCardanoNetwork::Preprod && with_mithril {
        return Err(
            "ERROR: --with-mithril is not supported with --network preprod. Use public Mithril release-preprod instead.".to_string(),
        );
    }

    let mut aiken_build_handle = None;
    let mut cosmos_entrypoint_chain_start_handle = None;
    let mut hermes_build_handle = None;
    let mut mithril_genesis_handle = None;

    if start_all {
        if start_cosmos {
            let cosmos_dir = project_root_path.join("cosmos");
            let clean = clean;
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

        if start_bridge && resolved_bridge_mode == BridgeMode::Deploy {
            let project_root_path = project_root_path.to_path_buf();
            let clean = clean;
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
            crate::setup::write_cardano_runtime_selection(
                project_root_path.join("chains/cardano").as_path(),
                core_cardano_network,
            )
            .map_err(|error| format!("ERROR: Failed to select Cardano runtime: {}", error))?;
            crate::setup::prepare_db_sync_and_gateway(
                project_root_path.join("chains/cardano").as_path(),
                clean,
                core_cardano_network,
            )
            .map_err(|error| format!("ERROR: Failed to prepare gateway runtime: {}", error))?;
        }
        match start_gateway(
            project_root_path.join("cardano/gateway").as_path(),
            clean,
        ) {
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
        match start_mithril(&project_root_path).await {
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

    if start_network && core_cardano_network.uses_managed_runtime() {
        match crate::start::start_local_cardano_network(
            &project_root_path,
            clean,
            with_mithril && start_all,
            core_cardano_network,
        )
        .await
        {
            Ok(handle) => {
                mithril_genesis_handle = handle;
                logger::log(&format!(
                    "PASS: Managed Cardano {} containers started (cardano-node, ogmios, kupo, postgres, yaci-store, yaci-store-postgres)",
                    core_cardano_network.as_str()
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
    } else if start_network {
        crate::setup::write_cardano_runtime_selection(
            project_root_path.join("chains/cardano").as_path(),
            core_cardano_network,
        )
        .map_err(|error| format!("ERROR: Failed to select Cardano runtime: {}", error))?;
        logger::log(&format!(
            "PASS: Cardano {} uses external infrastructure in this mode; no local Cardano containers were started",
            core_cardano_network.as_str()
        ));
    }

    if start_cosmos && !start_all {
        match start_cosmos_entrypoint_chain(project_root_path.join("cosmos").as_path(), clean).await
        {
            Ok(_) => logger::log(
                "PASS: Cosmos Entrypoint chain started (packet-forwarding chain on port 26657)",
            ),
            Err(error) => {
                return Err(format!(
                    "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                    error
                ))
            }
        }
    }

    if start_bridge {
        if resolved_bridge_mode == BridgeMode::Join
            && core_cardano_network == config::CoreCardanoNetwork::Preprod
        {
            require_preprod_bridge_artifact(
                Path::new(core_cardano_profile.handler_json_path.as_str()),
                "handler.json",
            )?;
        } else if resolved_bridge_mode == BridgeMode::Join {
            if !Path::new(core_cardano_profile.handler_json_path.as_str()).exists() {
                return Err(format!(
                    "ERROR: Missing existing local bridge deployment artifact at {}. Use --bridge-mode deploy to create a new bridge first.",
                    core_cardano_profile.handler_json_path
                ));
            }
        } else if core_cardano_network == config::CoreCardanoNetwork::Local {
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
            crate::setup::write_cardano_runtime_selection(
                project_root_path.join("chains/cardano").as_path(),
                core_cardano_network,
            )
            .map_err(|error| format!("ERROR: Failed to select Cardano runtime: {}", error))?;
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

        match (core_cardano_network, resolved_bridge_mode) {
            (config::CoreCardanoNetwork::Local, BridgeMode::Deploy) => {
                match deploy_contracts(&project_root_path, clean, validators_built).await {
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
            (config::CoreCardanoNetwork::Preprod, BridgeMode::Deploy) => {
                match deploy_preprod_bridge(
                    &project_root_path,
                    validators_built,
                    runtime_deployer_sk
                        .as_deref()
                        .ok_or("Missing runtime DEPLOYER_SK for preprod deploy")
                        .map_err(|error| format!("ERROR: {}", error))?,
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
            (config::CoreCardanoNetwork::Preprod, BridgeMode::Join) => {
                logger::log("PASS: Using existing preprod bridge deployment artifacts (deployment skipped)");
            }
            (config::CoreCardanoNetwork::Local, BridgeMode::Join) => {
                logger::log("PASS: Using existing local bridge deployment artifacts (deployment skipped)");
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Local
            && resolved_bridge_mode == BridgeMode::Deploy
        {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            );
            logger::info(&format!(
                "Post deploy contract balance {}",
                &balance.to_string().as_str()
            ));
        }

        match start_gateway(
            project_root_path.join("cardano/gateway").as_path(),
            clean,
        ) {
            Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    &format!("ERROR: Failed to start gateway: {}", error),
                )
            }
        }

        // In full startup mode, Cosmos is started in parallel at the beginning of `run_start`.
        // We intentionally defer the Cosmos readiness gate until right before relayer startup so
        // Cardano contract deployment and Gateway startup can progress independently.
        if start_all && start_cosmos {
            if let Some(handle) = cosmos_entrypoint_chain_start_handle.take() {
                logger::log(
                    "Waiting for Cosmos Entrypoint startup task to complete (build/init may take a few minutes) ...",
                );
                match handle.await {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to start Cosmos Entrypoint chain: {}", error),
                        );
                    }
                    Err(error) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            &format!("ERROR: Failed to start Cosmos Entrypoint chain: {}", error),
                        );
                    }
                }
            }

            match wait_for_cosmos_entrypoint_chain_ready().await {
                Ok(_) => logger::log(
                    "PASS: Cosmos Entrypoint chain started (packet-forwarding chain on port 26657)",
                ),
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        &format!("ERROR: Failed to start Cosmos Entrypoint chain: {}", error),
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
        logger::log(&format!(
            "Keys have been automatically configured for {} and the Cosmos Entrypoint chain.",
            core_cardano_profile.chain_id
        ));
        logger::log("Next steps:");
        logger::log("   1. Check health: caribic health-check");
        logger::log("   2. View keys: caribic keys list");
        if core_cardano_network == config::CoreCardanoNetwork::Local {
            logger::log("   3. Run tests: caribic test");
        }
    }

    logger::log(&format!(
        "\ncaribic start completed in {}",
        format_elapsed_duration(start_elapsed_timer.elapsed())
    ));
    Ok(())
}

/// Logs a startup failure, stops the requested service group, and returns the same error.
fn fail_and_stop_started_services(
    _project_root_path: &Path,
    stop_target: StopTarget,
    message: &str,
) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    crate::commands::stop::run_stop(Some(stop_target), None, None, Vec::new()).unwrap_or_default();
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
