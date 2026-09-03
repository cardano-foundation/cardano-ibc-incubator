use std::fs;
use std::path::Path;
use std::time::Duration;
use std::time::Instant;

use indicatif::{ProgressBar, ProgressStyle};

use crate::{
    chains, config, logger,
    start::{
        build_aiken_validators_if_needed, build_hermes_if_needed, deploy_contracts,
        deploy_public_cardano_bridge, ibc_swap_dapp_url, start_dapp, start_gateway,
        start_hermes_daemon, start_relayer,
    },
    utils::{prompt_runtime_deployer_sk, query_balance},
    StartTarget, StopTarget,
};

const HERMES_BUILD_PROGRESS_LOG_INTERVAL_SECS: u64 = 10;
const HERMES_BUILD_POLL_INTERVAL_SECS: u64 = 2;
const MITHRIL_DEPRECATED_ERROR: &str = "ERROR: Mithril setup is deprecated, disabled, and not maintained. Use the default stake-weighted-stability light-client mode. The Mithril source remains in-tree for historical reference only.";

fn requires_injective_testnet_route(network: config::CoreCardanoNetwork) -> bool {
    network.is_public_testnet()
}

fn ensure_public_testnet_relayer_route(
    project_root_path: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(), String> {
    if !requires_injective_testnet_route(network) {
        return Ok(());
    }

    chains::injective::ensure_testnet_chain_in_hermes_config(project_root_path).map_err(|error| {
        format!(
            "ERROR: Failed to configure Injective testnet Hermes route: {}",
            error
        )
    })
}

fn require_public_bridge_artifact(
    network: config::CoreCardanoNetwork,
    artifact_path: &Path,
    label: &str,
) -> Result<(), String> {
    if artifact_path.exists() {
        return Ok(());
    }

    Err(format!(
        "ERROR: Missing required {} {} at {}.\nProvide an existing {} bridge deployment artifact before starting against --network {}.",
        network.as_str(),
        label,
        artifact_path.display(),
        network.as_str(),
        network.as_str()
    ))
}

fn require_public_gateway_bootstrap_artifact(
    network: config::CoreCardanoNetwork,
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
        "ERROR: Missing required {} gateway bootstrap artifact.\nExpected either bridge manifest at {} or handler.json at {}.",
        network.as_str(),
        manifest_path.unwrap_or("<unset>"),
        handler_path.display()
    ))
}

fn ensure_active_cardano_runtime_identity(
    project_root_path: &Path,
    network: config::CoreCardanoNetwork,
) -> Result<(), String> {
    for env_path in [
        project_root_path.join("chains/cardano/.env"),
        project_root_path.join("cardano/gateway/.env"),
    ] {
        crate::setup::validate_active_cardano_runtime_env(env_path.as_path(), network).map_err(
            |error| {
                format!(
                    "ERROR: Cannot start a standalone service for Cardano {}: {}",
                    network.as_str(),
                    error
                )
            },
        )?;
    }
    Ok(())
}

fn target_requires_runtime_deployer_sk(target: Option<StartTarget>) -> bool {
    target.is_none()
        || target == Some(StartTarget::All)
        || target == Some(StartTarget::Bridge)
        || target == Some(StartTarget::Relayer)
}

fn target_starts_dapp(target: Option<&StartTarget>) -> bool {
    target.is_none() || matches!(target, Some(StartTarget::All) | Some(StartTarget::Dapp))
}

/// Starts the requested target and orchestrates the network, bridge, and dapp components.
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

    if with_mithril || target == Some(StartTarget::Mithril) {
        return Err(MITHRIL_DEPRECATED_ERROR.to_string());
    }

    // Determine what to start.
    let start_all = target.is_none() || target == Some(StartTarget::All);
    let start_network = start_all || target == Some(StartTarget::Network);
    let start_bridge = start_all || target == Some(StartTarget::Bridge);
    let start_dapp_target = target_starts_dapp(target.as_ref());

    if !chain_flags.is_empty() {
        return Err(
            "ERROR: --chain-flag is only supported through the chain adapter registry. Use `caribic chain start --chain <id> --network <network>`."
                .to_string(),
        );
    }

    let core_cardano_network = config::CoreCardanoNetwork::parse(network.as_deref())?;
    let core_cardano_profile = config::cardano_network_profile(core_cardano_network);

    crate::start::ensure_cardano_network_switch_is_safe(project_root_path, core_cardano_network)?;

    if matches!(target, Some(StartTarget::Relayer | StartTarget::Dapp))
        || (core_cardano_network == config::CoreCardanoNetwork::Local
            && matches!(target, Some(StartTarget::Bridge | StartTarget::Gateway)))
    {
        ensure_active_cardano_runtime_identity(project_root_path, core_cardano_network)?;
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
    let mut hermes_build_handle = None;
    let mut mithril_genesis_handle = None;

    if start_all {
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
        if core_cardano_network.is_public_testnet() {
            require_public_gateway_bootstrap_artifact(
                core_cardano_network,
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
                    "ERROR: Failed to start {} history sidecar runtime: {}",
                    core_cardano_network.as_str(),
                    error
                )
            })?;
            crate::setup::prepare_db_sync_and_gateway(
                project_root_path.join("chains/cardano").as_path(),
                clean,
                core_cardano_network,
                "stake-weighted-stability",
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
        if core_cardano_network.is_public_testnet() {
            require_public_bridge_artifact(
                core_cardano_network,
                Path::new(core_cardano_profile.handler_json_path.as_str()),
                "handler.json",
            )?;
        }

        match start_relayer(
            project_root_path.join("relayer").as_path(),
            project_root_path.join("relayer/.env.example").as_path(),
            project_root_path.join("relayer/examples").as_path(),
            core_cardano_profile
                .bridge_manifest_path
                .as_deref()
                .map(Path::new),
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

        ensure_public_testnet_relayer_route(project_root_path, core_cardano_network)?;

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

    if start_network {
        match crate::start::start_local_cardano_network(
            project_root_path,
            clean,
            false,
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
                    config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
                        "postgres, yaci-store, yaci-store-postgres; external Cardano relay, Kupo, and Ogmios"
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
                    core_cardano_network,
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

    if start_bridge {
        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            )
            .map_err(|error| format!("ERROR: Failed to query initial balance: {}", error))?;
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
                        core_cardano_network,
                        &format!("ERROR: Failed to build Aiken validators: {}", error),
                    )
                }
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        core_cardano_network,
                        &format!("ERROR: Failed to build Aiken validators: {}", error),
                    )
                }
            }
        }

        if core_cardano_network.is_public_testnet() {
            if !start_network {
                crate::start::ensure_managed_cardano_runtime(
                    project_root_path,
                    clean,
                    core_cardano_network,
                )
                .await
                .map_err(|error| {
                    format!(
                        "ERROR: Failed to start {} history sidecar runtime: {}",
                        core_cardano_network.as_str(),
                        error
                    )
                })?;
            }
            crate::setup::prepare_db_sync_and_gateway(
                project_root_path.join("chains/cardano").as_path(),
                clean,
                core_cardano_network,
                "stake-weighted-stability",
            )
            .map_err(|error| {
                format!(
                    "ERROR: Failed to prepare {} gateway runtime: {}",
                    core_cardano_network.as_str(),
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
                            core_cardano_network,
                            &format!("ERROR: Failed to deploy Cardano Scripts: {}", error),
                        )
                    }
                }
            }
            config::CoreCardanoNetwork::Preprod | config::CoreCardanoNetwork::Preview => {
                match deploy_public_cardano_bridge(
                    project_root_path,
                    core_cardano_network,
                    validators_built,
                    runtime_deployer_sk.as_deref().ok_or_else(|| {
                        format!(
                            "ERROR: Missing runtime DEPLOYER_SK for {} deploy",
                            core_cardano_network.as_str()
                        )
                    })?,
                )
                .await
                {
                    Ok(_) => logger::log(&format!(
                        "PASS: IBC smart contracts deployed to Cardano {} and deployment artifacts exported",
                        core_cardano_network.as_str()
                    )),
                    Err(error) => {
                        return fail_and_stop_started_services(
                            project_root_path,
                            StopTarget::Bridge,
                            core_cardano_network,
                            &format!(
                                "ERROR: Failed to deploy Cardano {} bridge: {}",
                                core_cardano_network.as_str(),
                                error
                            ),
                        )
                    }
                }
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            )
            .map_err(|error| format!("ERROR: Failed to query post-deploy balance: {}", error))?;
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
                    core_cardano_network,
                    &format!("ERROR: Failed to start gateway: {}", error),
                )
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
                        core_cardano_network,
                        &format!("ERROR: Failed to build Hermes relayer: {}", error),
                    )
                }
                Err(error) => {
                    return fail_and_stop_started_services(
                        project_root_path,
                        StopTarget::Bridge,
                        core_cardano_network,
                        &format!("ERROR: Failed to build Hermes relayer: {}", error),
                    )
                }
            }
        }

        match start_relayer(
            project_root_path.join("relayer").as_path(),
            project_root_path.join("relayer/.env.example").as_path(),
            project_root_path.join("relayer/examples").as_path(),
            core_cardano_profile
                .bridge_manifest_path
                .as_deref()
                .map(Path::new),
            core_cardano_profile.chain_id.as_str(),
            core_cardano_network == config::CoreCardanoNetwork::Local,
            runtime_deployer_sk.as_deref(),
        ) {
            Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    core_cardano_network,
                    &format!("ERROR: Failed to configure Hermes relayer: {}", error),
                )
            }
        }

        if let Err(error) =
            ensure_public_testnet_relayer_route(project_root_path, core_cardano_network)
        {
            return fail_and_stop_started_services(
                project_root_path,
                StopTarget::Bridge,
                core_cardano_network,
                &error,
            );
        }

        match start_hermes_daemon() {
            Ok(_) => {
                logger::log("PASS: Hermes relayer started (check logs at ~/.hermes/hermes.log)")
            }
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Bridge,
                    core_cardano_network,
                    &format!("ERROR: Failed to start Hermes daemon: {}", error),
                )
            }
        }

        if core_cardano_network == config::CoreCardanoNetwork::Local {
            let balance = query_balance(
                project_root_path,
                "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
            )
            .map_err(|error| format!("ERROR: Failed to query final balance: {}", error))?;
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
                    .map_err(|error| {
                        format!("ERROR: Failed to configure progress output: {error}")
                    })?
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
                    return fail_and_stop_started_services(project_root_path, StopTarget::Bridge, core_cardano_network, &format!(
                        "ERROR: Mithril failed to read the immutable cardano node files: {}",
                        error
                    ))
                }
                Err(error) => {
                    return fail_and_stop_started_services(project_root_path, StopTarget::Bridge, core_cardano_network, &format!(
                        "ERROR: Mithril genesis bootstrap task failed: {}",
                        error
                    ))
                }
            }
        }

        logger::log("\nBridge started successfully!");
        if core_cardano_network == config::CoreCardanoNetwork::Local {
            logger::log("Keys have been automatically configured for cardano-devnet.");
            logger::log("Next steps:");
            logger::log("   1. Check health: caribic health-check");
            logger::log("   2. View keys: caribic keys list");
            logger::log("   3. Run tests: caribic test");
        } else {
            logger::log("Next steps:");
            logger::log("   1. Check health: caribic health-check");
            logger::log(&format!(
                "   2. Review exported {} artifacts in manifests/{}",
                core_cardano_network.as_str(),
                core_cardano_network.as_str()
            ));
            logger::log(&format!(
                "   3. Restart gateway/relayer independently with `caribic start gateway --network {}` or `caribic start relayer --network {}`",
                core_cardano_network.as_str(),
                core_cardano_network.as_str()
            ));
        }
    }

    if start_dapp_target {
        ensure_active_cardano_runtime_identity(project_root_path, core_cardano_network)?;
        match start_dapp(project_root_path, clean, core_cardano_network) {
            Ok(_) => logger::log(&format!(
                "PASS: IBC Swap dapp started (Next.js UI at {})",
                ibc_swap_dapp_url()
            )),
            Err(error) => {
                return fail_and_stop_started_services(
                    project_root_path,
                    StopTarget::Dapp,
                    core_cardano_network,
                    &format!("ERROR: Failed to start IBC Swap dapp: {}", error),
                )
            }
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
    network: config::CoreCardanoNetwork,
    message: &str,
) -> Result<(), String> {
    logger::error(message);
    logger::log("Stopping services...");
    crate::commands::stop::run_stop(
        Some(stop_target),
        Some(network.as_str().to_string()),
        Vec::new(),
    )
    .unwrap_or_default();
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

#[cfg(test)]
mod tests {
    use super::{requires_injective_testnet_route, target_starts_dapp};
    use crate::{config::CoreCardanoNetwork, StartTarget};

    #[test]
    fn default_and_all_targets_start_the_dapp() {
        assert!(target_starts_dapp(None));
        assert!(target_starts_dapp(Some(&StartTarget::All)));
    }

    #[test]
    fn standalone_dapp_target_starts_the_dapp() {
        assert!(target_starts_dapp(Some(&StartTarget::Dapp)));
    }

    #[test]
    fn non_dapp_targets_do_not_start_the_dapp() {
        for target in [
            StartTarget::Network,
            StartTarget::Bridge,
            StartTarget::Gateway,
            StartTarget::Relayer,
            StartTarget::Mithril,
        ] {
            assert!(!target_starts_dapp(Some(&target)));
        }
    }

    #[test]
    fn both_public_cardano_testnets_require_the_injective_route() {
        assert!(!requires_injective_testnet_route(CoreCardanoNetwork::Local));
        assert!(requires_injective_testnet_route(
            CoreCardanoNetwork::Preprod
        ));
        assert!(requires_injective_testnet_route(
            CoreCardanoNetwork::Preview
        ));
    }
}
