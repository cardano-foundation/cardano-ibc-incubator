// ChainHandle trait implementation for Cardano
// 
// This implements the 56 required methods for Hermes ChainHandle integration.
// Methods are organized by category and implemented incrementally:
//   - Phase 3a: Lifecycle & Metadata (Categories 1, 4)
//   - Phase 3b: IBC Queries (Categories 5, 6, 7)
//   - Phase 3c: Transactions & Packets (Categories 2, 10, 11)
//   - Phase 3d: Advanced features (Categories 3, 8, 9, 12, 13) - deferred/stubbed

use ibc_relayer_types::core::ics24_host::identifier::ChainId;
use ibc_relayer::chain::tracking::TrackedMsgs;
use ibc_relayer_types::core::ics02_client::height::Height;
use ibc_relayer_types::events::IbcEvent;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{Error, Result};
use crate::gateway_client::GatewayClient;
use crate::keyring::CardanoKeyring;
use crate::signer::CardanoSigner;

/// CardanoChainHandle implements the ChainHandle trait for Cardano
/// This is the main entry point for Hermes to interact with Cardano via the Gateway
#[derive(Clone)]
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

    //
    // ============================================================================
    // Category 1: Lifecycle & Basic Operations (5 methods)
    // ============================================================================
    //

    /// Get the chain ID
    pub fn id(&self) -> ChainId {
        self.chain_id.clone()
    }

    /// Shutdown and cleanup resources
    pub async fn shutdown(&self) -> Result<()> {
        // Gateway client connections are stateless (connect per-request)
        // No persistent resources to clean up
        Ok(())
    }

    /// Health check - verify Gateway connectivity and Cardano node status
    pub async fn health_check(&self) -> Result<()> {
        // Try to query latest height as a basic health check
        self.gateway_client.query_latest_height()
            .await
            .map(|_| ())
            .map_err(|e| Error::Gateway(format!("Health check failed: {}", e)))
    }

    /// Subscribe to IBC events from Cardano
    /// 
    /// Returns a channel receiver for IBC events.
    /// The Gateway should provide a streaming gRPC endpoint for real-time events.
    pub async fn subscribe(&self) -> Result<tokio::sync::mpsc::Receiver<IbcEvent>> {
        // TODO: Implement event subscription via Gateway streaming RPC
        // This requires Gateway to add a streaming endpoint that:
        // 1. Follows Cardano chain tip via N2N protocol
        // 2. Extracts IBC events from transaction datums
        // 3. Streams them back to Hermes
        Err(Error::Gateway(
            "Event subscription not yet implemented - Gateway needs streaming RPC".to_string()
        ))
    }

    //
    // ============================================================================
    // Category 2: Transaction Submission (2 methods)
    // ============================================================================
    //

    /// Submit IBC messages to Cardano and wait for block inclusion
    /// 
    /// This is the main transaction submission flow:
    /// 1. For each message, call Gateway to build unsigned tx
    /// 2. Sign the transaction with CardanoSigner
    /// 3. Submit signed tx to Gateway
    /// 4. Wait for confirmation and extract events
    pub async fn send_messages_and_wait_commit(
        &self,
        msgs: TrackedMsgs,
    ) -> Result<Vec<IbcEvent>> {
        // TODO: Implement full transaction lifecycle
        // 1. Convert TrackedMsgs to Gateway-specific message types
        // 2. Build unsigned transaction via Gateway gRPC
        // 3. Sign with self.signer
        // 4. Submit to Gateway
        // 5. Poll for confirmation
        // 6. Extract and return IBC events
        Err(Error::TxBuilder(format!(
            "Transaction submission not yet implemented (need to handle {} messages)",
            msgs.messages().len()
        )))
    }

    /// Submit messages and return immediately after mempool check
    /// 
    /// Cardano doesn't have a traditional mempool, so this is similar to
    /// send_messages_and_wait_commit but returns after tx submission.
    pub async fn send_messages_and_wait_check_tx(
        &self,
        msgs: TrackedMsgs,
    ) -> Result<Vec<IbcEvent>> {
        // For Cardano, "check_tx" means the transaction was accepted by the node
        // We still need to wait for at least one confirmation
        self.send_messages_and_wait_commit(msgs).await
    }

    //
    // ============================================================================
    // Category 3: Key Management (4 methods)
    // ============================================================================
    //

    /// Get the signer address for transactions
    pub async fn get_signer(&self) -> Result<String> {
        let keyring = self.keyring.read().await;
        keyring.get_address()
    }

    /// Get the signing keypair
    pub async fn get_key(&self) -> Result<CardanoKeyring> {
        Ok(self.keyring.read().await.clone())
    }

    /// Add a new key to the keyring
    /// 
    /// For Cardano, this would involve deriving a new account index from the mnemonic
    pub async fn add_key(&self, _account: u32) -> Result<()> {
        // TODO: Implement account derivation for different indices
        // For now, we only support a single account (index 0)
        Err(Error::Keyring(
            "Multiple account support not yet implemented".to_string()
        ))
    }

    //
    // ============================================================================
    // Category 4: Chain Metadata (5 methods)
    // ============================================================================
    //

    /// Query the latest height from Cardano
    pub async fn query_latest_height(&self) -> Result<Height> {
        self.gateway_client.query_latest_height().await
    }

    /// Query account balance for an address
    /// 
    /// Cardano uses UTXOs, so this sums all UTXOs for the address
    pub async fn query_balance(&self, _address: String) -> Result<u64> {
        // TODO: Implement via Gateway UTXO query
        Err(Error::Gateway("Balance query not yet implemented".to_string()))
    }

    /// Query all token balances (ADA + native tokens)
    pub async fn query_all_balances(&self, _address: String) -> Result<Vec<(String, u64)>> {
        // TODO: Implement via Gateway UTXO query with token breakdown
        Err(Error::Gateway("All balances query not yet implemented".to_string()))
    }

    /// Get chain application status (height + timestamp)
    pub async fn query_application_status(&self) -> Result<(Height, i64)> {
        // TODO: Get both height and timestamp from Gateway
        let height = self.gateway_client.query_latest_height().await?;
        // For now, return current time as timestamp
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| Error::Gateway(format!("Time error: {}", e)))?
            .as_secs() as i64;
        Ok((height, timestamp))
    }

    //
    // ============================================================================
    // Category 5: IBC Client Queries (9 methods)
    // ============================================================================
    //

    /// Query all IBC light clients on Cardano
    pub async fn query_clients(&self) -> Result<Vec<String>> {
        // TODO: Implement via Gateway gRPC QueryClients
        Err(Error::Gateway("Query clients not yet implemented".to_string()))
    }

    /// Query specific client state
    pub async fn query_client_state(
        &self,
        client_id: String,
        height: u64,
    ) -> Result<Vec<u8>> {
        self.gateway_client.query_client_state(client_id, height).await
    }

    /// Query connections for a client
    pub async fn query_client_connections(&self, _client_id: String) -> Result<Vec<String>> {
        // TODO: Implement via Gateway gRPC
        Err(Error::Gateway("Query client connections not yet implemented".to_string()))
    }

    /// Query consensus state at specific height
    pub async fn query_consensus_state(
        &self,
        _client_id: String,
        _height: Height,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryConsensusState
        Err(Error::Gateway("Query consensus state not yet implemented".to_string()))
    }

    /// Query all consensus state heights for a client
    pub async fn query_consensus_state_heights(&self, _client_id: String) -> Result<Vec<Height>> {
        // TODO: Implement via Gateway gRPC
        Err(Error::Gateway("Query consensus state heights not yet implemented".to_string()))
    }

    /// Query upgraded client state (for client upgrades)
    pub async fn query_upgraded_client_state(&self, _height: Height) -> Result<Vec<u8>> {
        // TODO: Implement if we support client upgrades
        Err(Error::Gateway("Client upgrades not yet supported".to_string()))
    }

    /// Query upgraded consensus state (for client upgrades)
    pub async fn query_upgraded_consensus_state(&self, _height: Height) -> Result<Vec<u8>> {
        // TODO: Implement if we support client upgrades
        Err(Error::Gateway("Client upgrades not yet supported".to_string()))
    }

    /// Get the IBC commitment prefix (typically "ibc")
    pub async fn query_commitment_prefix(&self) -> Result<Vec<u8>> {
        // Cardano IBC uses "ibc" as the commitment prefix
        Ok(b"ibc".to_vec())
    }

    /// Query compatible IBC connection versions
    pub async fn query_compatible_versions(&self) -> Result<Vec<String>> {
        // Return IBC version 1
        Ok(vec!["1".to_string()])
    }

    //
    // ============================================================================
    // Category 6: IBC Connection Queries (3 methods)
    // ============================================================================
    //

    /// Query specific connection state
    pub async fn query_connection(
        &self,
        _connection_id: String,
        _height: u64,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryConnection
        Err(Error::Gateway("Query connection not yet implemented".to_string()))
    }

    /// Query all connections
    pub async fn query_connections(&self) -> Result<Vec<String>> {
        // TODO: Implement via Gateway gRPC QueryConnections
        Err(Error::Gateway("Query connections not yet implemented".to_string()))
    }

    /// Query channels for a connection
    pub async fn query_connection_channels(&self, _connection_id: String) -> Result<Vec<String>> {
        // TODO: Implement via Gateway gRPC
        Err(Error::Gateway("Query connection channels not yet implemented".to_string()))
    }

    //
    // ============================================================================
    // Category 7: IBC Channel Queries (4 methods)
    // ============================================================================
    //

    /// Query all channels
    pub async fn query_channels(&self) -> Result<Vec<String>> {
        // TODO: Implement via Gateway gRPC QueryChannels
        Err(Error::Gateway("Query channels not yet implemented".to_string()))
    }

    /// Query specific channel state
    pub async fn query_channel(
        &self,
        _port_id: String,
        _channel_id: String,
        _height: u64,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryChannel
        Err(Error::Gateway("Query channel not yet implemented".to_string()))
    }

    /// Query the client associated with a channel
    pub async fn query_channel_client_state(
        &self,
        _port_id: String,
        _channel_id: String,
    ) -> Result<String> {
        // TODO: Implement via Gateway gRPC
        Err(Error::Gateway("Query channel client state not yet implemented".to_string()))
    }

    /// Query the next sequence number for packet receive
    pub async fn query_next_sequence_receive(
        &self,
        _port_id: String,
        _channel_id: String,
        _height: u64,
    ) -> Result<u64> {
        // TODO: Implement via Gateway gRPC QueryNextSequenceReceive
        Err(Error::Gateway("Query next sequence receive not yet implemented".to_string()))
    }

    //
    // ============================================================================
    // Category 10: Packet Commitment Queries (4 methods)
    // ============================================================================
    //

    /// Query packet commitment
    pub async fn query_packet_commitment(
        &self,
        _port_id: String,
        _channel_id: String,
        _sequence: u64,
        _height: u64,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryPacketCommitment
        Err(Error::Gateway("Query packet commitment not yet implemented".to_string()))
    }

    /// Query all packet commitments for a channel
    pub async fn query_packet_commitments(
        &self,
        _port_id: String,
        _channel_id: String,
    ) -> Result<Vec<u64>> {
        // TODO: Implement via Gateway gRPC QueryPacketCommitments
        Err(Error::Gateway("Query packet commitments not yet implemented".to_string()))
    }

    /// Query which packets the destination chain hasn't received yet
    pub async fn query_unreceived_packets(
        &self,
        _port_id: String,
        _channel_id: String,
        _sequences: Vec<u64>,
    ) -> Result<Vec<u64>> {
        // TODO: Implement via Gateway gRPC QueryUnreceivedPackets
        Err(Error::Gateway("Query unreceived packets not yet implemented".to_string()))
    }

    /// Query packet receipt
    pub async fn query_packet_receipt(
        &self,
        _port_id: String,
        _channel_id: String,
        _sequence: u64,
        _height: u64,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryPacketReceipt
        Err(Error::Gateway("Query packet receipt not yet implemented".to_string()))
    }

    //
    // ============================================================================
    // Category 11: Packet Acknowledgement Queries (3 methods)
    // ============================================================================
    //

    /// Query packet acknowledgement
    pub async fn query_packet_acknowledgement(
        &self,
        _port_id: String,
        _channel_id: String,
        _sequence: u64,
        _height: u64,
    ) -> Result<Vec<u8>> {
        // TODO: Implement via Gateway gRPC QueryPacketAcknowledgement
        Err(Error::Gateway("Query packet acknowledgement not yet implemented".to_string()))
    }

    /// Query all packet acknowledgements for a channel
    pub async fn query_packet_acknowledgements(
        &self,
        _port_id: String,
        _channel_id: String,
    ) -> Result<Vec<u64>> {
        // TODO: Implement via Gateway gRPC QueryPacketAcknowledgements
        Err(Error::Gateway("Query packet acknowledgements not yet implemented".to_string()))
    }

    /// Query which acknowledgements the source chain hasn't received yet
    pub async fn query_unreceived_acknowledgements(
        &self,
        _port_id: String,
        _channel_id: String,
        _sequences: Vec<u64>,
    ) -> Result<Vec<u64>> {
        // TODO: Implement via Gateway gRPC QueryUnreceivedAcknowledgements
        Err(Error::Gateway("Query unreceived acknowledgements not yet implemented".to_string()))
    }

    //
    // ============================================================================
    // Helper Methods (Internal)
    // ============================================================================
    //

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
            "http://localhost:5001".to_string(),
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
            "http://localhost:5001".to_string(),
            keyring,
        ).unwrap();

        assert_eq!(handle.id(), chain_id);
    }

    #[test]
    fn test_clone() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id.clone(),
            "http://localhost:5001".to_string(),
            keyring,
        ).unwrap();

        let cloned = handle.clone();
        assert_eq!(cloned.id(), chain_id);
    }

    #[tokio::test]
    async fn test_shutdown() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id,
            "http://localhost:5001".to_string(),
            keyring,
        ).unwrap();

        assert!(handle.shutdown().await.is_ok());
    }

    #[tokio::test]
    async fn test_query_commitment_prefix() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id,
            "http://localhost:5001".to_string(),
            keyring,
        ).unwrap();

        let prefix = handle.query_commitment_prefix().await.unwrap();
        assert_eq!(prefix, b"ibc");
    }

    #[tokio::test]
    async fn test_query_compatible_versions() {
        let chain_id = ChainId::new("cardano-testnet".to_string(), 0);
        let keyring = CardanoKeyring::new_for_testing();
        
        let handle = CardanoChainHandle::new(
            chain_id,
            "http://localhost:5001".to_string(),
            keyring,
        ).unwrap();

        let versions = handle.query_compatible_versions().await.unwrap();
        assert_eq!(versions, vec!["1".to_string()]);
    }
}
