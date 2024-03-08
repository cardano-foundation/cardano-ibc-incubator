export const EVENT_TYPE_PACKET = {
  SEND_PACKET: 'send_packet',
  RECV_PACKET: 'recv_packet',
  WRITE_ACKNOWLEDGEMENT: 'write_acknowledgement',
  ACKNOWLEDGE_PACKET: 'acknowledge_packet',
  TIMEOUT_PACKET: 'timeout_packet',
  TIMEOUT_ON_CLOSE_PACKET: 'timeout_on_close_packet',
};

export const ATTRIBUTE_KEY_PACKET = {
  // Deprecated: in favor of AttributeKeyDataHex
  PACKET_DATA: 'packet_data',
  // // Deprecated: in favor of AttributeKeyAckHex
  PACKET_ACK: 'packet_ack',

  PACKET_DATA_HEX: 'packet_data_hex',
  PACKET_ACK_HEX: 'packet_ack_hex',
  PACKET_TIMEOUT_HEIGHT: 'packet_timeout_height',
  PACKET_TIMEOUT_TIMESTAMP: 'packet_timeout_timestamp',
  PACKET_SEQUENCE: 'packet_sequence',
  PACKET_SRC_PORT: 'packet_src_port',
  PACKET_SRC_CHANNEL: 'packet_src_channel',
  PACKET_DST_PORT: 'packet_dst_port',
  PACKET_DST_CHANNEL: 'packet_dst_channel',
  PACKET_CHANNEL_ORDERING: 'packet_channel_ordering',
  PACKET_CONNECTION: 'packet_connection',
};
