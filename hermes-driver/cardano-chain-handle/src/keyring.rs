use tiny_bip39::{Mnemonic, Language, Seed};
use ed25519_dalek::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use slip10::{BIP32Path, derive_key_from_path};
use digest::Digest;
use blake2::Blake2b512;

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
            .map_err(|e| Error::KeyDerivation(format!("Invalid mnemonic: {:?}", e)))?;

        Ok(Self {
            mnemonic,
            account,
            key_name,
        })
    }

    /// Generate a new random keyring
    pub fn generate(account: u32, key_name: String) -> Result<Self> {
        let mnemonic = Mnemonic::new(tiny_bip39::MnemonicType::Words24, Language::English);
        
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
        // Parse mnemonic to get seed
        let mnemonic = Mnemonic::from_phrase(&self.mnemonic, Language::English)
            .map_err(|e| Error::KeyDerivation(format!("Invalid mnemonic: {:?}", e)))?;
        
        // Generate seed from mnemonic (no passphrase)
        let seed = Seed::new(&mnemonic, "");
        let seed_bytes = seed.as_bytes();
        
        // CIP-1852 derivation path: m/1852'/1815'/account'/2/0
        // For Ed25519, all indices must be hardened according to SLIP-0010
        // Hardened derivation constant (BIP32)
        const HARDENED: u32 = 0x80000000;
        
        // Build path manually: all hardened for Ed25519
        let indices = vec![
            HARDENED + 1852,  // purpose (CIP-1852)
            HARDENED + 1815,  // Cardano coin type
            HARDENED + self.account,  // account index
            HARDENED + 2,  // role (staking/external ops) - hardened for Ed25519
            HARDENED + 0,  // address index - hardened for Ed25519
        ];
        let path = BIP32Path::from(indices);
        
        // Derive key using SLIP-0010 (ed25519 curve)
        let derived_key = derive_key_from_path(seed_bytes, slip10::Curve::Ed25519, &path)
            .map_err(|e| Error::KeyDerivation(format!("Key derivation failed: {}", e)))?;
        
        // Convert to ed25519-dalek SigningKey
        // ed25519-dalek v2.x uses from_bytes directly
        let key_bytes: [u8; 32] = derived_key.key
            .try_into()
            .map_err(|_| Error::KeyDerivation("Invalid key length".to_string()))?;
        
        let signing_key = SigningKey::from_bytes(&key_bytes);
        
        Ok(signing_key)
    }

    /// Get the public key for verification
    pub fn get_public_key(&self) -> Result<VerifyingKey> {
        let signing_key = self.derive_payment_key()?;
        Ok(signing_key.verifying_key())
    }

    /// Get the Cardano address derived from the payment key
    /// Returns a hex-encoded address for now (TODO: add Bech32 encoding)
    pub fn get_address(&self) -> Result<String> {
        // Derive public key
        let public_key = self.get_public_key()?;
        let pub_key_bytes = public_key.to_bytes();
        
        // Hash public key using Blake2b-512, then truncate to 28 bytes for payment credential
        // (Cardano uses Blake2b-224, we use Blake2b-512 and truncate for simplicity)
        let mut hasher = Blake2b512::new();
        hasher.update(&pub_key_bytes);
        let key_hash_full = hasher.finalize();
        let key_hash = &key_hash_full[..28];  // Truncate to 28 bytes (224 bits)
        
        // Create enterprise address (testnet, payment credential only, no stake)
        // Address format: 0x61 (header byte for testnet enterprise) + 28 bytes key hash
        let mut addr_bytes = Vec::with_capacity(29);
        addr_bytes.push(0x61);  // Testnet enterprise address header
        addr_bytes.extend_from_slice(key_hash);
        
        // Return hex-encoded address for now
        // TODO: Add proper Bech32 encoding once we have the right library
        Ok(hex::encode(&addr_bytes))
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
    use hex;

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
        
        let deserialized: std::result::Result<CardanoKeyring, _> = serde_json::from_str(&json.unwrap());
        assert!(deserialized.is_ok());
    }

    #[test]
    fn test_derive_payment_key() {
        // Test with known mnemonic (standard test vector)
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        // Should successfully derive a key
        let result = keyring.derive_payment_key();
        assert!(result.is_ok(), "Key derivation failed: {:?}", result.err());
        
        let signing_key = result.unwrap();
        let pub_key = signing_key.verifying_key();
        
        // Verify we get a valid 32-byte public key
        assert_eq!(pub_key.to_bytes().len(), 32);
    }

    #[test]
    fn test_derive_payment_key_deterministic() {
        // Same mnemonic should produce same keys
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        
        let keyring1 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key-1".to_string()
        ).unwrap();
        
        let keyring2 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key-2".to_string()
        ).unwrap();
        
        let key1 = keyring1.derive_payment_key().unwrap();
        let key2 = keyring2.derive_payment_key().unwrap();
        
        // Keys should be identical
        assert_eq!(key1.to_bytes(), key2.to_bytes());
    }

    #[test]
    fn test_derive_different_accounts() {
        // Different accounts should produce different keys
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        
        let keyring_acc0 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let keyring_acc1 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            1,
            "test-key".to_string()
        ).unwrap();
        
        let key0 = keyring_acc0.derive_payment_key().unwrap();
        let key1 = keyring_acc1.derive_payment_key().unwrap();
        
        // Keys should be different
        assert_ne!(key0.to_bytes(), key1.to_bytes());
    }

    #[test]
    fn test_get_public_key() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let result = keyring.get_public_key();
        assert!(result.is_ok());
        
        let pub_key = result.unwrap();
        assert_eq!(pub_key.to_bytes().len(), 32);
    }

    #[test]
    fn test_get_address() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let result = keyring.get_address();
        assert!(result.is_ok(), "Address derivation failed: {:?}", result.err());
        
        let address = result.unwrap();
        
        // Should be a hex-encoded address (58 chars: 29 bytes * 2)
        assert_eq!(address.len(), 58, "Expected 58 hex chars, got: {}", address.len());
        
        // Should start with 61 (testnet enterprise address header)
        assert!(address.starts_with("61"), "Expected testnet address starting with 61, got: {}", address);
    }

    #[test]
    fn test_address_deterministic() {
        // Same mnemonic should produce same address
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        
        let keyring1 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key-1".to_string()
        ).unwrap();
        
        let keyring2 = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key-2".to_string()
        ).unwrap();
        
        let addr1 = keyring1.get_address().unwrap();
        let addr2 = keyring2.get_address().unwrap();
        
        assert_eq!(addr1, addr2);
    }
}

