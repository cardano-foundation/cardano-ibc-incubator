// TODO: ChainHandle trait implementation (Phase 2 - Gateway Integration)
// 
// The ChainHandle trait requires 57 methods to be implemented.
// This is deferred to Phase 2 once the Gateway gRPC integration is complete.
// Phase 1 focuses on the core cryptography (keyring + signer).
//
// For the full ChainHandle interface specification, see:
// https://github.com/informalsystems/hermes/blob/master/crates/relayer/src/chain/handle.rs

use ibc_relayer_types::core::ics24_host::identifier::ChainId;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::Result;
use crate::gateway_client::GatewayClient;
use crate::keyring::CardanoKeyring;
use crate::signer::CardanoSigner;

/// CardanoChainHandle will implement the ChainHandle trait for Cardano
/// This is the main entry point for Hermes to interact with Cardano
/// 
/// Phase 1 (Current): Core structure and crypto components
/// Phase 2 (Next): Full ChainHandle trait implementation with Gateway integration
pub struct CardanoChainHandle {
    /// Chain identifier
    chain_id: ChainId,
    
    /// gRPC client for communicating with the Gateway
    gateway_client: Arc<GatewayClient>,
    
    /// Keyring for managing Cardano keys
    keyring: Arc<RwLock<CardanoKeyring>>,
    
    /// Transaction signer using CIP-1852 derivation
    signer: Arc<CardanoSigner>,
}

impl CardanoChainHandle {
    /// Create a new CardanoChainHandle
    pub fn new(
        chain_id: ChainId,
        gateway_url: String,
        keyring: CardanoKeyring,
    ) -> Result<Self> {
        let gateway_client = Arc::new(GatewayClient::new(gateway_url)?);
        let signer = Arc::new(CardanoSigner::new(keyring.clone())?);
        
        Ok(Self {
            chain_id,
            gateway_client,
            keyring: Arc::new(RwLock::new(keyring)),
            signer,
        })
    }

    /// Get the chain ID
    pub fn id(&self) -> &ChainId {
        &self.chain_id
    }

    /// Get a reference to the keyring
    pub fn keyring(&self) -> &Arc<RwLock<CardanoKeyring>> {
        &self.keyring
    }

    /// Get a reference to the signer
    pub fn signer(&self) -> &Arc<CardanoSigner> {
        &self.signer
    }

    /// Get a reference to the gateway client
    pub fn gateway_client(&self) -> &Arc<GatewayClient> {
        &self.gateway_client
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cardano_chain_handle_creation() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id,
            "http://localhost:3000".to_string(),
            keyring,
        );

        assert!(handle.is_ok());
    }

    #[test]
    fn test_chain_id() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id.clone(),
            "http://localhost:3000".to_string(),
            keyring,
        ).unwrap();

        assert_eq!(handle.id(), &chain_id);
    }
}

