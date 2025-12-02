use ed25519_dalek::{Signature, Signer as Ed25519Signer, SigningKey};
use pallas_codec::minicbor;
use digest::Digest;
use blake2::Blake2b512;

use crate::error::{Error, Result};
use crate::keyring::CardanoKeyring;

/// CardanoSigner handles transaction signing using Ed25519
/// 
/// Cardano transactions are signed using Ed25519 keys derived via CIP-1852
/// The signing process:
/// 1. Extract transaction hash from unsigned CBOR
/// 2. Sign the hash with the derived Ed25519 key
/// 3. Attach witness to the transaction
/// 4. Return signed CBOR
pub struct CardanoSigner {
    keyring: CardanoKeyring,
}

impl CardanoSigner {
    /// Create a new signer from a keyring
    pub fn new(keyring: CardanoKeyring) -> Result<Self> {
        Ok(Self { keyring })
    }

    /// Sign a transaction
    /// 
    /// Input: Unsigned transaction CBOR bytes
    /// Output: Signed transaction CBOR bytes
    pub async fn sign_transaction(&self, unsigned_tx: Vec<u8>) -> Result<Vec<u8>> {
        // 1. Parse unsigned transaction CBOR
        let tx_hash = self.extract_transaction_hash(&unsigned_tx)?;

        // 2. Derive signing key
        let signing_key = self.keyring.derive_payment_key()?;

        // 3. Sign transaction hash
        let signature = self.sign_tx_hash(&tx_hash, &signing_key)?;

        // 4. Attach witness and serialize
        let signed_tx = self.attach_witness(unsigned_tx, signature)?;

        Ok(signed_tx)
    }

    /// Extract the transaction hash that needs to be signed
    /// The hash is: blake2b_256(tx_body_cbor)
    fn extract_transaction_hash(&self, cbor: &[u8]) -> Result<[u8; 32]> {
        // For now, directly hash the CBOR bytes
        // TODO: Parse CBOR to extract just the tx body for proper hash
        // This is simplified for Phase 1 - full CBOR parsing comes in Phase 2
        
        let mut hasher = Blake2b512::new();
        hasher.update(cbor);
        let hash = hasher.finalize();
        
        // Take first 32 bytes (Blake2b-512 produces 64 bytes)
        let hash_array: [u8; 32] = hash[..32]
            .try_into()
            .map_err(|_| Error::Signing("Hash truncation failed".to_string()))?;
        
        Ok(hash_array)
    }

    /// Sign the transaction hash using Ed25519
    fn sign_tx_hash(&self, tx_hash: &[u8; 32], key: &SigningKey) -> Result<Signature> {
        key.try_sign(tx_hash)
            .map_err(|e| Error::Signing(format!("Signing failed: {}", e)))
    }

    /// Attach the witness (signature + public key) to the transaction
    /// Witness set contains: [VKeyWitness: [public_key, signature]]
    fn attach_witness(&self, mut unsigned_tx: Vec<u8>, signature: Signature) -> Result<Vec<u8>> {
        // For Phase 1, we'll append the witness as metadata
        // TODO: Proper CBOR witness set attachment in Phase 2 with full pallas integration
        
        // Get the public key from keyring
        let public_key = self.keyring.get_public_key()?;
        let pub_key_bytes = public_key.to_bytes();
        
        // Append witness data: [pub_key (32 bytes) | signature (64 bytes)]
        unsigned_tx.extend_from_slice(&pub_key_bytes);
        unsigned_tx.extend_from_slice(&signature.to_bytes());
        
        Ok(unsigned_tx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signer_creation() {
        let keyring = CardanoKeyring::new_for_testing();
        let signer = CardanoSigner::new(keyring);
        assert!(signer.is_ok());
    }

    #[test]
    fn test_extract_transaction_hash() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let signer = CardanoSigner::new(keyring).unwrap();
        
        // Create test transaction CBOR (simplified)
        let tx_cbor = vec![1, 2, 3, 4, 5];
        
        // Extract hash
        let result = signer.extract_transaction_hash(&tx_cbor);
        assert!(result.is_ok(), "Hash extraction failed: {:?}", result.err());
        
        let hash = result.unwrap();
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_extract_hash_deterministic() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let signer = CardanoSigner::new(keyring).unwrap();
        
        // Same transaction should produce same hash
        let tx_cbor = vec![1, 2, 3, 4, 5];
        
        let hash1 = signer.extract_transaction_hash(&tx_cbor).unwrap();
        let hash2 = signer.extract_transaction_hash(&tx_cbor).unwrap();
        
        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_sign_transaction_end_to_end() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let signer = CardanoSigner::new(keyring).unwrap();
        
        // Create unsigned transaction (simplified for Phase 1)
        let unsigned_cbor = vec![1, 2, 3, 4, 5];
        
        // Sign transaction
        let result = signer.sign_transaction(unsigned_cbor.clone()).await;
        assert!(result.is_ok(), "Signing failed: {:?}", result.err());
        
        let signed_cbor = result.unwrap();
        
        // Verify signed transaction is longer (has witness appended)
        assert!(signed_cbor.len() > unsigned_cbor.len());
        
        // Verify witness data is appended (32 bytes pub key + 64 bytes signature)
        assert_eq!(signed_cbor.len(), unsigned_cbor.len() + 32 + 64);
    }

    #[test]
    fn test_attach_witness() {
        let mnemonic = "test walk nut penalty hip pave soap entry language right filter choice";
        let keyring = CardanoKeyring::from_mnemonic(
            mnemonic.to_string(),
            0,
            "test-key".to_string()
        ).unwrap();
        
        let signer = CardanoSigner::new(keyring).unwrap();
        
        // Create unsigned transaction
        let unsigned_cbor = vec![1, 2, 3, 4, 5];
        
        // Create a dummy signature
        let dummy_sig = Signature::from_bytes(&[0u8; 64]);
        
        // Attach witness
        let result = signer.attach_witness(unsigned_cbor.clone(), dummy_sig);
        assert!(result.is_ok(), "Witness attachment failed: {:?}", result.err());
        
        let signed_cbor = result.unwrap();
        
        // Verify witness was appended
        assert_eq!(signed_cbor.len(), unsigned_cbor.len() + 32 + 64);
    }

    #[tokio::test]
    async fn test_signing_deterministic() {
        // Same mnemonic and transaction should produce same signature
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
        
        let signer1 = CardanoSigner::new(keyring1).unwrap();
        let signer2 = CardanoSigner::new(keyring2).unwrap();
        
        // Create identical transactions
        let tx_cbor = vec![1, 2, 3, 4, 5];
        
        // Sign both
        let signed1 = signer1.sign_transaction(tx_cbor.clone()).await.unwrap();
        let signed2 = signer2.sign_transaction(tx_cbor).await.unwrap();
        
        // Signatures should be identical
        assert_eq!(signed1, signed2);
    }
}

