use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

use crate::{
    chains::{self, ChainStartRequest},
    config, logger,
    start::{
        build_aiken_validators_if_needed, build_hermes_if_needed, deploy_contracts,
        start_cosmos_entrypoint_chain, start_cosmos_entrypoint_chain_services, start_gateway,
        start_hermes_daemon, start_mithril, start_relayer, wait_for_cosmos_entrypoint_chain_ready,
    },
    utils::query_balance,
    StartTarget, StopTarget,
};

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
    let start_cosmos = start_all || target == Some(StartTarget::Cosmos);
    let start_bridge = start_all || target == Some(StartTarget::Bridge);
    let optional_chain_alias = resolve_optional_chain_alias(target.as_ref());

    if optional_chain_alias.is_none() && (network.is_some() || !chain_flags.is_empty()) {
        return Err(
            "ERROR: --network and --chain-flag are only supported with `caribic start <optional-chain-alias>` or `caribic chain start ...`"
                .to_string(),
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

        if start_bridge {
            let project_root_path = project_root_path.to_path_buf();
            let clean = clean;
            aiken_build_handle = Some(tokio::task::spawn_blocking(move || {
                build_aiken_validators_if_needed(project_root_path.as_path(), clean)
                    .map_err(|e| e.to_string())
            }));
        }
    }

    if target == Some(StartTarget::Gateway) {
        match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
            Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
            Err(error) => return Err(format!("ERROR: Failed to start gateway: {}", error)),
        };
        return Ok(());
    }

    if target == Some(StartTarget::Relayer) {
        match start_relayer(
            project_root_path.join("relayer").as_path(),
            project_root_path.join("relayer/.env.example").as_path(),
            project_root_path.join("relayer/examples").as_path(),
            project_root_path
                .join("cardano/offchain/deployments/handler.json")
                .as_path(),
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

        chain_adapter
            .start(project_root_path, &request)
            .await
            .map_err(|error| {
                format!(
                    "ERROR: Failed to start {}: {}",
                    chain_adapter.display_name(),
                    error
                )
            })?;
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

    if start_network {
        match crate::start::start_local_cardano_network(
            &project_root_path,
            clean,
            with_mithril && start_all,
        )
        .await
        {
            Ok(handle) => {
                mithril_genesis_handle = handle;
                logger::log(
                    "PASS: Local Cardano network started (cardano-node, ogmios, kupo, postgres, db-sync)",
                );
            }
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Network,
                    &format!("ERROR: Failed to start local Cardano network: {}", error),
                );
            }
        }
        logger::log("\nPASS: Cardano Network started successfully");
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
        let balance = query_balance(
            project_root_path,
            "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
        );
        logger::info(&format!(
            "Initial balance {}",
            &balance.to_string().as_str()
        ));

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

        let balance = query_balance(
            project_root_path,
            "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
        );
        logger::info(&format!(
            "Post deploy contract balance {}",
            &balance.to_string().as_str()
        ));

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

        // In full startup mode, Cosmos is started in parallel at the beginning of `run_start`.
        // We intentionally defer the Cosmos readiness gate until right before relayer startup so
        // Cardano contract deployment and Gateway startup can progress independently.
        if start_all && start_cosmos {
            if let Some(handle) = cosmos_entrypoint_chain_start_handle.take() {
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
            match handle.await {
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
            project_root_path
                .join("cardano/offchain/deployments/handler.json")
                .as_path(),
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

        let balance = query_balance(
            project_root_path,
            "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
        );
        logger::log(&format!("Final balance {}", &balance.to_string().as_str()));

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
        logger::log("Keys have been automatically configured for cardano-devnet and the Cosmos Entrypoint chain.");
        logger::log("Next steps:");
        logger::log("   1. Check health: caribic health-check");
        logger::log("   2. View keys: caribic keys list");
        logger::log("   3. Run tests: caribic test");
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
