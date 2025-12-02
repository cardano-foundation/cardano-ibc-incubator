// Cardano IBC Relayer - Standalone Binary
//
// This binary demonstrates using CardanoChainHandle directly
// for IBC operations without requiring a full Hermes fork.
//
// Usage:
//   cargo run -- --config config.toml query clients
//   cargo run -- --config config.toml query connections
//   cargo run -- --config config.toml query channels

use cardano_chain_handle::{
    CardanoChainHandle, CardanoKeyring, 
    config::CardanoChainConfig,
    Result, Error,
};
use ibc_relayer_types::core::ics24_host::identifier::ChainId;
use std::path::PathBuf;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cardano-ibc")]
#[command(about = "Cardano IBC Relayer CLI", long_about = None)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, default_value = "config.toml")]
    config: PathBuf,
    
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Query IBC state on Cardano
    Query {
        #[command(subcommand)]
        query_type: QueryType,
    },
    /// Key management
    Keys {
        #[command(subcommand)]
        keys_cmd: KeysCommand,
    },
    /// Health check
    Health,
}

#[derive(Subcommand)]
enum QueryType {
    /// Query all IBC clients
    Clients,
    /// Query all connections
    Connections,
    /// Query all channels  
    Channels,
    /// Query latest height
    Height,
}

#[derive(Subcommand)]
enum KeysCommand {
    /// Generate a new key
    Generate {
        #[arg(short, long)]
        name: String,
    },
    /// Show key address
    Show {
        #[arg(short, long)]
        name: String,
    },
    /// List all keys
    List,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    let cli = Cli::parse();
    
    // Load configuration
    let config_str = std::fs::read_to_string(&cli.config)
        .map_err(|e| Error::Config(format!("Failed to read config: {}", e)))?;
    let config: CardanoChainConfig = toml::from_str(&config_str)
        .map_err(|e| Error::Config(format!("Failed to parse config: {}", e)))?;
    
    match cli.command {
        Commands::Query { query_type } => {
            // Create chain handle
            let keyring = load_or_create_keyring(&config)?;
            let chain_id = ChainId::new(config.id.clone(), 0);
            let handle = CardanoChainHandle::new(chain_id, config.gateway_url.clone(), keyring)?;
            
            match query_type {
                QueryType::Clients => {
                    let clients = handle.query_clients().await?;
                    println!("IBC Clients on Cardano:");
                    for client in clients {
                        println!("  - {}", client);
                    }
                }
                QueryType::Connections => {
                    let connections = handle.query_connections().await?;
                    println!("IBC Connections on Cardano:");
                    for conn in connections {
                        println!("  - {}", conn);
                    }
                }
                QueryType::Channels => {
                    let channels = handle.query_channels().await?;
                    println!("IBC Channels on Cardano:");
                    for ch in channels {
                        println!("  - {}", ch);
                    }
                }
                QueryType::Height => {
                    let height = handle.query_latest_height().await?;
                    println!("Latest Cardano height: {}", height);
                }
            }
        }
        Commands::Keys { keys_cmd } => {
            match keys_cmd {
                KeysCommand::Generate { name } => {
                    let keyring = CardanoKeyring::generate(config.account_index, name.clone())?;
                    let path = key_path(&config, &name);
                    keyring.save_to_file(path.clone())?;
                    println!("Generated key '{}' at {:?}", name, path);
                    println!("Address: {}", keyring.get_address()?);
                }
                KeysCommand::Show { name } => {
                    let path = key_path(&config, &name);
                    let keyring = CardanoKeyring::load_from_file(path)?;
                    println!("Key: {}", name);
                    println!("Address: {}", keyring.get_address()?);
                }
                KeysCommand::List => {
                    let dir = config.key_store_path.clone().unwrap_or_else(|| ".keys".to_string());
                    println!("Keys in {}:", dir);
                    if let Ok(entries) = std::fs::read_dir(&dir) {
                        for entry in entries.flatten() {
                            if let Some(name) = entry.file_name().to_str() {
                                if name.ends_with(".json") {
                                    println!("  - {}", name.trim_end_matches(".json"));
                                }
                            }
                        }
                    }
                }
            }
        }
        Commands::Health => {
            let keyring = load_or_create_keyring(&config)?;
            let chain_id = ChainId::new(config.id.clone(), 0);
            let handle = CardanoChainHandle::new(chain_id, config.gateway_url.clone(), keyring)?;
            
            match handle.health_check().await {
                Ok(()) => println!("✅ Gateway connection healthy"),
                Err(e) => println!("❌ Health check failed: {}", e),
            }
        }
    }
    
    Ok(())
}

fn load_or_create_keyring(config: &CardanoChainConfig) -> Result<CardanoKeyring> {
    let path = key_path(config, &config.key_name);
    
    if path.exists() {
        CardanoKeyring::load_from_file(path)
    } else {
        // Generate a new keyring for development
        // In production, this should fail and require explicit key generation
        eprintln!("⚠️  No key found, generating new development key...");
        let keyring = CardanoKeyring::generate(config.account_index, config.key_name.clone())?;
        
        // Ensure key directory exists
        let dir = config.key_store_path.clone().unwrap_or_else(|| ".keys".to_string());
        std::fs::create_dir_all(&dir).ok();
        
        keyring.save_to_file(path)?;
        Ok(keyring)
    }
}

fn key_path(config: &CardanoChainConfig, name: &str) -> PathBuf {
    let dir = config.key_store_path.clone().unwrap_or_else(|| ".keys".to_string());
    PathBuf::from(dir).join(format!("{}.json", name))
}

