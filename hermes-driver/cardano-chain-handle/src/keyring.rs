use bip39::{Mnemonic, Language};
use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::{Error, Result};

/// CardanoKeyring manages Cardano keys using CIP-1852 derivation
/// 
/// CIP-1852 derivation path: m/1852'/1815'/account'/role/index
/// - 1852: CIP-1852 standard
/// - 1815: Cardano coin type (year Ada Lovelace was born)
/// - account: Account index (usually 0)
/// - role: 0 = external (receiving), 2 = staking/external chain operations
/// - index: Address index
#[derive(Clone, Serialize, Deserialize)]
pub struct CardanoKeyring {
    /// The mnemonic phrase (12 or 24 words)
    mnemonic: String,
    
    /// Account index for CIP-1852 derivation
    account: u32,
    
    /// Key name/identifier
    key_name: String,
}

impl CardanoKeyring {
    /// Create a new keyring from a mnemonic
    pub fn from_mnemonic(mnemonic: String, account: u32, key_name: String) -> Result<Self> {
        // Validate mnemonic
        Mnemonic::from_phrase(&mnemonic, Language::English)
            .map_err(|e| Error::KeyDerivation(format!("Invalid mnemonic: {}", e)))?;

        Ok(Self {
            mnemonic,
            account,
            key_name,
        })
    }

    /// Generate a new random keyring
    pub fn generate(account: u32, key_name: String) -> Result<Self> {
        let mnemonic = Mnemonic::new(bip39::MnemonicType::Words24, Language::English);
        
        Ok(Self {
            mnemonic: mnemonic.phrase().to_string(),
            account,
            key_name,
        })
    }

    /// Load keyring from file (compatible with Hermes keyring storage)
    pub fn load_from_file(path: PathBuf) -> Result<Self> {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| Error::Io(e))?;
        
        let keyring: CardanoKeyring = serde_json::from_str(&content)
            .map_err(|e| Error::Json(e))?;
        
        Ok(keyring)
    }

    /// Save keyring to file (compatible with Hermes keyring storage)
    pub fn save_to_file(&self, path: PathBuf) -> Result<()> {
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| Error::Json(e))?;
        
        std::fs::write(path, content)
            .map_err(|e| Error::Io(e))?;
        
        Ok(())
    }

    /// Derive a payment key using CIP-1852
    /// Path: m/1852'/1815'/account'/2/0
    /// Role 2 is used for external chain operations (IBC)
    pub fn derive_payment_key(&self) -> Result<SigningKey> {
        // TODO: Implement full BIP32/CIP-1852 derivation
        // Requires: slip10, bip32, or cardano-serialization-lib crate
        Err(Error::KeyDerivation(
            "CIP-1852 derivation not yet implemented - requires BIP32 library".to_string()
        ))
    }

    /// Get the public key for verification
    pub fn get_public_key(&self) -> Result<VerifyingKey> {
        let signing_key = self.derive_payment_key()?;
        Ok(signing_key.verifying_key())
    }

    /// Get the Cardano address derived from the payment key
    pub fn get_address(&self) -> Result<String> {
        // TODO: Implement Cardano address encoding (Bech32)
        // Address = payment credential + network tag
        Err(Error::KeyDerivation(
            "Address derivation not yet implemented".to_string()
        ))
    }

    /// Get the key name
    pub fn key_name(&self) -> &str {
        &self.key_name
    }

    /// Create a keyring for testing (insecure, deterministic)
    #[cfg(test)]
    pub fn new_for_testing() -> Self {
        Self {
            mnemonic: "test test test test test test test test test test test junk".to_string(),
            account: 0,
            key_name: "test-key".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyring_creation() {
        let keyring = CardanoKeyring::generate(0, "test-key".to_string());
        assert!(keyring.is_ok());
    }

    #[test]
    fn test_keyring_from_mnemonic() {
        // Valid 24-word test mnemonic
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        );
        
        assert!(keyring.is_ok());
    }

    #[test]
    fn test_invalid_mnemonic() {
        let keyring = CardanoKeyring::from_mnemonic(
            "invalid mnemonic phrase".to_string(),
            0,
            "test-key".to_string()
        );
        
        assert!(keyring.is_err());
    }

    #[test]
    fn test_keyring_serialization() {
        let keyring = CardanoKeyring::new_for_testing();
        
        let json = serde_json::to_string(&keyring);
        assert!(json.is_ok());
        
        let deserialized: Result<CardanoKeyring, _> = serde_json::from_str(&json.unwrap());
        assert!(deserialized.is_ok());
    }
}

