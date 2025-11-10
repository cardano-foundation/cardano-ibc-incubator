use ed25519_dalek::{Signature, Signer as Ed25519Signer, SigningKey};

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
    fn extract_transaction_hash(&self, cbor: &[u8]) -> Result<[u8; 32]> {
        // TODO: Implement CBOR parsing to extract tx body hash
        // The hash is: blake2b_256(tx_body)
        Err(Error::Signing(
            "Transaction hash extraction not yet implemented".to_string()
        ))
    }

    /// Sign the transaction hash using Ed25519
    fn sign_tx_hash(&self, tx_hash: &[u8; 32], key: &SigningKey) -> Result<Signature> {
        key.try_sign(tx_hash)
            .map_err(|e| Error::Signing(format!("Signing failed: {}", e)))
    }

    /// Attach the witness (signature + public key) to the transaction
    fn attach_witness(&self, mut unsigned_tx: Vec<u8>, signature: Signature) -> Result<Vec<u8>> {
        // TODO: Implement CBOR serialization to attach witness set
        // Witness set contains: [VKeyWitness: [public_key, signature]]
        // Spec: https://github.com/input-output-hk/cardano-ledger-specs
        Err(Error::Signing(
            "Witness attachment not yet implemented".to_string()
        ))
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

    #[tokio::test]
    async fn test_sign_transaction_stub() {
        let keyring = CardanoKeyring::new_for_testing();
        let signer = CardanoSigner::new(keyring).unwrap();
        
        let unsigned_tx = vec![0u8; 100]; // Dummy CBOR
        let result = signer.sign_transaction(unsigned_tx).await;
        
        // Should fail with "not yet implemented" since we haven't implemented CBOR parsing
        assert!(result.is_err());
    }
}

