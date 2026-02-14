use std::path::Path;
use std::path::PathBuf;
use std::time::Duration;
use std::time::Instant;

use clap::Parser;
use clap::Subcommand;
use indicatif::{ProgressBar, ProgressStyle};
use start::build_aiken_validators_if_needed;
use start::build_hermes_if_needed;
use start::deploy_contracts;
use start::start_cosmos_entrypoint_chain_from_repository;
use start::start_cosmos_entrypoint_chain_services;
use start::start_gateway;
use start::start_mithril;
use start::wait_for_cosmos_entrypoint_chain_ready;
use start::{
    configure_hermes, prepare_osmosis, start_cosmos_entrypoint_chain, start_local_cardano_network,
    start_osmosis, start_relayer,
};
use stop::stop_gateway;
use stop::stop_mithril;
use stop::{stop_cardano_network, stop_cosmos, stop_osmosis, stop_relayer};
use utils::default_config_path;
use utils::query_balance;
mod check;
mod config;
mod logger;
mod setup;
mod start;
mod stop;
mod test;
mod utils;

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum DemoType {
    /// Spawns up a specific Cosmos Entrypoint chain developed for demonstration purposes
    MessageExchange,
    /// Spawns up a local Osmosis setup developed for demonstrating an interchain swap
    TokenSwap,
}

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum StartTarget {
    /// Starts everything (network + packet-forwarding chain + bridge)
    All,
    /// Starts the local Cardano network related services
    Network,
    /// Deploys the light client contracts and starts the gateway and relayer
    Bridge,
    /// Starts the Cosmos Entrypoint chain (packet-forwarding chain)
    Cosmos,
    /// Starts only the local Osmosis appchain
    Osmosis,
    /// Starts only the Gateway service
    Gateway,
    /// Starts only the Hermes relayer
    Relayer,
    /// Starts only the Mithril services
    Mithril,
}

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum StopTarget {
    /// Stops everything (network + packet-forwarding chain + bridge + demos)
    All,
    /// Stops the local Cardano network related services
    Network,
    /// Tears down the gateway and relayer
    Bridge,
    /// Stops the Cosmos Entrypoint chain
    Cosmos,
    /// Stops only the local Osmosis appchain
    Osmosis,
    /// Stops the demo services
    Demo,
    /// Stops only the Gateway service
    Gateway,
    /// Stops only the Hermes relayer
    Relayer,
    /// Stops only the Mithril services
    Mithril,
}

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Args {
    /// Subcommand to execute
    #[command(subcommand)]
    command: Commands,
    /// Verbosity level (0 = quite, 1 = standard, 2 = warning, 3 = error, 4 = info, 5 = verbose)
    #[arg(long, default_value_t = 1)]
    verbose: usize,
    /// Configuration file name. It should be in the root directory of the project
    #[arg(short, long, default_value = default_config_path().into_os_string())]
    config: PathBuf,
}

#[derive(Subcommand)]
enum Commands {
    /// Verifies that all the prerequisites are installed and ensures that the configuration is correctly set up
    Check,
    /// Starts bridge components. No argument starts everything; optionally specify: all, network, bridge, cosmos, osmosis, gateway, relayer, mithril
    Start {
        #[arg(value_enum)]
        target: Option<StartTarget>,
        /// Cleans up the local environment before starting the services
        #[arg(long, default_value_t = false)]
        clean: bool,
        /// Start Mithril services for light client testing (adds 5-10 minute startup time)
        #[arg(long, default_value_t = false)]
        with_mithril: bool,
    },
    /// Stops bridge components. No argument stops everything; optionally specify: all, network, bridge, cosmos, osmosis, demo, gateway, relayer, mithril
    Stop {
        #[arg(value_enum)]
        target: Option<StopTarget>,
    },
    /// Manage Hermes keyring (add, list, delete keys)
    Keys {
        #[command(subcommand)]
        command: KeysCommand,
    },
    /// Check health of bridge services
    HealthCheck {
        /// Optional: specific service to check (gateway, cardano, postgres, kupo, ogmios, mithril, hermes, cosmos, osmosis, redis)
        #[arg(long)]
        service: Option<String>,
    },
    /// Create IBC client on target chain
    CreateClient {
        /// Source chain identifier
        #[arg(long)]
        host_chain: String,
        /// Target chain identifier (creates light client for this chain on host)
        #[arg(long)]
        reference_chain: String,
    },
    /// Create IBC connection between two chains
    CreateConnection {
        /// First chain identifier
        #[arg(long)]
        a_chain: String,
        /// Second chain identifier
        #[arg(long)]
        b_chain: String,
    },
    /// Create IBC channel between two chains
    CreateChannel {
        /// First chain identifier
        #[arg(long)]
        a_chain: String,
        /// Second chain identifier  
        #[arg(long)]
        b_chain: String,
        /// Port identifier on chain A
        #[arg(long)]
        a_port: String,
        /// Port identifier on chain B
        #[arg(long)]
        b_port: String,
    },
    /// Starts a demo use case. The use case can be either a token swap or a message exchange.
    Demo {
        #[arg(value_enum)]
        use_case: DemoType,
    },
    /// Run end-to-end integration tests to verify IBC functionality
    ///
    /// Prerequisites: All services must be running. Use 'caribic start' first.
    Test,
}

#[derive(Subcommand)]
enum KeysCommand {
    /// Add a key from mnemonic for a chain
    Add {
        /// Chain identifier (cardano-devnet or cheqd-testnet-6)
        #[arg(long)]
        chain: String,
        /// Path to file containing mnemonic phrase
        #[arg(long)]
        mnemonic_file: PathBuf,
        /// Key name (optional, defaults to chain's configured key_name)
        #[arg(long)]
        key_name: Option<String>,
        /// Overwrite existing key if it exists
        #[arg(long, default_value_t = false)]
        overwrite: bool,
    },
    /// List all stored keys
    List {
        /// Optional: filter by chain identifier
        #[arg(long)]
        chain: Option<String>,
    },
    /// Delete a key
    Delete {
        /// Chain identifier
        #[arg(long)]
        chain: String,
        /// Key name to delete
        #[arg(long)]
        key_name: Option<String>,
    },
}

fn network_down() {
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    // Stop local cardano network
    stop_cardano_network(project_root_path);

    // Stop Mithril
    stop_mithril(project_root_path.join("chains/mithrils").as_path());
}

fn network_down_with_error(message: &str) {
    logger::error(message);
    logger::log("Stopping services...");
    network_down();
    std::process::exit(1);
}

fn bridge_down() {
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    // Stop Relayer
    stop_relayer(project_root_path.join("relayer").as_path());
    // Stop Mithril
    stop_gateway(&project_root_path);
}

fn bridge_down_with_error(message: &str) {
    logger::error(message);
    logger::log("Stopping services...");
    bridge_down();
    std::process::exit(1);
}

fn exit_osmosis_demo_with_error(osmosis_dir: &PathBuf, message: &str) {
    logger::error(message);
    logger::log("Stopping services...");
    stop_osmosis(osmosis_dir.as_path());
    std::process::exit(1);
}

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

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Only print banner for start commands
    if matches!(args.command, Commands::Start { .. }) {
        utils::print_header();
    }

    logger::init(args.verbose);
    config::init(args.config.to_str().unwrap_or_else(|| {
        logger::error("Failed to get configuration file path");
        panic!("Failed to get configuration file path");
    }))
    .await;

    match args.command {
        Commands::Check => check::check_prerequisites().await,
        Commands::Demo { use_case } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            if use_case == DemoType::TokenSwap {
                // Prepare the local Osmosis appchain
                let osmosis_dir = utils::get_osmosis_dir(project_root_path);
                logger::verbose(&format!("{}", osmosis_dir.display().to_string()));

                match prepare_osmosis(osmosis_dir.as_path()).await {
                    Ok(_) => logger::log("PASS: Osmosis appchain prepared"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to prepare Osmosis appchain: {}", error),
                    ),
                }

                // Start the Cosmos Entrypoint chain
                match start_cosmos_entrypoint_chain(
                    project_root_path.join("cosmos").as_path(),
                    true,
                )
                .await
                {
                    Ok(_) => logger::log("PASS: Cosmos Entrypoint chain up and running"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to start Cosmos Entrypoint chain: {}", error),
                    ),
                }

                // Start Osmosis
                match start_osmosis(osmosis_dir.as_path()).await {
                    Ok(_) => logger::log("PASS: Osmosis appchain is up and running"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to start Osmosis: {}", error),
                    ),
                };

                match start_relayer(
                    project_root_path.join("relayer").as_path(),
                    project_root_path.join("relayer/.env.example").as_path(),
                    project_root_path.join("relayer/examples").as_path(),
                    project_root_path
                        .join("cardano/offchain/deployments/handler.json")
                        .as_path(),
                ) {
                    Ok(_) => logger::log("PASS: Relayer started successfully"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to start relayer: {}", error),
                    ),
                }

                // Configure Hermes and build channels between Osmosis with Cosmos
                match configure_hermes(osmosis_dir.as_path()) {
                    Ok(_) => logger::log("PASS: Hermes configured successfully and channels built"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to configure Hermes: {}", error),
                    ),
                }
                logger::log("\nPASS: Token swap demo services started successfully");
            } else if use_case == DemoType::MessageExchange {
                // Start the Cosmos Entrypoint chain
                let cosmos_chain_repo_url = format!(
                    "{}/archive/refs/heads/{}.zip",
                    project_config.vessel_oracle.repo_base_url,
                    project_config.vessel_oracle.target_branch
                );

                let chain_root_path = project_root_path.join("chains/summit-demo/");
                match start_cosmos_entrypoint_chain_from_repository(
                    &cosmos_chain_repo_url,
                    chain_root_path.as_path(),
                )
                .await
                {
                    Ok(_) => logger::log("PASS: Cosmos Entrypoint chain up and running"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                        error
                    )),
                }

                match start_relayer(
                    project_root_path.join("relayer").as_path(),
                    chain_root_path.join("relayer/.env.relayer").as_path(),
                    chain_root_path.join("relayer/config").as_path(),
                    project_root_path
                        .join("cardano/offchain/deployments/handler.json")
                        .as_path(),
                ) {
                    Ok(_) => logger::log("PASS: Relayer started successfully"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to start relayer: {}",
                        error
                    )),
                }

                logger::log("\nPASS: Message exchange demo services started successfully");
            } else {
                logger::error(
                    "ERROR: Invalid demo type. Must be either 'token-swap' or 'message-exchange'",
                );
            }
        }
        Commands::Stop { target } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let osmosis_dir = utils::get_osmosis_dir(project_root_path);

            match target {
                Some(StopTarget::All) | None => {
                    // No argument (or explicit `all`) = stop everything
                    stop_cosmos(
                        project_root_path.join("chains/summit-demo/").as_path(),
                        "Summit demo chain",
                    );
                    stop_cosmos(
                        project_root_path.join("cosmos").as_path(),
                        "Cosmos Entrypoint chain",
                    );
                    stop_osmosis(osmosis_dir.as_path());
                    bridge_down();
                    network_down();
                    logger::log("\nAll services stopped successfully");
                }
                Some(StopTarget::Bridge) => {
                    bridge_down();
                    logger::log("\nBridge stopped successfully");
                }
                Some(StopTarget::Network) => {
                    network_down();
                    logger::log("\nCardano Network stopped successfully");
                }
                Some(StopTarget::Cosmos) => {
                    stop_cosmos(
                        project_root_path.join("cosmos").as_path(),
                        "Cosmos Entrypoint chain",
                    );
                    logger::log("\nCosmos Entrypoint chain stopped successfully");
                }
                Some(StopTarget::Osmosis) => {
                    stop_osmosis(osmosis_dir.as_path());
                    logger::log("\nOsmosis appchain stopped successfully");
                }
                Some(StopTarget::Demo) => {
                    stop_cosmos(
                        project_root_path.join("chains/summit-demo/").as_path(),
                        "Summit demo chain",
                    );
                    stop_cosmos(
                        project_root_path.join("cosmos").as_path(),
                        "Cosmos Entrypoint chain",
                    );
                    stop_osmosis(osmosis_dir.as_path());
                    logger::log("\nDemo services stopped successfully");
                }
                Some(StopTarget::Gateway) => {
                    stop_gateway(project_root_path);
                    logger::log("\nGateway stopped successfully");
                }
                Some(StopTarget::Relayer) => {
                    stop_relayer(project_root_path.join("relayer").as_path());
                    logger::log("\nRelayer stopped successfully");
                }
                Some(StopTarget::Mithril) => {
                    stop_mithril(project_root_path.join("chains/mithrils").as_path());
                    logger::log("\nMithril stopped successfully (mithril-aggregator, mithril-signer-1, mithril-signer-2)");
                }
            }
        }
        Commands::Start {
            target,
            clean,
            with_mithril,
        } => {
            let start_elapsed_timer = Instant::now();

            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            // Determine what to start.
            // - No argument is treated as "all"
            // - We also accept an explicit `all` target for clarity
            let start_all = target.is_none() || target == Some(StartTarget::All);
            let start_network = start_all || target == Some(StartTarget::Network);
            let start_cosmos = start_all || target == Some(StartTarget::Cosmos);
            let start_bridge = start_all || target == Some(StartTarget::Bridge);

            let mut aiken_build_handle = None;
            let mut cosmos_entrypoint_chain_start_handle = None;
            let mut hermes_build_handle = None;
            let mut mithril_genesis_handle = None;

            // The Cosmos Entrypoint chain boot and Hermes compilation are independent of Cardano
            // devnet boot, so can start them in parallel for `caribic start all`.
            //
            // We keep the existing (sequential) user-facing status messages, but start the
            // expensive processes early in the background.
            if start_all {
                if start_cosmos {
                    let cosmos_dir = project_root_path.join("cosmos");
                    let clean = clean;
                    cosmos_entrypoint_chain_start_handle =
                        Some(tokio::task::spawn_blocking(move || {
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

            if start_network {
                // Start the local Cardano network and its services
                match start_local_cardano_network(
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
                        )
                    }
                    Err(error) => network_down_with_error(&format!(
                        "ERROR: Failed to start local Cardano network: {}",
                        error
                    )),
                }
                logger::log("\nPASS: Cardano Network started successfully");
            }

            if start_cosmos {
                if start_all {
                    // If we started the entrypoint chain in the background, await the docker-compose
                    // stage here and then run the readiness check.
                    if let Some(handle) = cosmos_entrypoint_chain_start_handle.take() {
                        match handle.await {
                            Ok(Ok(())) => {}
                            Ok(Err(error)) => {
                                logger::error(&format!(
                                    "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                                    error
                                ));
                                std::process::exit(1);
                            }
                            Err(error) => {
                                logger::error(&format!(
                                    "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                                    error
                                ));
                                std::process::exit(1);
                            }
                        }
                    }

                    match wait_for_cosmos_entrypoint_chain_ready().await {
                        Ok(_) => logger::log(
                            "PASS: Cosmos Entrypoint chain started (packet-forwarding chain on port 26657)",
                        ),
                        Err(error) => {
                            logger::error(&format!(
                                "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                                error
                            ));
                            std::process::exit(1);
                        }
                    }
                } else {
                    // Start the Cosmos Entrypoint chain (packet-forwarding chain)
                    match start_cosmos_entrypoint_chain(
                        project_root_path.join("cosmos").as_path(),
                        clean,
                    )
                        .await
                    {
                        Ok(_) => logger::log(
                            "PASS: Cosmos Entrypoint chain started (packet-forwarding chain on port 26657)",
                        ),
                        Err(error) => {
                            logger::error(&format!(
                                "ERROR: Failed to start Cosmos Entrypoint chain: {}",
                                error
                            ));
                        }
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
                        Ok(Err(error)) => bridge_down_with_error(&format!(
                            "ERROR: Failed to build Aiken validators: {}",
                            error
                        )),
                        Err(error) => bridge_down_with_error(&format!(
                            "ERROR: Failed to build Aiken validators: {}",
                            error
                        )),
                    }
                }

                // Deploy Contracts
                match deploy_contracts(&project_root_path, clean, validators_built).await {
                    Ok(_) => logger::log("PASS: IBC smart contracts deployed (client, connection, channel, packet handlers)"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to deploy Cardano Scripts: {}",
                        error
                    )),
                }

                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::info(&format!(
                    "Post deploy contract balance {}",
                    &balance.to_string().as_str()
                ));

                // Start gateway
                match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
                    Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to start gateway: {}",
                        error
                    )),
                }

                // Ensure the parallel Hermes compilation (if any) finished before configuring
                // the relayer (which expects a ready `target/release/hermes` binary).
                if let Some(handle) = hermes_build_handle.take() {
                    match handle.await {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => bridge_down_with_error(&format!(
                            "ERROR: Failed to build Hermes relayer: {}",
                            error
                        )),
                        Err(error) => bridge_down_with_error(&format!(
                            "ERROR: Failed to build Hermes relayer: {}",
                            error
                        )),
                    }
                }

                // Build and configure Hermes relayer
                match start_relayer(
                    project_root_path.join("relayer").as_path(),
                    project_root_path.join("relayer/.env.example").as_path(),
                    project_root_path.join("relayer/examples").as_path(),
                    project_root_path
                        .join("cardano/offchain/deployments/handler.json")
                        .as_path(),
                ) {
                    Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to configure Hermes relayer: {}",
                        error
                    )),
                }

                // Start Hermes daemon
                match start::start_hermes_daemon(project_root_path.join("relayer").as_path()) {
                    Ok(_) => logger::log(
                        "PASS: Hermes relayer started (check logs at ~/.hermes/hermes.log)",
                    ),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to start Hermes daemon: {}",
                        error
                    )),
                }

                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::log(&format!("Final balance {}", &balance.to_string().as_str()));

                // If we are starting a fresh devnet with Mithril enabled, we already started the
                // long-running genesis bootstrap wait in the background during Cardano network
                // startup. Await it here so `caribic start all --with-mithril` only returns once
                // Mithril is actually able to certify transaction snapshots for this devnet.
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
                        progress_bar
                            .set_prefix("Waiting for Mithril to become ready ...".to_owned());
                        progress_bar.set_message(
                            "This can take a few minutes on a fresh devnet".to_owned(),
                        );
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
                        Ok(Ok(())) => logger::log("PASS: Immutable Cardano node files have been created, and Mithril is working as expected"),
                        Ok(Err(error)) => network_down_with_error(&format!(
                            "ERROR: Mithril failed to read the immutable cardano node files: {}",
                            error
                        )),
                        Err(error) => network_down_with_error(&format!(
                            "ERROR: Mithril genesis bootstrap task failed: {}",
                            error
                        )),
                    }
                }

                logger::log("\nBridge started successfully!");
                logger::log("Keys have been automatically configured for cardano-devnet and the Cosmos Entrypoint chain.");
                logger::log("Next steps:");
                logger::log("   1. Check health: caribic health-check");
                logger::log("   2. View keys: caribic keys list");
                logger::log("   3. Run tests: caribic test");
            }

            if target == Some(StartTarget::Gateway) {
                // Start only the Gateway service
                match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
                    Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 5001)"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start gateway: {}", error));
                        std::process::exit(1);
                    }
                }
            }

            if target == Some(StartTarget::Relayer) {
                // Build and configure Hermes relayer
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
                        logger::error(&format!(
                            "ERROR: Failed to configure Hermes relayer: {}",
                            error
                        ));
                        std::process::exit(1);
                    }
                }

                // Start Hermes daemon
                match start::start_hermes_daemon(project_root_path.join("relayer").as_path()) {
                    Ok(_) => logger::log("PASS: Hermes daemon started successfully"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start Hermes daemon: {}", error));
                        std::process::exit(1);
                    }
                }
            }

            if target == Some(StartTarget::Mithril) {
                // Start only Mithril services
                match start_mithril(&project_root_path).await {
                    Ok(_) => {
                        logger::log("PASS: Mithril services started (1 aggregator, 2 signers)")
                    }
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start Mithril: {}", error));
                        std::process::exit(1);
                    }
                }
            }

            if target == Some(StartTarget::Osmosis) {
                let osmosis_dir = utils::get_osmosis_dir(project_root_path);

                match prepare_osmosis(osmosis_dir.as_path()).await {
                    Ok(_) => logger::log("PASS: Osmosis appchain prepared"),
                    Err(error) => {
                        logger::error(&format!(
                            "ERROR: Failed to prepare Osmosis appchain: {}",
                            error
                        ));
                        std::process::exit(1);
                    }
                }

                match start_osmosis(osmosis_dir.as_path()).await {
                    Ok(_) => logger::log("PASS: Osmosis appchain started successfully"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start Osmosis: {}", error));
                        std::process::exit(1);
                    }
                }
            }

            logger::log(&format!(
                "\ncaribic start completed in {}",
                format_elapsed_duration(start_elapsed_timer.elapsed())
            ));
        }
        Commands::Keys { command } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let relayer_path = project_root_path.join("relayer");

            match command {
                KeysCommand::Add {
                    chain,
                    mnemonic_file,
                    key_name,
                    overwrite,
                } => match start::hermes_keys_add(
                    &relayer_path,
                    &chain,
                    &mnemonic_file,
                    key_name.as_deref(),
                    overwrite,
                ) {
                    Ok(msg) => logger::log(&msg),
                    Err(e) => {
                        logger::error(&format!("Failed to add key: {}", e));
                        std::process::exit(1);
                    }
                },
                KeysCommand::List { chain } => {
                    match start::hermes_keys_list(&relayer_path, chain.as_deref()) {
                        Ok(output) => logger::log(&output),
                        Err(e) => {
                            logger::error(&format!("Failed to list keys: {}", e));
                            std::process::exit(1);
                        }
                    }
                }
                KeysCommand::Delete { chain, key_name } => {
                    match start::hermes_keys_delete(&relayer_path, &chain, key_name.as_deref()) {
                        Ok(msg) => logger::log(&msg),
                        Err(e) => {
                            logger::error(&format!("Failed to delete key: {}", e));
                            std::process::exit(1);
                        }
                    }
                }
            }
        }
        Commands::HealthCheck { service } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            match start::comprehensive_health_check(project_root_path, service.as_deref()) {
                Ok(output) => logger::log(&output),
                Err(e) => {
                    logger::error(&format!("Health check failed: {}", e));
                    std::process::exit(1);
                }
            }
        }
        Commands::CreateClient {
            host_chain,
            reference_chain,
        } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let relayer_path = project_root_path.join("relayer");

            match start::hermes_create_client(&relayer_path, &host_chain, &reference_chain) {
                Ok(msg) => logger::log(&msg),
                Err(e) => {
                    logger::error(&format!("Failed to create client: {}", e));
                    std::process::exit(1);
                }
            }
        }
        Commands::CreateConnection { a_chain, b_chain } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let relayer_path = project_root_path.join("relayer");

            match start::hermes_create_connection(&relayer_path, &a_chain, &b_chain) {
                Ok(msg) => logger::log(&msg),
                Err(e) => {
                    logger::error(&format!("Failed to create connection: {}", e));
                    std::process::exit(1);
                }
            }
        }
        Commands::CreateChannel {
            a_chain,
            b_chain,
            a_port,
            b_port,
        } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let relayer_path = project_root_path.join("relayer");

            match start::hermes_create_channel(&relayer_path, &a_chain, &b_chain, &a_port, &b_port)
            {
                Ok(msg) => logger::log(&msg),
                Err(e) => {
                    logger::error(&format!("Failed to create channel: {}", e));
                    std::process::exit(1);
                }
            }
        }
        Commands::Test => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            match test::run_integration_tests(project_root_path).await {
                Ok(results) => {
                    // Print summary
                    logger::log(&format!(
                        "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTest Summary: {} total\n  ✓ {} passed\n  ⊘ {} skipped\n  ✗ {} failed\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                        results.total(),
                        results.passed,
                        results.skipped,
                        results.failed
                    ));

                    if results.has_failures() {
                        logger::error("\nTests failed! Fix the errors above and try again.");
                        std::process::exit(1);
                    } else if results.all_passed() {
                        logger::log("\nAll integration tests passed!");
                    } else if results.skipped > 0 {
                        logger::log("\nAll runnable tests passed. Some tests were skipped due to known limitations.");
                        logger::log("See skipped test messages above for details.");
                    }
                }
                Err(error) => {
                    logger::error(&format!("Integration tests failed: {}", error));
                    std::process::exit(1);
                }
            }
        }
    }
}
