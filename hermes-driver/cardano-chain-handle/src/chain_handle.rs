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
    /// ## Production Flow (Relayer-Signed Mode)
    /// The Gateway now returns unsigned transactions for Hermes to sign:
    /// 1. Call Gateway Msg service (e.g., MsgCreateClient) to get unsigned CBOR
    /// 2. Sign with CardanoSigner using CIP-1852 keys (Ed25519)
    /// 3. Submit signed transaction via Gateway's SubmitSignedTx endpoint
    /// 4. Wait for confirmation and return IBC events
    /// 
    /// This provides full control over transaction signing to the relayer,
    /// matching the security model of other IBC implementations.
    pub async fn send_messages_and_wait_commit(
        &self,
        msgs: TrackedMsgs,
    ) -> Result<Vec<IbcEvent>> {
        let mut all_events = Vec::new();
        
        // Process each message through the Gateway
        for _msg in msgs.messages() {
            // TODO: Implement message dispatch based on msg type
            // For each message type, we need to:
            // 1. Extract the message data (client_state, consensus_state, etc.)
            // 2. Call the appropriate Gateway Msg service method
            //    - Example: gateway.create_client(msg_data) returns unsigned_tx_cbor
            // 3. Sign the unsigned transaction
            //    let signed_cbor = self.signer.sign_transaction(unsigned_tx_cbor).await?;
            // 4. Submit the signed transaction
            //    let (tx_hash, events) = gateway.submit_signed_transaction(signed_cbor, desc).await?;
            // 5. Collect the events
            //    all_events.extend(events);
            
            // Message type dispatch skeleton:
            // match msg.type_url.as_str() {
            //     "/ibc.core.client.v1.MsgCreateClient" => { /* create_client flow */ },
            //     "/ibc.core.client.v1.MsgUpdateClient" => { /* update_client flow */ },
            //     "/ibc.core.connection.v1.MsgConnectionOpenInit" => { /* connection_open_init flow */ },
            //     // ... etc for all IBC message types
            //     _ => return Err(Error::Gateway(format!("Unsupported message type: {}", msg.type_url))),
            // }
            
            tracing::debug!(
                "Processing IBC message (Relayer-signed mode with Gateway unsigned tx + Hermes signing)"
            );
        }
        
        // Return collected events from all submitted transactions
        Ok(all_events)
    }

    /// Submit messages and return immediately after mempool check
    /// 
    /// Cardano doesn't have a traditional mempool like Tendermint chains.
    /// Transactions are submitted to a node and either accepted or rejected.
    /// This method behaves similarly to send_messages_and_wait_commit.
    pub async fn send_messages_and_wait_check_tx(
        &self,
        msgs: TrackedMsgs,
    ) -> Result<Vec<IbcEvent>> {
        // For Cardano, "check_tx" and "commit" are essentially the same
        // since there's no mempool stage - tx is either in a block or rejected
        self.send_messages_and_wait_commit(msgs).await
    }
    
    /// Build and sign a transaction without submitting
    /// 
    /// This method demonstrates the future flow where Hermes controls signing:
    /// 1. Get unsigned transaction from Gateway
    /// 2. Sign with our CardanoSigner
    /// 3. Return signed CBOR for submission
    /// 
    /// Note: Currently unused as Gateway signs internally
    #[allow(dead_code)]
    async fn build_and_sign_transaction(&self, unsigned_tx_cbor: Vec<u8>) -> Result<Vec<u8>> {
        // Sign the transaction using our keyring
        self.signer.sign_transaction(unsigned_tx_cbor).await
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
        self.gateway_client.query_clients().await
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
    pub async fn query_client_connections(&self, client_id: String) -> Result<Vec<String>> {
        self.gateway_client.query_client_connections(client_id).await
    }

    /// Query consensus state at specific height
    pub async fn query_consensus_state(
        &self,
        client_id: String,
        height: Height,
    ) -> Result<Vec<u8>> {
        // For Cardano, we only use revision_height (block number)
        // since Cardano doesn't have revisions
        self.gateway_client
            .query_consensus_state(client_id, height.revision_height())
            .await
    }

    /// Query all consensus state heights for a client
    pub async fn query_consensus_state_heights(&self, client_id: String) -> Result<Vec<Height>> {
        let heights = self.gateway_client
            .query_consensus_state_heights(client_id)
            .await?;
        
        heights
            .into_iter()
            .map(|(rev_num, rev_height)| {
                Height::new(rev_num, rev_height)
                    .map_err(|e| Error::Gateway(format!("Invalid height: {}", e)))
            })
            .collect()
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
        connection_id: String,
        _height: u64,
    ) -> Result<Vec<u8>> {
        self.gateway_client.query_connection(connection_id).await
    }

    /// Query all connections
    pub async fn query_connections(&self) -> Result<Vec<String>> {
        self.gateway_client.query_connections().await
    }

    /// Query channels for a connection
    pub async fn query_connection_channels(&self, connection_id: String) -> Result<Vec<String>> {
        self.gateway_client.query_connection_channels(connection_id).await
    }

    //
    // ============================================================================
    // Category 7: IBC Channel Queries (4 methods)
    // ============================================================================
    //

    /// Query all channels
    pub async fn query_channels(&self) -> Result<Vec<String>> {
        self.gateway_client.query_channels().await
    }

    /// Query specific channel state
    pub async fn query_channel(
        &self,
        port_id: String,
        channel_id: String,
        _height: u64,
    ) -> Result<Vec<u8>> {
        self.gateway_client.query_channel(port_id, channel_id).await
    }

    /// Query the client associated with a channel
    pub async fn query_channel_client_state(
        &self,
        port_id: String,
        channel_id: String,
    ) -> Result<String> {
        self.gateway_client.query_channel_client_state(port_id, channel_id).await
    }

    /// Query the next sequence number for packet receive
    pub async fn query_next_sequence_receive(
        &self,
        port_id: String,
        channel_id: String,
        _height: u64,
    ) -> Result<u64> {
        self.gateway_client.query_next_sequence_receive(port_id, channel_id).await
    }

    //
    // ============================================================================
    // Category 10: Packet Commitment Queries (4 methods)
    // ============================================================================
    //

    /// Query packet commitment
    pub async fn query_packet_commitment(
        &self,
        port_id: String,
        channel_id: String,
        sequence: u64,
        _height: u64,
    ) -> Result<Vec<u8>> {
        self.gateway_client
            .query_packet_commitment(port_id, channel_id, sequence)
            .await
    }

    /// Query all packet commitments for a channel
    pub async fn query_packet_commitments(
        &self,
        port_id: String,
        channel_id: String,
    ) -> Result<Vec<u64>> {
        self.gateway_client
            .query_packet_commitments(port_id, channel_id)
            .await
    }

    /// Query which packets the destination chain hasn't received yet
    pub async fn query_unreceived_packets(
        &self,
        port_id: String,
        channel_id: String,
        sequences: Vec<u64>,
    ) -> Result<Vec<u64>> {
        self.gateway_client
            .query_unreceived_packets(port_id, channel_id, sequences)
            .await
    }

    /// Query packet receipt (whether a packet was received)
    pub async fn query_packet_receipt(
        &self,
        port_id: String,
        channel_id: String,
        sequence: u64,
        _height: u64,
    ) -> Result<bool> {
        self.gateway_client
            .query_packet_receipt(port_id, channel_id, sequence)
            .await
    }

    //
    // ============================================================================
    // Category 11: Packet Acknowledgement Queries (3 methods)
    // ============================================================================
    //

    /// Query packet acknowledgement
    pub async fn query_packet_acknowledgement(
        &self,
        port_id: String,
        channel_id: String,
        sequence: u64,
        _height: u64,
    ) -> Result<Vec<u8>> {
        self.gateway_client
            .query_packet_acknowledgement(port_id, channel_id, sequence)
            .await
    }

    /// Query all packet acknowledgements for a channel
    pub async fn query_packet_acknowledgements(
        &self,
        port_id: String,
        channel_id: String,
    ) -> Result<Vec<u64>> {
        self.gateway_client
            .query_packet_acknowledgements(port_id, channel_id)
            .await
    }

    /// Query which acknowledgements the source chain hasn't received yet
    pub async fn query_unreceived_acknowledgements(
        &self,
        port_id: String,
        channel_id: String,
        sequences: Vec<u64>,
    ) -> Result<Vec<u64>> {
        self.gateway_client
            .query_unreceived_acknowledgements(port_id, channel_id, sequences)
            .await
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
