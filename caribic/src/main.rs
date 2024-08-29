use check::check_project_root;
use clap::Parser;
use clap::Subcommand;
use start::{
    configure_hermes, prepare_osmosis, start_cosmos_sidechain, start_local_cardano_network,
    start_osmosis, start_relayer,
};
use stop::{stop_cardano_network, stop_cosmos, stop_osmosis, stop_relayer};
use utils::get_project_root_path;
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
    #[arg(short, long, default_value = "caribic.config.json")]
    config: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Verifies that all the prerequisites are installed and ensures that the configuration is correctly set up
    Check,
    /// Creates a local development environment including all necessary components for a IBC connection between Cardano and Osmosis
    Start {
        /// Directory of the cardano-ibc-incubator project
        #[arg(long)]
        project_root: Option<String>,
    },
    /// Stops the local development environment
    Stop {
        /// Directory of the cardano-ibc-incubator project
        #[arg(long)]
        project_root: Option<String>,
    },
    /// Performs a token swap between Cardano and Osmosis
    Demo,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    utils::print_header();
    logger::init(args.verbose);

    match args.command {
        Commands::Check => check::check_prerequisites().await,
        Commands::Start { project_root } => {
            // Get the project root path and build or read the config file
            let project_root_path_buf = get_project_root_path(project_root);
            let project_root_path = project_root_path_buf.as_path();
            config::init(
                project_root_path
                    .join(args.config)
                    .to_str()
                    .unwrap_or_else(|| {
                        logger::error("Failed to get configuration file path");
                        panic!("Failed to get configuration file path");
                    }),
            );

            // Check if the provided project root really points to the cardano-ibc-incubator folder
            // TODO: This check could be removed in the future if we would wrap the first call to cariabic is a
            //       configuration step building a .caribic file/folder in the home directory
            match check_project_root(project_root_path) {
                Ok(_) => {
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
                Err(_e) => {
                    logger::error(&format!(
                        "Error: Could not find the project root for 'cardano-ibc-incubator' in the directory:\n{}\n\nPlease specify the correct path using the --project-root option: \n\n\t caribic start --project-root <path>\n",
                        project_root_path.display()
                    ));
                    return;
                }
            }
        }
        Commands::Stop { project_root } => {
            // Get the project root path and build or read the config file
            let project_root_path_buf = get_project_root_path(project_root);
            let project_root_path = project_root_path_buf.as_path();
            config::init(
                project_root_path
                    .join(args.config)
                    .to_str()
                    .unwrap_or_else(|| {
                        logger::error("Failed to get configuration file path");
                        panic!("Failed to get configuration file path");
                    }),
            );

            // Check if the provided project root really points to the cardano-ibc-incubator folder
            // TODO: This check could be removed in the future if we would wrap the first call to cariabic is a
            //       configuration step building a .caribic file/folder in the home directory
            match check_project_root(project_root_path) {
                Ok(_) => {
                    // Stop local cardano network
                    stop_cardano_network(project_root_path);
                    // Stop Cosmos
                    stop_cosmos(project_root_path.join("cosmos").as_path());
                    // Stop Relayer
                    stop_relayer(project_root_path.join("relayer").as_path());
                    // Stop Osmosis
                    stop_osmosis(project_root_path.join("chains/osmosis/osmosis").as_path());
                }
                Err(_e) => {
                    logger::error(&format!(
                        "Error: Could not find the project root for 'cardano-ibc-incubator' in the directory:\n{}\n\nPlease specify the correct path using the --project-root option: \n\n\t caribic stop --project-root <path>\n",
                        project_root_path.display()
                    ));
                    return;
                }
            }
        }
        Commands::Demo => logger::log("Demo"),
    }
}
