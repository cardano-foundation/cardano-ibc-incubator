// Type conversions between Hermes types and Gateway protobuf types
// 
// Hermes uses ibc-relayer-types (standard IBC types)
// Gateway uses custom protobuf definitions
// This module bridges the two

use ibc_relayer_types::core::ics02_client::height::Height as IbcHeight;
use ibc_relayer_types::core::ics24_host::identifier::{ChannelId, ClientId, ConnectionId, PortId};

use crate::error::{Error, Result};

/// Convert IBC Height to Gateway protobuf Height
pub fn ibc_height_to_proto(height: IbcHeight) -> Result<Vec<u8>> {
    // TODO: Implement conversion to protobuf Height message
    // Height { revision_number, revision_height }
    Err(Error::Serialization(
        "ibc_height_to_proto not yet implemented".to_string()
    ))
}

/// Convert Gateway protobuf Height to IBC Height
pub fn proto_to_ibc_height(proto: Vec<u8>) -> Result<IbcHeight> {
    // TODO: Implement deserialization from protobuf
    Err(Error::Serialization(
        "proto_to_ibc_height not yet implemented".to_string()
    ))
}

/// Convert IBC ClientId to Gateway format
pub fn client_id_to_proto(client_id: &ClientId) -> Result<Vec<u8>> {
    // ClientId is just a string, so this is straightforward
    Ok(client_id.as_str().as_bytes().to_vec())
}

/// Convert Gateway protobuf ClientId to IBC ClientId
pub fn proto_to_client_id(proto: Vec<u8>) -> Result<ClientId> {
    let s = String::from_utf8(proto)
        .map_err(|e| Error::Serialization(format!("Invalid UTF-8: {}", e)))?;
    
    ClientId::from_str(&s)
        .map_err(|e| Error::Serialization(format!("Invalid ClientId: {}", e)))
}

/// Convert IBC ConnectionId to Gateway format
pub fn connection_id_to_proto(connection_id: &ConnectionId) -> Result<Vec<u8>> {
    Ok(connection_id.as_str().as_bytes().to_vec())
}

/// Convert Gateway protobuf ConnectionId to IBC ConnectionId
pub fn proto_to_connection_id(proto: Vec<u8>) -> Result<ConnectionId> {
    let s = String::from_utf8(proto)
        .map_err(|e| Error::Serialization(format!("Invalid UTF-8: {}", e)))?;
    
    ConnectionId::from_str(&s)
        .map_err(|e| Error::Serialization(format!("Invalid ConnectionId: {}", e)))
}

/// Convert IBC ChannelId to Gateway format
pub fn channel_id_to_proto(channel_id: &ChannelId) -> Result<Vec<u8>> {
    Ok(channel_id.as_str().as_bytes().to_vec())
}

/// Convert Gateway protobuf ChannelId to IBC ChannelId  
pub fn proto_to_channel_id(proto: Vec<u8>) -> Result<ChannelId> {
    let s = String::from_utf8(proto)
        .map_err(|e| Error::Serialization(format!("Invalid UTF-8: {}", e)))?;
    
    ChannelId::from_str(&s)
        .map_err(|e| Error::Serialization(format!("Invalid ChannelId: {}", e)))
}

/// Convert IBC PortId to Gateway format
pub fn port_id_to_proto(port_id: &PortId) -> Result<Vec<u8>> {
    Ok(port_id.as_str().as_bytes().to_vec())
}

/// Convert Gateway protobuf PortId to IBC PortId
pub fn proto_to_port_id(proto: Vec<u8>) -> Result<PortId> {
    let s = String::from_utf8(proto)
        .map_err(|e| Error::Serialization(format!("Invalid UTF-8: {}", e)))?;
    
    PortId::from_str(&s)
        .map_err(|e| Error::Serialization(format!("Invalid PortId: {}", e)))
}

// Re-export IBC types for convenience
pub use ibc_relayer_types::core::ics02_client::height::Height;
pub use ibc_relayer_types::core::ics24_host::identifier::{
    ChannelId as IbcChannelId,      // Re-exported for convenience in consumer code
    ClientId as IbcClientId,
    ConnectionId as IbcConnectionId,
    PortId as IbcPortId,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_id_conversion() {
        let client_id = ClientId::from_str("07-tendermint-0").unwrap();
        
        let proto = client_id_to_proto(&client_id).unwrap();
        let back = proto_to_client_id(proto).unwrap();
        
        assert_eq!(client_id, back);
    }

    #[test]
    fn test_connection_id_conversion() {
        let connection_id = ConnectionId::from_str("connection-0").unwrap();
        
        let proto = connection_id_to_proto(&connection_id).unwrap();
        let back = proto_to_connection_id(proto).unwrap();
        
        assert_eq!(connection_id, back);
    }

    #[test]
    fn test_channel_id_conversion() {
        let channel_id = ChannelId::from_str("channel-0").unwrap();
        
        let proto = channel_id_to_proto(&channel_id).unwrap();
        let back = proto_to_channel_id(proto).unwrap();
        
        assert_eq!(channel_id, back);
    }

    #[test]
    fn test_port_id_conversion() {
        let port_id = PortId::from_str("transfer").unwrap();
        
        let proto = port_id_to_proto(&port_id).unwrap();
        let back = proto_to_port_id(proto).unwrap();
        
        assert_eq!(port_id, back);
    }
}

