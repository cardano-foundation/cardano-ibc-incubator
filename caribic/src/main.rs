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
    },
    /// Stops a specific bridge component. The component can be either the network, bridge, demo or all. Default is all
    Stop {
        #[arg(value_enum, default_value_t = StopTarget::All)]
        target: StopTarget,
    },
    /// Starts a demo use case. The use case can be either a token swap or a message exchange.
    Demo {
        #[arg(value_enum)]
        use_case: DemoType,
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
    logger::log("🚨 Stopping services...");
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
    logger::log("🚨 Stopping services...");
    bridge_down();
    std::process::exit(1);
}

fn exit_osmosis_demo_with_error(osmosis_dir: &PathBuf, message: &str) {
    logger::error(message);
    logger::log("🚨 Stopping services...");
    stop_osmosis(osmosis_dir.as_path());
    std::process::exit(1);
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    utils::print_header();
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
                    Ok(_) => logger::log("✅ Osmosis appchain prepared"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("❌ Failed to prepare Osmosis appchain: {}", error),
                    ),
                }

                // Start the Cosmos sidechain
                match start_cosmos_sidechain(project_root_path.join("cosmos").as_path()).await {
                    Ok(_) => logger::log("✅ Cosmos sidechain up and running"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("❌ Failed to start Cosmos sidechain: {}", error),
                    ),
                }

                // Start Osmosis
                match start_osmosis(osmosis_dir.as_path()).await {
                    Ok(_) => logger::log("✅ Osmosis appchain is up and running"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("❌ Failed to start Osmosis: {}", error),
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
                    Ok(_) => logger::log("✅ Relayer started successfully"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("❌ Failed to start relayer: {}", error),
                    ),
                }

                // Configure Hermes and build channels between Osmosis with Cosmos
                match configure_hermes(osmosis_dir.as_path()) {
                    Ok(_) => logger::log("✅ Hermes configured successfully and channels built"),
                    Err(error) => exit_osmosis_demo_with_error(
                        &osmosis_dir,
                        &format!("❌ Failed to configure Hermes: {}", error),
                    ),
                }
                logger::log("\n✅ Token swap demo services started successfully");
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
                    Ok(_) => logger::log("✅ Cosmos sidechain up and running"),
                    Err(error) => bridge_down_with_error(&format!(
                        "❌ Failed to start Cosmos sidechain: {}",
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
                    Ok(_) => logger::log("✅ Relayer started successfully"),
                    Err(error) => {
                        bridge_down_with_error(&format!("❌ Failed to start relayer: {}", error))
                    }
                }

                logger::log("\n✅ Message exchange demo services started successfully");
            } else {
                logger::error(
                    "❌ Invalid demo type. Must be either 'token-swap' or 'message-exchange'",
                );
            }
        }
        Commands::Stop { target } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let osmosis_dir = utils::get_osmosis_dir(project_root_path);

            if target == StopTarget::Bridge {
                bridge_down();
                logger::log("\n❎ Bridge stopped successfully");
            } else if target == StopTarget::Network {
                network_down();
                logger::log("\n❎ Cardano Network successfully");
            } else if target == StopTarget::Demo {
                stop_cosmos(project_root_path.join("chains/summit-demo/").as_path());
                stop_cosmos(project_root_path.join("cosmos").as_path());
                stop_osmosis(osmosis_dir.as_path());
                logger::log("\n❎ Demo services stopped successfully");
            } else if target == StopTarget::All {
                stop_cosmos(project_root_path.join("chains/summit-demo/").as_path());
                stop_cosmos(project_root_path.join("cosmos").as_path());
                stop_osmosis(osmosis_dir.as_path());
                bridge_down();
                network_down();
                logger::log("\n❎ All services stopped successfully");
            } else {
                logger::error(
                    "❌ Invalid target to stop must be either 'bridge', 'network', 'demo' or 'all'",
                );
            }
        }
        Commands::Start { target } => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            if target == StartTarget::Network || target == StartTarget::All {
                // Start the local Cardano network and its services
                match start_local_cardano_network(&project_root_path).await {
                    Ok(_) => logger::log("✅ Local Cardano network has been started and prepared"),
                    Err(error) => network_down_with_error(&format!(
                        "❌ Failed to start local Cardano network: {}",
                        error
                    )),
                }

                let mut cardano_current_epoch = 0;
                // Start Mithril if needed
                match start_mithril(&project_root_path).await {
                    Ok(current_epoch) => {
                        cardano_current_epoch = current_epoch;
                        logger::log("✅ Mithril up and running")
                    }
                    Err(error) => {
                        network_down_with_error(&format!("❌ Failed to start Mithril: {}", error))
                    }
                }

                // Wait for Mithril to start reading the immutable cardano node files
                match wait_and_start_mithril_genesis(&project_root_path, cardano_current_epoch) {
                    Ok(_) => logger::log("✅ Immutable Cardano node files have been created, and Mithril is working as expected"),
                    Err(error) => {
                        network_down_with_error(&format!("❌ Mithril failed to read the immutable cardano node files: {}", error))
                }}

                logger::log("\n✅ Cardano Network started successfully");
            }

            if target == StartTarget::Bridge || target == StartTarget::All {
                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::log(&format!(
                    "Initial balance {}",
                    &balance.to_string().as_str()
                ));

                // Deploy Contracts
                match deploy_contracts(&project_root_path).await {
                    Ok(_) => logger::log("✅ Cardano Scripts correcty deployed"),
                    Err(error) => bridge_down_with_error(&format!(
                        "❌ Failed to deploy Cardano Scripts: {}",
                        error
                    )),
                }

                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::log(&format!(
                    "Post deploy contract balance {}",
                    &balance.to_string().as_str()
                ));

                // Start gateway
                match start_gateway(project_root_path.join("cardano/gateway").as_path()) {
                    Ok(_) => logger::log("✅ Gateway started successfully"),
                    Err(error) => {
                        bridge_down_with_error(&format!("❌ Failed to start gateway: {}", error))
                    }
                }

                let balance = query_balance(
                    project_root_path,
                    "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m",
                );
                logger::log(&format!("Final balance {}", &balance.to_string().as_str()));
            }
        }
    }
}
