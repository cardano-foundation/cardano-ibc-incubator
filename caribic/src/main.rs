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
use stop::stop_mithril;
use stop::{stop_cardano_network, stop_cosmos, stop_osmosis, stop_relayer, stop_gateway};
use utils::default_config_path;
mod check;
mod config;
mod logger;
mod setup;
mod start;
mod stop;
mod utils;

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
    /// Creates a local development environment including all necessary components for a IBC connection between Cardano and Osmosis
    Start,
    /// Stops the local development environment
    Stop,
    /// Performs a token swap between Cardano and Osmosis
    Demo,
    /// Creates a local development environment using a specific Cosmos side chain developed for demonstration purposes
    VesselDemo,
    /// Stops the vessel oracle demo
    StopVesselDemo,
    RelayerStart
}

fn stop_bridge_gracefully() {
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    
    // Stop local cardano network
    stop_cardano_network(project_root_path);
    
    // Stop Cosmos
    stop_cosmos(project_root_path.join("cosmos").as_path());

    // Stop Relayer
    stop_relayer(project_root_path.join("relayer").as_path());

    // Stop Osmosis
    stop_osmosis(project_root_path.join("chains/osmosis/osmosis").as_path());

    // Stop Mithril
    stop_mithril(project_root_path.join("chains/mithrils").as_path());
}

fn stop_vessel_demo_gracefully() {
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    
    // Stop local cardano network
    stop_cardano_network(project_root_path);
    
    // Stop Cosmos
    stop_cosmos(project_root_path.join("chains/summit-demo/").as_path());

    // Stop Relayer
    stop_relayer(project_root_path.join("relayer").as_path());

    // Stop Mithril
    stop_mithril(project_root_path.join("chains/mithrils").as_path());
}


fn stop_gtw_relayer_demo_gracefully() {
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);
    
    // Stop Relayer
    stop_relayer(project_root_path.join("relayer").as_path());
    stop_gateway(project_root_path.join("cardano/gateway").as_path());

}

fn exit_with_error(message: &str) {
    logger::error(message);
    logger::log("🚨 Stopping services...");
    stop_bridge_gracefully();
    std::process::exit(1);
}

fn exit_vessel_demo_with_error(message: &str) {
    logger::error(message);
    logger::log("🚨 Stopping services...");
    stop_vessel_demo_gracefully();
    std::process::exit(1);
}

fn exit_gtw_relayer_with_error(message: &str) {
    logger::error(message);
    logger::log("🚨 Stopping services...");
    stop_gtw_relayer_demo_gracefully();
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
        Commands::Start => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            // Prepare the local Osmosis appchain
            let osmosis_dir = utils::get_osmosis_dir(project_root_path);
            logger::verbose(&format!("{}", osmosis_dir.display().to_string()));

            match prepare_osmosis(osmosis_dir.as_path()).await {
                Ok(_) => logger::log("✅ Osmosis appchain prepared"),
                Err(error) => {
                    exit_with_error(&format!("❌ Failed to prepare Osmosis appchain: {}", error))
                }
            }

            // Start the local Cardano network and its services
            match start_local_cardano_network(&project_root_path).await {
                Ok(_) => logger::log("✅ Local Cardano network has been started and prepared"),
                Err(error) => exit_with_error(&format!(
                    "❌ Failed to start local Cardano network: {}",
                    error
                )),
            }

            let mut cardano_current_epoch = 0;
            if project_config.mithril.enabled {
                // Start Mithril if needed
                match start_mithril(&project_root_path).await {
                    Ok(current_epoch) => {
                        cardano_current_epoch = current_epoch;
                        logger::log("✅ Mithril up and running")
                    }
                    Err(error) => {
                        exit_with_error(&format!("❌ Failed to start Mithril: {}", error))
                    }
                }
            }

            // Start gateway
            match start_gateway(project_root_path.join("cardano/gateway").as_path()) {
                Ok(_) => logger::log("✅ Gateway started successfully"),
                Err(error) => exit_with_error(&format!("❌ Failed to start gateway: {}", error)),
            }

            // Start the Cosmos sidechain
            match start_cosmos_sidechain(project_root_path.join("cosmos").as_path()).await {
                Ok(_) => logger::log("✅ Cosmos sidechain up and running"),
                Err(error) => {
                    exit_with_error(&format!("❌ Failed to start Cosmos sidechain: {}", error))
                }
            }

            // Start the relayer
            match start_relayer(
                project_root_path.join("relayer").as_path(),
                project_root_path.join("relayer/.env.example").as_path(),
                project_root_path.join("relayer/examples").as_path(),
                project_root_path.join("cardano/deployments/handler.json").as_path()) {
                Ok(_) => logger::log("✅ Relayer started successfully"),
                Err(error) => exit_with_error(&format!("❌ Failed to start relayer: {}", error)),
            }

            // Start Osmosis
            match start_osmosis(osmosis_dir.as_path()).await {
                Ok(_) => logger::log("✅ Osmosis appchain is up and running"),
                Err(error) => exit_with_error(&format!("❌ Failed to start Osmosis: {}", error)),
            };

            // Configure Hermes and build channels between Osmosis with Cosmos
            match configure_hermes(osmosis_dir.as_path()) {
                Ok(_) => logger::log("✅ Hermes configured successfully and channels built"),
                Err(error) => exit_with_error(&format!("❌ Failed to configure Hermes: {}", error)),
            }

            if project_config.mithril.enabled {
                // Wait for Mithril to start reading the immutable cardano node files
                match wait_and_start_mithril_genesis(&project_root_path, cardano_current_epoch).await {
                    Ok(_) => logger::log("✅ Immutable Cardano node files have been created, and Mithril is working as expected"),
                    Err(error) => {
                        exit_with_error(&format!("❌ Mithril failed to read the immutable cardano node files: {}", error))
                }
            }
            }
            logger::log("\n✅ Bridge started successfully");
        }
        Commands::Stop => {
            stop_bridge_gracefully();
            logger::log("\n❎ Bridge stopped successfully");
        }
        Commands::Demo => logger::log("Demo"),
        Commands::VesselDemo => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);

            // Start the local Cardano network and its services
            // match start_local_cardano_network(&project_root_path).await {
            //     Ok(_) => logger::log("✅ Local Cardano network has been started and prepared"),
            //     Err(error) => exit_vessel_demo_with_error(&format!(
            //         "❌ Failed to start local Cardano network: {}",
            //         error
            //     )),
            // }

            // Start the local Cardano network and its services
            match deploy_contracts(&project_root_path).await {
                Ok(_) => logger::log("✅ Deployed contracts"),
                Err(error) => logger::error(&format!("❌ Failed deploy contracts: {}", error)),
            }


            let mut cardano_current_epoch = 0;

            if project_config.mithril.enabled {
                // Start Mithril if needed
                match start_mithril(&project_root_path).await {
                    Ok(current_epoch) => {
                        cardano_current_epoch = current_epoch;
                        logger::log("✅ Mithril up and running")
                    }
                    Err(error) => {
                        exit_vessel_demo_with_error(&format!("❌ Failed to start Mithril: {}", error))
                    }
                }
            }

            // Start the Cosmos sidechain
            let cosmos_chain_repo_url = format!("{}/archive/refs/heads/{}.zip", project_config.vessel_oracle.repo_base_url, project_config.vessel_oracle.target_branch);
            let chain_root_path = project_root_path.join("chains/summit-demo/");
            match start_cosmos_sidechain_from_repository(
                &cosmos_chain_repo_url,
                chain_root_path.as_path()).await {
                Ok(_) => logger::log("✅ Cosmos sidechain up and running"),
                Err(error) => {
                    exit_vessel_demo_with_error(&format!("❌ Failed to start Cosmos sidechain: {}", error))
                }
            }

            if project_config.mithril.enabled {
                // Wait for Mithril to start reading the immutable cardano node files
                match wait_and_start_mithril_genesis(&project_root_path, cardano_current_epoch).await {
                    Ok(_) => logger::log("✅ Immutable Cardano node files have been created, and Mithril is working as expected"),
                    Err(error) => {
                        exit_vessel_demo_with_error(&format!("❌ Mithril failed to read the immutable cardano node files: {}", error))
                }
            }
            }

            logger::log("\n✅ Vessel Oracle demo started successfully");
        }
        Commands::StopVesselDemo => {
            stop_vessel_demo_gracefully();
            logger::log("\n❎ Bridge stopped successfully");
        }
        Commands::RelayerStart => {
            let project_config = config::get_config();
            let project_root_path = Path::new(&project_config.project_root);
            let chain_root_path = project_root_path.join("chains/summit-demo/");
            let mut cardano_current_epoch = 0;

            // Start gateway
            match start_gateway(project_root_path.join("cardano/gateway").as_path()) {
                Ok(_) => logger::log("✅ Gateway started successfully"),
                Err(error) => exit_gtw_relayer_with_error(&format!("❌ Failed to start gateway: {}", error)),
            }


            // Start the relayer
            match start_relayer(
                project_root_path.join("relayer").as_path(),
                chain_root_path.join("relayer/.env.relayer").as_path(),
                chain_root_path.join("relayer/config").as_path(),
                project_root_path.join("cardano/offchain/deployments/handler.json").as_path()) {
                Ok(_) => logger::log("✅ Relayer started successfully"),
                Err(error) => exit_gtw_relayer_with_error(&format!("❌ Failed to start relayer: {}", error)),
            }

            logger::log("\n✅ Vessel Oracle demo started successfully");
        }
        
    }
}
