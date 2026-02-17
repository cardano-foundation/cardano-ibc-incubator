use std::path::Path;
use std::path::PathBuf;

use crate::utils::default_config_path;
use clap::Parser;
use clap::Subcommand;

mod chains;
mod check;
mod commands;
mod config;
mod logger;
mod setup;
mod start;
mod stop;
mod test;
mod utils;

#[derive(clap::ValueEnum, Clone, Debug, PartialEq)]
enum DemoType {
    /// Starts the message-exchange demo preset
    MessageExchange,
    /// Starts the token-swap demo preset using a running bridge and osmosis setup
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
    /// Verbosity level (0 = quiet, 1 = standard, 2 = warning, 3 = error, 4 = info, 5 = verbose)
    #[arg(long, default_value_t = 1)]
    verbose: usize,
    /// Path to the Caribic config file (defaults to ~/.caribic/config.json)
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
        /// Optional network profile for optional chain targets (for example: local, testnet)
        #[arg(long)]
        network: Option<String>,
        /// Chain-specific KEY=VALUE flag (repeatable), only for optional chain targets
        #[arg(long = "chain-flag")]
        chain_flag: Vec<String>,
    },
    /// Stops bridge components. No argument stops everything; optionally specify: all, network, bridge, cosmos, osmosis, demo, gateway, relayer, mithril
    Stop {
        #[arg(value_enum)]
        target: Option<StopTarget>,
        /// Optional network profile for optional chain targets (for example: local, testnet)
        #[arg(long)]
        network: Option<String>,
        /// Chain-specific KEY=VALUE flag (repeatable), only for optional chain targets
        #[arg(long = "chain-flag")]
        chain_flag: Vec<String>,
    },
    /// List supported optional chains and their available network profiles
    Chains,
    /// Manage optional chains using chain adapters
    Chain {
        #[command(subcommand)]
        command: ChainCommand,
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
    /// Runs security and validator audits (gateway npm, caribic cargo, onchain aiken)
    Audit,
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
    /// Starts a demo preset. Usage: `caribic demo token-swap` or `caribic demo message-exchange`
    Demo {
        #[arg(value_enum)]
        use_case: DemoType,
    },
    /// Run end-to-end integration tests to verify IBC functionality
    ///
    /// Prerequisites: All services must be running. Use 'caribic start' first.
    Test {
        /// Optional test selector (examples: "9-12", "6", "5,9-12")
        #[arg(long)]
        tests: Option<String>,
    },
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

#[derive(Subcommand)]
enum ChainCommand {
    /// Start an optional chain adapter
    Start {
        /// Chain identifier (for example: osmosis)
        chain: String,
        /// Optional network profile (for example: local, testnet)
        #[arg(long)]
        network: Option<String>,
        /// Chain-specific KEY=VALUE flag (repeatable)
        #[arg(long = "chain-flag")]
        chain_flag: Vec<String>,
    },
    /// Stop an optional chain adapter
    Stop {
        /// Chain identifier (for example: osmosis)
        chain: String,
        /// Optional network profile (for example: local, testnet)
        #[arg(long)]
        network: Option<String>,
        /// Chain-specific KEY=VALUE flag (repeatable)
        #[arg(long = "chain-flag")]
        chain_flag: Vec<String>,
    },
    /// Check health for an optional chain adapter
    Health {
        /// Chain identifier (for example: osmosis)
        chain: String,
        /// Optional network profile (for example: local, testnet)
        #[arg(long)]
        network: Option<String>,
        /// Chain-specific KEY=VALUE flag (repeatable)
        #[arg(long = "chain-flag")]
        chain_flag: Vec<String>,
    },
}

#[tokio::main]
async fn main() {
    // Parse CLI arguments first so log/config setup can follow user-selected options.
    let args = Args::parse();

    // Show the banner only for startup flows to keep other commands quiet and script-friendly.
    if matches!(args.command, Commands::Start { .. }) {
        utils::print_header();
    }

    // Initialize logger before any config work so setup errors are visible immediately.
    logger::init(args.verbose);

    // Load config from the selected path or create defaults if missing.
    config::init(args.config.to_str().unwrap_or_else(|| {
        logger::error("Failed to get configuration file path");
        panic!("Failed to get configuration file path");
    }))
    .await;

    // Resolve the workspace root once and pass it to command handlers that need filesystem access.
    let project_config = config::get_config();
    let project_root_path = Path::new(&project_config.project_root);

    // Dispatch each subcommand to its module-level handler.
    let command_result: Result<(), String> = match args.command {
        Commands::Check => commands::run_check().await,
        Commands::Chains => commands::run_chains(),
        Commands::Chain { command } => commands::run_chain(project_root_path, command).await,
        Commands::Demo { use_case } => commands::run_demo(use_case, project_root_path).await,
        Commands::Stop {
            target,
            network,
            chain_flag,
        } => commands::run_stop(target, network, chain_flag),
        Commands::Start {
            target,
            clean,
            with_mithril,
            network,
            chain_flag,
        } => commands::run_start(target, clean, with_mithril, network, chain_flag).await,
        Commands::Keys { command } => commands::run_keys(project_root_path, command),
        Commands::HealthCheck { service } => {
            commands::run_health_check(project_root_path, service.as_deref())
        }
        Commands::Audit => commands::run_audit(project_root_path),
        Commands::CreateClient {
            host_chain,
            reference_chain,
        } => commands::run_create_client(project_root_path, &host_chain, &reference_chain),
        Commands::CreateConnection { a_chain, b_chain } => {
            commands::run_create_connection(project_root_path, &a_chain, &b_chain)
        }
        Commands::CreateChannel {
            a_chain,
            b_chain,
            a_port,
            b_port,
        } => commands::run_create_channel(project_root_path, &a_chain, &b_chain, &a_port, &b_port),
        Commands::Test { tests } => {
            let test_result = commands::run_tests(project_root_path, tests.as_deref()).await;
            match test_result {
                Ok(_) => Ok(()),
                Err(error) => {
                    logger::error(&format!("Integration tests failed: {}", error));
                    Err(error)
                }
            }
        }
    };

    // Standardized non-zero exit on command failure.
    if let Err(error) = command_result {
        logger::error(&error);
        std::process::exit(1);
    }
}
