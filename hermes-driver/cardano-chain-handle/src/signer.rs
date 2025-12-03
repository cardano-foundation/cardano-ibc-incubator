use ed25519_dalek::{Signature, Signer as Ed25519Signer, SigningKey};
use digest::Digest;
use blake2::{Blake2b, digest::consts::U32};
use pallas_codec::{minicbor, utils::Bytes};
use pallas_primitives::babbage::{MintedTx, MintedWitnessSet, VKeyWitness};

use crate::error::{Error, Result};
use crate::keyring::CardanoKeyring;

/// CardanoSigner handles transaction signing using Ed25519
/// 
/// Cardano transactions are signed using Ed25519 keys derived via CIP-1852
/// The signing process:
/// 1. Extract transaction body hash from unsigned CBOR
/// 2. Sign the hash with the derived Ed25519 key
/// 3. Attach witness to the transaction witness set
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
    /// Input: Unsigned transaction CBOR bytes (from Gateway)
    /// Output: Signed transaction CBOR bytes (ready for submission)
    pub async fn sign_transaction(&self, unsigned_tx: Vec<u8>) -> Result<Vec<u8>> {
        // 1. Parse unsigned transaction and extract body hash
        let tx_hash = self.extract_transaction_hash(&unsigned_tx)?;

        // 2. Derive signing key
        let signing_key = self.keyring.derive_payment_key()?;

        // 3. Sign transaction hash
        let signature = self.sign_tx_hash(&tx_hash, &signing_key)?;

        // 4. Attach witness and serialize
        let signed_tx = self.attach_witness(unsigned_tx, signature)?;

        Ok(signed_tx)
    }

    /// Extract the transaction body hash that needs to be signed
    /// Cardano tx hash = blake2b_256(tx_body_cbor)
    fn extract_transaction_hash(&self, cbor: &[u8]) -> Result<[u8; 32]> {
        // Parse transaction using Pallas
        let tx: MintedTx = minicbor::decode(cbor)
            .map_err(|e| Error::Signing(format!("Failed to parse transaction CBOR: {:?}", e)))?;
        
        // Get the raw CBOR bytes of the transaction body
        // Pallas KeepRaw preserves original CBOR for exactly this purpose
        let body_cbor = tx.transaction_body.raw_cbor();
        
        // Hash the transaction body using Blake2b-256
        type Blake2b256 = Blake2b<U32>;
        let mut hasher = Blake2b256::new();
        hasher.update(body_cbor);
        let hash = hasher.finalize();
        
        // Convert to fixed array
        let hash_array: [u8; 32] = hash.into();
        
        Ok(hash_array)
    }

    /// Sign the transaction hash using Ed25519
    fn sign_tx_hash(&self, tx_hash: &[u8; 32], key: &SigningKey) -> Result<Signature> {
        key.try_sign(tx_hash)
            .map_err(|e| Error::Signing(format!("Ed25519 signing failed: {}", e)))
    }

    /// Attach the witness (signature + public key) to the transaction
    /// Reconstructs the transaction with the new witness in the witness set
    fn attach_witness(&self, unsigned_tx: Vec<u8>, signature: Signature) -> Result<Vec<u8>> {
        // Parse unsigned transaction
        let tx: MintedTx = minicbor::decode(&unsigned_tx)
            .map_err(|e| Error::Signing(format!("Failed to parse unsigned transaction: {:?}", e)))?;
        
        // Get the public key from keyring
        let public_key = self.keyring.get_public_key()?;
        let pub_key_bytes = public_key.to_bytes();
        
        // Create VKeyWitness (Cardano's verification key witness structure)
        let vkey_witness = VKeyWitness {
            vkey: Bytes::from(pub_key_bytes.to_vec()),
            signature: Bytes::from(signature.to_bytes().to_vec()),
        };
        
        // Get existing vkey witnesses or create new vec
        let mut vkey_witnesses = match tx.transaction_witness_set.vkeywitness.as_deref() {
            Some(existing) => existing.to_vec(),
            None => Vec::new(),
        };
        
        // Add our witness
        vkey_witnesses.push(vkey_witness);
        
        // Construct new witness set with the added witness
        let new_witness_set = MintedWitnessSet {
            vkeywitness: Some(vkey_witnesses),
            native_script: tx.transaction_witness_set.native_script.as_deref().map(|v| v.to_vec()),
            bootstrap_witness: tx.transaction_witness_set.bootstrap_witness.as_deref().map(|v| v.to_vec()),
            plutus_v1_script: tx.transaction_witness_set.plutus_v1_script.as_deref().map(|v| v.to_vec()),
            plutus_data: tx.transaction_witness_set.plutus_data.as_deref().map(|v| v.to_vec()),
            redeemer: tx.transaction_witness_set.redeemer.as_deref().map(|v| v.to_vec()),
            plutus_v2_script: tx.transaction_witness_set.plutus_v2_script.as_deref().map(|v| v.to_vec()),
        };
        
        // Construct signed transaction with new witness set
        // We use minicbor to encode and re-decode to get a fresh KeepRaw wrapper
        let mut witness_cbor = Vec::new();
        minicbor::encode(&new_witness_set, &mut witness_cbor)
            .map_err(|e| Error::Signing(format!("Failed to encode witness set: {:?}", e)))?;
        
        let wrapped_witness_set: pallas_codec::utils::KeepRaw<MintedWitnessSet> = minicbor::decode(&witness_cbor)
            .map_err(|e| Error::Signing(format!("Failed to decode witness set: {:?}", e)))?;
        
        let signed_tx = MintedTx {
            transaction_body: tx.transaction_body.clone(),
            transaction_witness_set: wrapped_witness_set,
            success: tx.success,
            auxiliary_data: tx.auxiliary_data.clone(),
        };
        
        // Serialize to CBOR
        let mut signed_cbor = Vec::new();
        minicbor::encode(&signed_tx, &mut signed_cbor)
            .map_err(|e| Error::Signing(format!("Failed to encode signed transaction: {:?}", e)))?;
        
        Ok(signed_cbor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pallas_primitives::babbage::TransactionBody;

    fn create_minimal_test_transaction() -> MintedTx<'static> {
        // Create a minimal valid Cardano Babbage-era transaction for testing
        let tx_body = TransactionBody {
            inputs: vec![],
            outputs: vec![],
            fee: 170000, // Minimum fee
            ttl: None,
            certificates: None,
            withdrawals: None,
            update: None,
            auxiliary_data_hash: None,
            validity_interval_start: None,
            mint: None,
            script_data_hash: None,
            collateral: None,
            required_signers: None,
            network_id: None,
            collateral_return: None,
            total_collateral: None,
            reference_inputs: None,
        };
        
        let witness_set = MintedWitnessSet {
            vkeywitness: None,
            native_script: None,
            bootstrap_witness: None,
            plutus_v1_script: None,
            plutus_data: None,
            redeemer: None,
            plutus_v2_script: None,
        };
        
        // Build minimal CBOR manually since KeepRaw::new() doesn't work
        // Cardano transaction is CBOR array: [body, witness_set, is_valid, auxiliary_data?]
        let mut body_cbor = Vec::new();
        minicbor::encode(&tx_body, &mut body_cbor).unwrap();
        
        let mut witness_cbor = Vec::new();
        minicbor::encode(&witness_set, &mut witness_cbor).unwrap();
        
        // Build transaction CBOR array [body, witness_set, true]
        let mut tx_cbor = Vec::new();
        let mut encoder = minicbor::Encoder::new(&mut tx_cbor);
        encoder.array(3).unwrap();
        encoder.bytes(&body_cbor).unwrap();
        encoder.bytes(&witness_cbor).unwrap();
        encoder.bool(true).unwrap();
        
        // Decode to get proper MintedTx with KeepRaw wrappers
        minicbor::decode(&tx_cbor).unwrap()
    }

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
        
        // Create test transaction
        let tx = create_minimal_test_transaction();
        let mut tx_cbor = Vec::new();
        minicbor::encode(&tx, &mut tx_cbor).unwrap();
        
        // Extract hash
        let result = signer.extract_transaction_hash(&tx_cbor);
        assert!(result.is_ok(), "Hash extraction failed: {:?}", result.err());
        
        let hash = result.unwrap();
        assert_eq!(hash.len(), 32, "Transaction hash should be 32 bytes");
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
        
        // Create test transaction
        let tx = create_minimal_test_transaction();
        let mut tx_cbor = Vec::new();
        minicbor::encode(&tx, &mut tx_cbor).unwrap();
        
        // Same transaction should produce same hash
        let hash1 = signer.extract_transaction_hash(&tx_cbor).unwrap();
        let hash2 = signer.extract_transaction_hash(&tx_cbor).unwrap();
        
        assert_eq!(hash1, hash2, "Hashing should be deterministic");
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
        
        // Create unsigned transaction
        let unsigned_tx = create_minimal_test_transaction();
        let mut unsigned_cbor = Vec::new();
        minicbor::encode(&unsigned_tx, &mut unsigned_cbor).unwrap();
        
        // Sign transaction
        let result = signer.sign_transaction(unsigned_cbor.clone()).await;
        assert!(result.is_ok(), "Signing failed: {:?}", result.err());
        
        let signed_cbor = result.unwrap();
        
        // Verify we can parse signed transaction
        let signed_tx: std::result::Result<MintedTx, _> = minicbor::decode(&signed_cbor);
        assert!(signed_tx.is_ok(), "Failed to parse signed transaction");
        
        // Verify witness set has exactly 1 vkey witness
        let signed = signed_tx.unwrap();
        let witnesses = signed.transaction_witness_set.vkeywitness.as_deref();
        assert!(witnesses.is_some(), "No vkey witnesses found");
        assert_eq!(witnesses.unwrap().len(), 1, "Expected exactly 1 witness");
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
        let unsigned_tx = create_minimal_test_transaction();
        let mut unsigned_cbor = Vec::new();
        minicbor::encode(&unsigned_tx, &mut unsigned_cbor).unwrap();
        
        // Create a test signature
        let dummy_sig = Signature::from_bytes(&[0u8; 64]);
        
        // Attach witness
        let result = signer.attach_witness(unsigned_cbor, dummy_sig);
        assert!(result.is_ok(), "Witness attachment failed: {:?}", result.err());
        
        let signed_cbor = result.unwrap();
        
        // Verify we can parse signed transaction
        let signed_tx: std::result::Result<MintedTx, _> = minicbor::decode(&signed_cbor);
        assert!(signed_tx.is_ok(), "Failed to parse signed transaction");
        
        // Verify witness set contains exactly 1 vkey
        let witnesses = signed_tx.unwrap().transaction_witness_set.vkeywitness.as_deref();
        assert!(witnesses.is_some(), "Witness set should contain vkey witnesses");
        assert_eq!(witnesses.unwrap().len(), 1, "Should have exactly 1 witness");
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
        
        // Create identical transaction
        let tx = create_minimal_test_transaction();
        let mut tx_cbor = Vec::new();
        minicbor::encode(&tx, &mut tx_cbor).unwrap();
        
        // Sign with both signers
        let signed1 = signer1.sign_transaction(tx_cbor.clone()).await.unwrap();
        let signed2 = signer2.sign_transaction(tx_cbor).await.unwrap();
        
        // Signatures should be identical (same key, same tx)
        assert_eq!(signed1, signed2, "Signatures should be deterministic");
    }
}
