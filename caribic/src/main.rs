use std::path::Path;

use check::check_project_root;
use clap::Parser;
use clap::Subcommand;
use start::{start_local_cardano_network, start_osmosis};
mod check;
mod config;
mod logger;
mod setup;
mod start;
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
    Stop,
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
            let mut project_root_dir = match project_root {
                Some(dir) => dir,
                None => ".".to_string(),
            };

            if project_root_dir.starts_with(".") {
                project_root_dir = std::env::current_dir()
                    .unwrap_or_else(|err| {
                        logger::log(&format!("Failed to get current directory: {}", err));
                        panic!("Failed to get current directory: {}", err);
                    })
                    .join(project_root_dir)
                    .to_str()
                    .unwrap()
                    .to_string();
            }

            let project_root_path = Path::new(project_root_dir.as_str());
            config::init(
                project_root_path
                    .join(args.config)
                    .to_str()
                    .unwrap_or_else(|| {
                        logger::error("Failed to get configuration file path");
                        panic!("Failed to get configuration file path");
                    }),
            );
            let configuration = config::get_config();

            if configuration.local_osmosis {
                match check_project_root(project_root_path) {
                    Ok(_) => {
                        let osmosis_dir = utils::get_osmosis_dir(project_root_path);
                        start_osmosis(osmosis_dir.as_path()).await;
                        start_local_cardano_network(project_root_path);
                    }
                    Err(_e) => {
                        logger::error(&format!(
                            "Error: Could not find the project root for 'cardano-ibc-incubator' in the directory:\n{}\n\nPlease specify the correct path using the --project-root option: \n\n\t caribic start --local-osmosis --project-root <path>\n",
                            project_root_dir
                        ));
                        return;
                    }
                }
            } else {
                logger::warn("An Osmosis remote setup is not yet supported. Use the option: \n\n\t caribic start --local-osmosis\n\n");
            }
        }
        Commands::Stop => logger::log("Stop"),
        Commands::Demo => logger::log("Demo"),
    }
}
