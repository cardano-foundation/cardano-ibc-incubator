use ibc_relayer::chain::tracking::TrackedMsgs;
use ibc_relayer_types::core::ics02_client::height::Height;
use ibc_relayer_types::events::IbcEvent;
use tonic::transport::Channel;

use crate::error::{Error, Result};

/// GatewayClient handles gRPC communication with the Cardano Gateway
/// The Gateway is responsible for:
/// - Building unsigned Cardano transactions
/// - Submitting signed transactions to Cardano
/// - Querying Cardano state
/// - Providing IBC events
pub struct GatewayClient {
    /// gRPC endpoint URL
    endpoint: String,
    
    /// gRPC channel (created lazily)
    channel: Option<Channel>,
}

impl GatewayClient {
    /// Create a new GatewayClient
    pub fn new(endpoint: String) -> Result<Self> {
        Ok(Self {
            endpoint,
            channel: None,  // Lazy init: connect on first use to avoid blocking constructor
        })
    }

    /// Ensure we have a gRPC channel, creating it if necessary
    async fn get_channel(&mut self) -> Result<&Channel> {
        if self.channel.is_none() {  // Lazy connection: only connect when needed
            let channel = Channel::from_shared(self.endpoint.clone())
                .map_err(|e| Error::Gateway(format!("Invalid endpoint: {}", e)))?
                .connect()
                .await
                .map_err(|e| Error::Gateway(format!("Connection failed: {}", e)))?;
            
            self.channel = Some(channel);
        }

        Ok(self.channel.as_ref().unwrap())
    }

    /// Query the latest height from Cardano
    pub async fn query_latest_height(&self) -> Result<Height> {
        // TODO: Implement gRPC call to Gateway's QueryLatestHeight
        // For now, return a stub
        Err(Error::Gateway("query_latest_height not yet implemented".to_string()))
    }

    /// Query client state from Cardano
    /// TODO: Add proper return type once we define Gateway protobuf types
    pub async fn query_client_state(&self, _client_id: String) -> Result<Vec<u8>> {
        // TODO: Implement gRPC call to Gateway's QueryClientState
        Err(Error::Gateway("query_client_state not yet implemented".to_string()))
    }

    /// Build an unsigned transaction via the Gateway
    /// 
    /// The Gateway will:
    /// 1. Query required UTXOs from Cardano
    /// 2. Build the transaction using Lucid
    /// 3. Calculate fees and change
    /// 4. Return unsigned CBOR
    pub async fn build_transaction(&self, msgs: &TrackedMsgs) -> Result<Vec<u8>> {
        // TODO: Implement gRPC call to Gateway's BuildTransaction
        // This needs to:
        // 1. Convert TrackedMsgs to protobuf format
        // 2. Call Gateway gRPC endpoint
        // 3. Return unsigned transaction CBOR
        Err(Error::TxBuilder("build_transaction not yet implemented".to_string()))
    }

    /// Submit a signed transaction to Cardano
    /// 
    /// The Gateway will:
    /// 1. Receive signed CBOR transaction
    /// 2. Submit via Ogmios to Cardano
    /// 3. Wait for confirmation
    /// 4. Return transaction hash
    pub async fn submit_transaction(&self, signed_tx: Vec<u8>) -> Result<String> {
        // TODO: Implement gRPC call to Gateway's SubmitTransaction
        Err(Error::Gateway("submit_transaction not yet implemented".to_string()))
    }

    /// Wait for transaction events
    /// 
    /// Polls the Gateway for transaction confirmation and IBC events
    pub async fn wait_for_tx_events(&self, tx_hash: &str) -> Result<Vec<IbcEvent>> {
        // TODO: Implement polling for tx confirmation and event extraction
        Err(Error::Gateway("wait_for_tx_events not yet implemented".to_string()))
    }

    /// Query IBC events in a height range
    pub async fn query_events(
        &self,
        from_height: Height,
        to_height: Height,
    ) -> Result<Vec<IbcEvent>> {
        // TODO: Implement gRPC call to Gateway's QueryEvents
        Err(Error::Gateway("query_events not yet implemented".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_client_creation() {
        let client = GatewayClient::new("http://localhost:3000".to_string());
        assert!(client.is_ok());
    }

    #[test]
    fn test_invalid_endpoint() {
        let client = GatewayClient::new("invalid-url".to_string());
        // Should still create successfully (connection happens lazily)
        assert!(client.is_ok());
    }
}

