use std::path::Path;
use std::path::PathBuf;

use clap::Parser;
use clap::Subcommand;
use start::deploy_contracts;
use start::start_cosmos_sidechain_from_repository;
use start::start_gateway;
use start::start_mithril;
use start::wait_and_start_mithril_genesis;
use start::{
    configure_hermes, prepare_osmosis, start_cosmos_sidechain, start_local_cardano_network,
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
    /// Spawns up a specific Cosmos side chain developed for demonstration purposes
    MessageExchange,
    /// Spawns up a local Osmosis setup developed for demonstrating an interchain swap
    TokenSwap,
}

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum StartTarget {
    /// Starts the local Cardano network related services
    Network,
    /// Deploys the light client contracts and starts the gateway and relayer
    Bridge,
    /// Starts the local Cardano network, Mithril, gateway and relayer
    All,
    /// Starts only the Gateway service
    Gateway,
    /// Starts only the Hermes relayer
    Relayer,
    /// Starts only the Mithril services
    Mithril,
}

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum StopTarget {
    /// Stops the local Cardano network related services
    Network,
    /// Tears down the gateway and relayer
    Bridge,
    /// Stops the demo services
    Demo,
    /// Stops the local Cardano network, Mithril, gateway and relayer and demo services
    All,
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
    /// Starts a specific bridge component. The component can be either the network, bridge or all. Default is all
    Start {
        #[arg(value_enum, default_value_t = StartTarget::All)]
        target: StartTarget,
        /// Cleans up the local environment before starting the services
        #[arg(long, default_value_t = false)]
        clean: bool,
        /// Start Mithril services for light client testing (adds 5-10 minute startup time)
        #[arg(long, default_value_t = false)]
        with_mithril: bool,
    },
    /// Stops a specific bridge component. The component can be either the network, bridge, demo or all. Default is all
    Stop {
        #[arg(value_enum, default_value_t = StopTarget::All)]
        target: StopTarget,
    },
    /// Manage Hermes keyring (add, list, delete keys)
    Keys {
        #[command(subcommand)]
        command: KeysCommand,
    },
    /// Check health of bridge services
    HealthCheck {
        /// Optional: specific service to check (gateway, cardano, postgres, kupo, ogmios, hermes)
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
    /// Runs end-to-end integration tests to verify IBC functionality
    /// 
    /// Note: Services must be started manually using 'caribic start all' before running tests
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

                // Start the Cosmos sidechain
                match start_cosmos_sidechain(project_root_path.join("cosmos").as_path()).await {
                    Ok(_) => logger::log("PASS: Cosmos sidechain up and running"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("ERROR: Failed to start Cosmos sidechain: {}", error),
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
                // Start the Cosmos sidechain
                let cosmos_chain_repo_url = format!(
                    "{}/archive/refs/heads/{}.zip",
                    project_config.vessel_oracle.repo_base_url,
                    project_config.vessel_oracle.target_branch
                );

                let chain_root_path = project_root_path.join("chains/summit-demo/");
                match start_cosmos_sidechain_from_repository(
                    &cosmos_chain_repo_url,
                    chain_root_path.as_path(),
                )
                .await
                {
                    Ok(_) => logger::log("PASS: Cosmos sidechain up and running"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to start Cosmos sidechain: {}",
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
                    Err(error) => {
                        bridge_down_with_error(&format!("ERROR: Failed to start relayer: {}", error))
                    }
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

            if target == StopTarget::Bridge {
                bridge_down();
                logger::log("\nBridge stopped successfully");
            } else if target == StopTarget::Network {
                network_down();
                logger::log("\nCardano Network successfully");
            } else if target == StopTarget::Demo {
                stop_cosmos(project_root_path.join("chains/summit-demo/").as_path(), "Summit demo Cosmos");
                stop_cosmos(project_root_path.join("cosmos").as_path(), "Cosmos");
                stop_osmosis(osmosis_dir.as_path());
                logger::log("\nDemo services stopped successfully");
            } else if target == StopTarget::All {
                stop_cosmos(project_root_path.join("chains/summit-demo/").as_path(), "Summit demo Cosmos");
                stop_cosmos(project_root_path.join("cosmos").as_path(), "Cosmos");
                stop_osmosis(osmosis_dir.as_path());
                bridge_down();
                network_down();
                logger::log("\nAll services stopped successfully");
            } else if target == StopTarget::Gateway {
                stop_gateway(project_root_path);
                logger::log("\nGateway stopped successfully");
            } else if target == StopTarget::Relayer {
                stop_relayer(project_root_path.join("relayer").as_path());
                logger::log("\nRelayer stopped successfully");
            } else if target == StopTarget::Mithril {
                stop_mithril(project_root_path.join("chains/mithrils").as_path());
                logger::log("\nMithril stopped successfully");
            } else {
                logger::error(
                    "ERROR: Invalid target to stop must be either 'bridge', 'network', 'demo', 'all', 'gateway', 'relayer', or 'mithril'",
                );
            }
        }
        Commands::Start { target, clean, with_mithril } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            let mut cardano_current_epoch = 0;

            if target == StartTarget::Network || target == StartTarget::All {
                // Start the local Cardano network and its services
                match start_local_cardano_network(&project_root_path, clean).await {
                    Ok(_) => logger::log("PASS: Local Cardano network started (cardano-node, ogmios, kupo, postgres, db-sync)"),
                    Err(error) => network_down_with_error(&format!(
                        "ERROR: Failed to start local Cardano network: {}",
                        error
                    )),
                }
                // Start Mithril if requested
                if with_mithril {
                    if target == StartTarget::All {
                        match start_mithril(&project_root_path).await {
                            Ok(current_epoch) => {
                                cardano_current_epoch = current_epoch;
                                logger::log("PASS: Mithril services started (1 aggregator, 2 signers)")
                            }
                            Err(error) => network_down_with_error(&format!(
                                "ERROR: Failed to start Mithril: {}",
                                error
                            )),
                        }
                    } else {
                        // Wait for Mithril to start reading the immutable cardano node files
                        match wait_and_start_mithril_genesis(&project_root_path, cardano_current_epoch) {
                            Ok(_) => logger::log("PASS: Immutable Cardano node files have been created, and Mithril is working as expected"),
                            Err(error) => {
                                network_down_with_error(&format!("ERROR: Mithril failed to read the immutable cardano node files: {}", error))
                        }}
                    }
                } else {
                    logger::log("Skipping Mithril services (use --with-mithril to enable light client testing)");
                }
                logger::log("\nPASS: Cardano Network started successfully");
            }

            if target == StartTarget::Bridge || target == StartTarget::All {
                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::info(&format!(
                    "Initial balance {}",
                    &balance.to_string().as_str()
                ));

                // Deploy Contracts
                match deploy_contracts(&project_root_path, clean).await {
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
                    Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 3001)"),
                    Err(error) => {
                        bridge_down_with_error(&format!("ERROR: Failed to start gateway: {}", error))
                    }
                }

                // Build and configure Hermes relayer
                match start_relayer(
                    project_root_path.join("relayer").as_path(),
                    project_root_path.join("relayer/.env.example").as_path(),
                    project_root_path.join("relayer/examples").as_path(),
                    project_root_path.join("cardano/offchain/deployments/handler.json").as_path(),
                ) {
                    Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
                    Err(error) => bridge_down_with_error(&format!(
                        "ERROR: Failed to configure Hermes relayer: {}",
                        error
                    )),
                }

                // Start Hermes daemon
                match start::start_hermes_daemon(project_root_path.join("relayer").as_path()) {
                    Ok(_) => logger::log("PASS: Hermes relayer started (check logs at ~/.hermes/hermes.log)"),
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
                if with_mithril && target == StartTarget::All {
                    match wait_and_start_mithril_genesis(&project_root_path, cardano_current_epoch) {
                    Ok(_) => logger::log("PASS: Immutable Cardano node files have been created, and Mithril is working as expected"),
                    Err(error) => {
                        network_down_with_error(&format!("ERROR: Mithril failed to read the immutable cardano node files: {}", error))
                        }
                    }
                }
                
                logger::log("\nBridge started successfully!");
                logger::log("Next steps:");
                logger::log("   1. Add keys: caribic keys add --chain cardano-devnet --mnemonic-file ~/cardano.txt");
                logger::log("   2. Add keys: caribic keys add --chain cheqd-testnet-6 --mnemonic-file ~/cheqd.txt");
                logger::log("   3. Check health: caribic health-check");
                logger::log("   4. View keys: caribic keys list");
            }

            if target == StartTarget::Gateway {
                // Start only the Gateway service
                match start_gateway(project_root_path.join("cardano/gateway").as_path(), clean) {
                    Ok(_) => logger::log("PASS: Gateway started (NestJS gRPC server on port 3001)"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start gateway: {}", error));
                        std::process::exit(1);
                    }
                }
            }

            if target == StartTarget::Relayer {
                // Build and configure Hermes relayer
                match start_relayer(
                    project_root_path.join("relayer").as_path(),
                    project_root_path.join("relayer/.env.example").as_path(),
                    project_root_path.join("relayer/examples").as_path(),
                    project_root_path.join("cardano/offchain/deployments/handler.json").as_path(),
                ) {
                    Ok(_) => logger::log("PASS: Hermes relayer built and configured"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to configure Hermes relayer: {}", error));
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

            if target == StartTarget::Mithril {
                // Start only Mithril services
                match start_mithril(&project_root_path).await {
                    Ok(_) => logger::log("PASS: Mithril services started (1 aggregator, 2 signers)"),
                    Err(error) => {
                        logger::error(&format!("ERROR: Failed to start Mithril: {}", error));
                        std::process::exit(1);
                    }
                }
            }
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

            match start::hermes_create_channel(&relayer_path, &a_chain, &b_chain, &a_port, &b_port) {
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
                Ok(_) => logger::log("\nAll integration tests passed!"),
                Err(error) => {
                    logger::error(&format!("Integration tests failed: {}", error));
                    std::process::exit(1);
                }
            }
        }
    }
}
