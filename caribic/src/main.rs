use clap::Parser;
use clap::Subcommand;
mod check;
mod setup;
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

    match args.command {
        Commands::Check => check::check_prerequisites().await,
        Commands::Start => println!("Start"),
        Commands::Stop => println!("Stop"),
        Commands::Demo => println!("Demo"),
    }
}
