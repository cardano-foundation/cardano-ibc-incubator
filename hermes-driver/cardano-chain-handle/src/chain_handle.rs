use async_trait::async_trait;
use ibc_relayer::chain::handle::{ChainHandle, ChainRequest, Subscription};
use ibc_relayer::chain::requests::*;
use ibc_relayer::chain::tracking::TrackedMsgs;
use ibc_relayer_types::core::ics02_client::height::Height;
use ibc_relayer_types::core::ics24_host::identifier::ChainId;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{Error, Result};
use crate::gateway_client::GatewayClient;
use crate::keyring::CardanoKeyring;
use crate::signer::CardanoSigner;

/// CardanoChainHandle implements the ChainHandle trait for Cardano
/// This is the main entry point for Hermes to interact with Cardano
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
        let gateway_client = Arc::new(GatewayClient::new(gateway_url)?);  // Arc: shared across async tasks
        let signer = Arc::new(CardanoSigner::new(keyring.clone())?);      // Arc: shared signer instance
        
        Ok(Self {
            chain_id,
            gateway_client,
            keyring: Arc::new(RwLock::new(keyring)),  // RwLock: mutable key access
            signer,
        })
    }

    /// Build an unsigned transaction via the Gateway
    async fn build_unsigned_tx(&self, msgs: &TrackedMsgs) -> Result<Vec<u8>> {
        self.gateway_client.build_transaction(msgs).await
    }

    /// Sign a transaction using Cardano keys
    async fn sign_tx(&self, unsigned_tx: Vec<u8>) -> Result<Vec<u8>> {
        self.signer.sign_transaction(unsigned_tx).await
    }

    /// Submit a signed transaction via the Gateway
    async fn submit_tx(&self, signed_tx: Vec<u8>) -> Result<String> {
        self.gateway_client.submit_transaction(signed_tx).await
    }
}

#[async_trait]
impl ChainHandle for CardanoChainHandle {
    fn id(&self) -> ChainId {
        self.chain_id.clone()
    }

    async fn query_latest_height(&self) -> Result<Height> {
        self.gateway_client
            .query_latest_height()
            .await
            .map_err(|e| Error::Gateway(e.to_string()))
    }

    async fn query_client_state(
        &self,
        request: QueryClientStateRequest,
    ) -> Result<QueryClientStateResponse> {
        self.gateway_client
            .query_client_state(request)
            .await
            .map_err(|e| Error::Gateway(e.to_string()))
    }

    async fn send_messages_and_wait_commit(
        &self,
        tracked_msgs: TrackedMsgs,
    ) -> Result<Vec<ibc_relayer_types::events::IbcEvent>> {
        // 1. Build unsigned transaction via Gateway
        let unsigned_tx = self.build_unsigned_tx(&tracked_msgs).await?;

        // 2. Sign transaction with Cardano keys
        let signed_tx = self.sign_tx(unsigned_tx).await?;

        // 3. Submit signed transaction via Gateway
        let tx_hash = self.submit_tx(signed_tx).await?;

        // 4. Wait for confirmation and extract events
        let events = self.gateway_client.wait_for_tx_events(&tx_hash).await?;

        Ok(events)
    }

    // Additional ChainHandle methods will be implemented as needed
    // For now, we provide stub implementations that return errors
    
    async fn subscribe(&self) -> Result<Subscription> {
        Err(Error::Unknown("Subscription not yet implemented".to_string()))
    }

    async fn shutdown(&self) -> Result<()> {
        tracing::info!("Shutting down CardanoChainHandle for {}", self.chain_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cardano_chain_handle_creation() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id,
            "http://localhost:3000".to_string(),
            keyring,
        );

        assert!(handle.is_ok());
    }

    #[tokio::test]
    async fn test_chain_id() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id.clone(),
            "http://localhost:3000".to_string(),
            keyring,
        ).unwrap();

        assert_eq!(handle.id(), chain_id);
    }
}

