use std::path::Path;

use check::check_project_root;
use clap::Parser;
use clap::Subcommand;
use start::start_osmosis;
mod check;
mod setup;
mod start;
mod utils;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Verifies that all the prerequisites are installed and ensures that the configuration is correctly set up
    Check,
    /// Creates a local development environment including all necessary components for a IBC connection between Cardano and Osmosis
    Start {
        /// Indicates if Osmosis should run locally
        #[arg(long)]
        local_osmosis: bool,

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

    match args.command {
        Commands::Check => check::check_prerequisites().await,
        Commands::Start {
            local_osmosis,
            project_root,
        } => {
            let mut project_root_dir = match project_root {
                Some(dir) => dir,
                None => ".".to_string(),
            };

            if project_root_dir.starts_with(".") {
                project_root_dir = std::env::current_dir()
                    .expect("Failed to get current directory")
                    .join(project_root_dir)
                    .to_str()
                    .unwrap()
                    .to_string();
            }

            if local_osmosis {
                let project_root_path = Path::new(project_root_dir.as_str());
                match check_project_root(project_root_path) {
                    Ok(_) => {
                        let osmosis_dir = utils::get_osmosis_dir(project_root_path);
                        start_osmosis(osmosis_dir.as_path()).await;
                    }
                    Err(_e) => {
                        println!(
                            "Error: Could not find the project root for 'cardano-ibc-incubator' in the directory:\n{}\n\nPlease specify the correct path using the --project-root option: \n\n\t caribic start --local-osmosis --project-root <path>\n",
                            project_root_dir
                        );
                        return;
                    }
                }
            } else {
                println!("An Osmosis remote setup is not yet supported. Use the option: \n\n\t caribic start --local-osmosis\n\n");
            }
        }
        Commands::Stop => println!("Stop"),
        Commands::Demo => println!("Demo"),
    }
}
