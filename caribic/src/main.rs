use std::path::Path;
use std::path::PathBuf;

use clap::Parser;
use clap::Subcommand;
use start::{
    configure_hermes, prepare_osmosis, start_cosmos_sidechain, start_local_cardano_network,
    start_osmosis, start_relayer,
};
use stop::{stop_cardano_network, stop_cosmos, stop_osmosis, stop_relayer};
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
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    match args.command {
        Commands::Check => check::check_prerequisites().await,
        Commands::Start => {
            let project_root_path = Path::new(&project_config.project_root);

            // Prepare the local Osmosis appchain
            let osmosis_dir = utils::get_osmosis_dir(project_root_path);
            prepare_osmosis(osmosis_dir.as_path()).await;
            // Start the local Cardano network and its services
            start_local_cardano_network(project_root_path);
            // Start the Cosmos sidechain
            start_cosmos_sidechain(project_root_path.join("cosmos").as_path()).await;
            // Start the relayer
            start_relayer(project_root_path.join("relayer").as_path())
                .expect("⚠️ Unable to prepare relayer environment");
            // Start Osmosis
            start_osmosis(osmosis_dir.as_path()).await;
            // Configure Hermes and build channels between Osmosis with Cosmos
            let _ = configure_hermes(osmosis_dir.as_path());
        }
        Commands::Stop => {
            // Stop local cardano network
            stop_cardano_network(project_root_path);
            // Stop Cosmos
            stop_cosmos(project_root_path.join("cosmos").as_path());
            // Stop Relayer
            stop_relayer(project_root_path.join("relayer").as_path());
            // Stop Osmosis
            stop_osmosis(project_root_path.join("chains/osmosis/osmosis").as_path());
        }
        Commands::Demo => logger::log("Demo"),
    }
}
