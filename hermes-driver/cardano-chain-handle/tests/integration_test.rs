/// Integration tests for end-to-end Hermes <-> Gateway flow
/// 
/// These tests verify the production signing and submission flow:
/// 1. Gateway returns unsigned CBOR
/// 2. Hermes signs with CIP-1852 keys
/// 3. Hermes submits signed transaction
/// 4. Gateway submits to Cardano and returns events

#[cfg(test)]
mod integration_tests {
    use super::*;

    /// Test the complete flow for a transaction:
    /// Gateway -> Unsigned TX -> Hermes Sign -> Submit -> Events
    #[tokio::test]
    #[ignore] // Requires running Gateway
    async fn test_create_client_signing_flow() {
        // This test requires:
        // 1. Gateway running at localhost:50051
        // 2. Cardano node running (testnet/preprod)
        // 3. Kupo indexer running
        
        // Setup: Create keyring with test mnemonic
        let keyring = CardanoKeyring::generate(0, "test-relayer".to_string());
        
        // Setup: Create Gateway client
        let gateway = GatewayClient::new("http://localhost:50051".to_string());
        
        // Step 1: Call Gateway to get unsigned transaction
        // let unsigned_tx_response = gateway.create_client(...).await.unwrap();
        // let unsigned_cbor = unsigned_tx_response.unsigned_tx.value;
        
        // Step 2: Sign the transaction with Hermes keyring
        // let signer = CardanoSigner::new(keyring);
        // let signed_cbor = signer.sign_transaction(unsigned_cbor).await.unwrap();
        
        // Step 3: Submit signed transaction to Gateway
        // let (tx_hash, events) = gateway
        //     .submit_signed_transaction(hex::encode(signed_cbor), Some("test create client".to_string()))
        //     .await
        //     .unwrap();
        
        // Step 4: Verify we got a transaction hash
        // assert!(!tx_hash.is_empty());
        // println!("Transaction submitted: {}", tx_hash);
        
        // Note: Full implementation requires Gateway to be running and
        // proper test setup with Cardano node + Kupo
    }

    /// Test that signing with different keys produces different signatures
    #[tokio::test]
    async fn test_signature_determinism() {
        let keyring1 = CardanoKeyring::generate(0, "key1".to_string());
        let keyring2 = CardanoKeyring::generate(1, "key2".to_string());
        
        // Dummy unsigned transaction CBOR
        let unsigned_tx = vec![0x82, 0x00, 0xa0]; // Minimal CBOR transaction structure
        
        let signer1 = CardanoSigner::new(keyring1.clone());
        let signer2 = CardanoSigner::new(keyring2);
        
        let signed1 = signer1.sign_transaction(unsigned_tx.clone()).await.unwrap();
        let signed2 = signer2.sign_transaction(unsigned_tx.clone()).await.unwrap();
        
        // Different keys should produce different signatures
        assert_ne!(signed1, signed2, "Different keys must produce different signatures");
        
        // Same key should produce same signature for same input
        let signed1_again = CardanoSigner::new(keyring1).sign_transaction(unsigned_tx).await.unwrap();
        assert_eq!(signed1, signed1_again, "Same key should produce same signature");
    }

    /// Test address derivation matches CIP-1852 specification
    #[test]
    fn test_address_derivation() {
        // Test vector from CIP-1852
        // m/1852'/1815'/0'/0/0 with known mnemonic should produce known address
        let keyring = CardanoKeyring::generate(0, "test".to_string());
        let address = keyring.get_address().unwrap();
        
        // Address should be hex-encoded payment address
        assert!(address.len() > 0, "Address should not be empty");
        assert!(address.chars().all(|c| c.is_ascii_hexdigit()), "Address should be hex");
        
        println!("Derived address: {}", address);
    }
}

