// Configuration for Cardano chain in Hermes
//
// This mirrors the config format used in the Go relayer but for Rust Hermes

use serde::{Deserialize, Serialize};

/// Cardano chain configuration for Hermes
/// 
/// This goes in the Hermes config.toml under [[chains]]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CardanoChainConfig {
    /// Chain identifier (e.g., "cardano-mainnet", "cardano-preprod")
    pub id: String,
    
    /// Gateway gRPC endpoint URL
    pub gateway_url: String,
    
    /// Key name in the keyring
    pub key_name: String,
    
    /// Path to keyring storage directory
    pub key_store_path: Option<String>,
    
    /// Account index for key derivation (CIP-1852)
    #[serde(default)]
    pub account_index: u32,
    
    /// RPC timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    
    /// Whether to enable debug logging
    #[serde(default)]
    pub debug: bool,
    
    /// Mithril aggregator endpoint (optional)
    pub mithril_endpoint: Option<String>,
}

fn default_timeout() -> u64 {
    60
}

impl Default for CardanoChainConfig {
    fn default() -> Self {
        Self {
            id: "cardano".to_string(),
            gateway_url: "http://localhost:5001".to_string(),
            key_name: "cardano-key".to_string(),
            key_store_path: None,
            account_index: 0,
            timeout_secs: 60,
            debug: false,
            mithril_endpoint: None,
        }
    }
}

impl CardanoChainConfig {
    /// Create config from environment variables
    pub fn from_env() -> Self {
        Self {
            id: std::env::var("CARDANO_CHAIN_ID")
                .unwrap_or_else(|_| "cardano".to_string()),
            gateway_url: std::env::var("CARDANO_GATEWAY_URL")
                .unwrap_or_else(|_| "http://localhost:5001".to_string()),
            key_name: std::env::var("CARDANO_KEY_NAME")
                .unwrap_or_else(|_| "cardano-key".to_string()),
            key_store_path: std::env::var("CARDANO_KEY_STORE_PATH").ok(),
            account_index: std::env::var("CARDANO_ACCOUNT_INDEX")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            timeout_secs: std::env::var("CARDANO_TIMEOUT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(60),
            debug: std::env::var("CARDANO_DEBUG")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(false),
            mithril_endpoint: std::env::var("CARDANO_MITHRIL_ENDPOINT").ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = CardanoChainConfig::default();
        assert_eq!(config.id, "cardano");
        assert_eq!(config.gateway_url, "http://localhost:5001");
        assert_eq!(config.timeout_secs, 60);
    }

    #[test]
    fn test_serialize_config() {
        let config = CardanoChainConfig::default();
        let toml = toml::to_string_pretty(&config).unwrap();
        assert!(toml.contains("id = \"cardano\""));
        assert!(toml.contains("gateway_url"));
    }

    #[test]
    fn test_deserialize_config() {
        let toml = r#"
            id = "cardano-preprod"
            gateway_url = "http://192.168.1.100:5001"
            key_name = "my-key"
            account_index = 1
            timeout_secs = 120
        "#;
        
        let config: CardanoChainConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.id, "cardano-preprod");
        assert_eq!(config.gateway_url, "http://192.168.1.100:5001");
        assert_eq!(config.account_index, 1);
    }
}

