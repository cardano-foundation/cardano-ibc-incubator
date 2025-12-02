use ibc_relayer::chain::tracking::TrackedMsgs;
use ibc_relayer_types::core::ics02_client::height::Height;
use ibc_relayer_types::events::IbcEvent;
use tonic::transport::{Channel, Endpoint};

use crate::error::{Error, Result};
use crate::generated::ibc::core::client::v1::{
    query_client::QueryClient as ClientQueryClient,
    QueryLatestHeightRequest, QueryClientStateRequest,
    QueryClientStatesRequest, QueryConsensusStateRequest,
    QueryConsensusStateHeightsRequest,
};
use crate::generated::ibc::core::connection::v1::{
    query_client::QueryClient as ConnectionQueryClient,
    QueryConnectionRequest, QueryConnectionsRequest,
    QueryClientConnectionsRequest,
};
use crate::generated::ibc::core::channel::v1::{
    query_client::QueryClient as ChannelQueryClient,
    QueryChannelRequest, QueryChannelsRequest,
    QueryChannelClientStateRequest, QueryNextSequenceReceiveRequest,
    QueryConnectionChannelsRequest,
};

/// GatewayClient handles gRPC communication with the Cardano Gateway
/// The Gateway is responsible for:
/// - Building unsigned Cardano transactions
/// - Submitting signed transactions to Cardano
/// - Querying Cardano state
/// - Providing IBC events
#[derive(Clone)]
pub struct GatewayClient {
    /// gRPC endpoint URL
    endpoint: String,
}

impl GatewayClient {
    /// Create a new GatewayClient
    pub fn new(endpoint: String) -> Result<Self> {
        Ok(Self { endpoint })
    }

    /// Get a gRPC channel to the Gateway
    async fn connect(&self) -> Result<Channel> {
        let endpoint = Endpoint::from_shared(self.endpoint.clone())
            .map_err(|e| Error::Gateway(format!("Invalid endpoint: {}", e)))?;
        
        endpoint
            .connect()
            .await
            .map_err(|e| Error::Gateway(format!("Connection failed: {}", e)))
    }

    /// Query the latest height from Cardano
    pub async fn query_latest_height(&self) -> Result<Height> {
        let channel = self.connect().await?;
        let mut client = ClientQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryLatestHeightRequest {});
        
        let response = client
            .latest_height(request)
            .await
            .map_err(|e| Error::Gateway(format!("LatestHeight query failed: {}", e)))?;
        
        let height_value = response.into_inner().height;
        
        // Cardano doesn't have revision numbers, so use revision 0
        // The height is the Cardano block number
        Height::new(0, height_value)
            .map_err(|e| Error::Gateway(format!("Invalid height: {}", e)))
    }

    /// Query client state from Cardano
    /// The height parameter specifies the block height to query at (0 for latest)
    pub async fn query_client_state(&self, client_id: String, height: u64) -> Result<Vec<u8>> {
        let channel = self.connect().await?;
        let mut client = ClientQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryClientStateRequest {
            client_id,
            height,
        });
        
        let response = client
            .client_state(request)
            .await
            .map_err(|e| Error::Gateway(format!("ClientState query failed: {}", e)))?;
        
        let client_state = response.into_inner().client_state
            .ok_or_else(|| Error::Gateway("No client state in response".to_string()))?;
        
        // Return serialized protobuf Any
        use prost::Message;
        Ok(client_state.encode_to_vec())
    }

    /// Build an unsigned transaction via the Gateway
    /// 
    /// The Gateway's gRPC interface returns unsigned transactions directly from
    /// each IBC message RPC call (e.g., MsgCreateClient -> MsgCreateClientResponse
    /// contains the unsigned_tx field).
    /// 
    /// This method is a placeholder - in practice, ChainHandle will call specific
    /// message methods (create_client_tx, update_client_tx, etc.) that return the
    /// unsigned transaction directly.
    pub async fn build_transaction(&self, _msgs: &TrackedMsgs) -> Result<Vec<u8>> {
        // Not directly implemented - Gateway returns unsigned tx from message-specific RPCs
        // Each message type (CreateClient, UpdateClient, etc.) has its own gRPC method
        // that returns an unsigned transaction in the response.
        Err(Error::TxBuilder(
            "Use message-specific methods (create_client_tx, etc.) instead".to_string()
        ))
    }

    /// Submit a signed transaction to Cardano via the Gateway
    /// 
    /// The Gateway will:
    /// 1. Receive signed CBOR transaction bytes
    /// 2. Submit to Cardano via Ogmios/direct node connection
    /// 3. Wait for confirmation
    /// 4. Return transaction hash
    /// 
    /// This is a generic submission endpoint that works for all transaction types.
    pub async fn submit_transaction(&self, _signed_tx: Vec<u8>) -> Result<String> {
        // TODO: Implement once Gateway adds a generic SubmitTransaction RPC endpoint
        // For now, this needs to be called via the Gateway's HTTP API or a custom RPC
        Err(Error::Gateway(
            "Transaction submission endpoint not yet implemented in Gateway gRPC".to_string()
        ))
    }

    //
    // ============================================================================
    // Category 5: IBC Client Queries
    // ============================================================================
    //

    /// Query all IBC clients on Cardano
    pub async fn query_clients(&self) -> Result<Vec<String>> {
        let channel = self.connect().await?;
        let mut client = ClientQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryClientStatesRequest {
            pagination: None,
        });
        
        let response = client
            .client_states(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryClientStates failed: {}", e)))?;
        
        // Extract client IDs from the response
        let client_ids = response.into_inner().client_states
            .into_iter()
            .map(|state| state.client_id)
            .collect();
        
        Ok(client_ids)
    }

    /// Query connections for a specific client
    pub async fn query_client_connections(&self, client_id: String) -> Result<Vec<String>> {
        let channel = self.connect().await?;
        let mut client = ConnectionQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryClientConnectionsRequest {
            client_id,
        });
        
        let response = client
            .client_connections(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryClientConnections failed: {}", e)))?;
        
        Ok(response.into_inner().connection_paths)
    }

    /// Query consensus state at specific height
    pub async fn query_consensus_state(
        &self,
        client_id: String,
        height: u64,
    ) -> Result<Vec<u8>> {
        let channel = self.connect().await?;
        let mut client = ClientQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryConsensusStateRequest {
            client_id,
            height,
        });
        
        let response = client
            .consensus_state(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryConsensusState failed: {}", e)))?;
        
        let consensus_state = response.into_inner().consensus_state
            .ok_or_else(|| Error::Gateway("No consensus state in response".to_string()))?;
        
        use prost::Message;
        Ok(consensus_state.encode_to_vec())
    }

    /// Query all consensus state heights for a client
    pub async fn query_consensus_state_heights(&self, client_id: String) -> Result<Vec<(u64, u64)>> {
        let channel = self.connect().await?;
        let mut client = ClientQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryConsensusStateHeightsRequest {
            client_id,
            pagination: None,
        });
        
        let response = client
            .consensus_state_heights(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryConsensusStateHeights failed: {}", e)))?;
        
        let heights = response.into_inner().consensus_state_heights
            .into_iter()
            .map(|h| (h.revision_number, h.revision_height))
            .collect();
        
        Ok(heights)
    }

    //
    // ============================================================================
    // Category 6: IBC Connection Queries
    // ============================================================================
    //

    /// Query specific connection state
    pub async fn query_connection(&self, connection_id: String) -> Result<Vec<u8>> {
        let channel = self.connect().await?;
        let mut client = ConnectionQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryConnectionRequest {
            connection_id,
        });
        
        let response = client
            .connection(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryConnection failed: {}", e)))?;
        
        let connection = response.into_inner().connection
            .ok_or_else(|| Error::Gateway("No connection in response".to_string()))?;
        
        use prost::Message;
        Ok(connection.encode_to_vec())
    }

    /// Query all connections
    pub async fn query_connections(&self) -> Result<Vec<String>> {
        let channel = self.connect().await?;
        let mut client = ConnectionQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryConnectionsRequest {
            pagination: None,
        });
        
        let response = client
            .connections(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryConnections failed: {}", e)))?;
        
        let connection_ids = response.into_inner().connections
            .into_iter()
            .map(|conn| conn.id)
            .collect();
        
        Ok(connection_ids)
    }

    /// Query channels for a connection
    pub async fn query_connection_channels(&self, connection_id: String) -> Result<Vec<String>> {
        let channel = self.connect().await?;
        let mut client = ChannelQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryConnectionChannelsRequest {
            connection: connection_id,
            pagination: None,
        });
        
        let response = client
            .connection_channels(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryConnectionChannels failed: {}", e)))?;
        
        let channel_ids = response.into_inner().channels
            .into_iter()
            .map(|ch| ch.channel_id)
            .collect();
        
        Ok(channel_ids)
    }

    //
    // ============================================================================
    // Category 7: IBC Channel Queries
    // ============================================================================
    //

    /// Query all channels
    pub async fn query_channels(&self) -> Result<Vec<String>> {
        let channel = self.connect().await?;
        let mut client = ChannelQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryChannelsRequest {
            pagination: None,
        });
        
        let response = client
            .channels(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryChannels failed: {}", e)))?;
        
        let channel_ids = response.into_inner().channels
            .into_iter()
            .map(|ch| ch.channel_id)
            .collect();
        
        Ok(channel_ids)
    }

    /// Query specific channel state
    pub async fn query_channel(&self, port_id: String, channel_id: String) -> Result<Vec<u8>> {
        let channel = self.connect().await?;
        let mut client = ChannelQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryChannelRequest {
            port_id,
            channel_id,
        });
        
        let response = client
            .channel(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryChannel failed: {}", e)))?;
        
        let channel_state = response.into_inner().channel
            .ok_or_else(|| Error::Gateway("No channel in response".to_string()))?;
        
        use prost::Message;
        Ok(channel_state.encode_to_vec())
    }

    /// Query the client associated with a channel
    pub async fn query_channel_client_state(&self, port_id: String, channel_id: String) -> Result<String> {
        let channel = self.connect().await?;
        let mut client = ChannelQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryChannelClientStateRequest {
            port_id,
            channel_id,
        });
        
        let response = client
            .channel_client_state(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryChannelClientState failed: {}", e)))?;
        
        let inner = response.into_inner();
        let client_id = inner.identified_client_state
            .ok_or_else(|| Error::Gateway("No client state in response".to_string()))?
            .client_id;
        
        Ok(client_id)
    }

    /// Query the next sequence number for packet receive
    pub async fn query_next_sequence_receive(
        &self,
        port_id: String,
        channel_id: String,
    ) -> Result<u64> {
        let channel = self.connect().await?;
        let mut client = ChannelQueryClient::new(channel);
        
        let request = tonic::Request::new(QueryNextSequenceReceiveRequest {
            port_id,
            channel_id,
        });
        
        let response = client
            .next_sequence_receive(request)
            .await
            .map_err(|e| Error::Gateway(format!("QueryNextSequenceReceive failed: {}", e)))?;
        
        Ok(response.into_inner().next_sequence_receive)
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
        let client = GatewayClient::new("http://localhost:5001".to_string());
        assert!(client.is_ok());
    }

    #[test]
    fn test_invalid_endpoint() {
        let client = GatewayClient::new("invalid-url".to_string());
        // Should still create successfully (connection happens lazily)
        assert!(client.is_ok());
    }
    
    // Integration tests (require running Gateway)
    // These are commented out as they need a live Gateway instance
    
    // #[tokio::test]
    // async fn test_query_latest_height() {
    //     let client = GatewayClient::new("http://localhost:5001".to_string()).unwrap();
    //     let height = client.query_latest_height().await;
    //     assert!(height.is_ok());
    //     let h = height.unwrap();
    //     assert_eq!(h.revision_number(), 0); // Cardano doesn't use revisions
    //     assert!(h.revision_height() > 0);
    // }
    
    // #[tokio::test]
    // async fn test_query_client_state() {
    //     let client = GatewayClient::new("http://localhost:5001".to_string()).unwrap();
    //     let client_state = client.query_client_state("07-tendermint-0".to_string(), 0).await;
    //     assert!(client_state.is_ok());
    //     let state_bytes = client_state.unwrap();
    //     assert!(!state_bytes.is_empty());
    // }
}

