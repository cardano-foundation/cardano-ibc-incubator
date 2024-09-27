export const EventAttributeChannel = {
  AttributeKeyConnectionID: 'connection_id',
  AttributeKeyPortID: 'port_id',
  AttributeKeyChannelID: 'channel_id',
  AttributeVersion: 'version',
  AttributeCounterpartyPortID: 'counterparty_port_id',
  AttributeCounterpartyChannelID: 'counterparty_channel_id',

  // Deprecated: in favor of AttributeKeyDataHex
  AttributeKeyData: 'packet_data',
  // Deprecated: in favor of AttributeKeyAckHex
  AttributeKeyAck: 'packet_ack',

  AttributeKeyDataHex: 'packet_data_hex',
  AttributeKeyAckHex: 'packet_ack_hex',
  AttributeKeyTimeoutHeight: 'packet_timeout_height',
  AttributeKeyTimeoutTimestamp: 'packet_timeout_timestamp',
  AttributeKeySequence: 'packet_sequence',
  AttributeKeySrcPort: 'packet_src_port',
  AttributeKeySrcChannel: 'packet_src_channel',
  AttributeKeyDstPort: 'packet_dst_port',
  AttributeKeyDstChannel: 'packet_dst_channel',
  AttributeKeyChannelOrdering: 'packet_channel_ordering',
  AttributeKeyConnection: 'packet_connection',
};

export const EventAttributeConnection = {
  AttributeKeyConnectionID: 'connection_id',
  AttributeKeyClientID: 'client_id',
  AttributeKeyCounterpartyClientID: 'counterparty_client_id',
  AttributeKeyCounterpartyConnectionID: 'counterparty_connection_id',
};

export const EventAttributeClient = {
  AttributeKeyClientID: 'client_id',
  AttributeKeySubjectClientID: 'subject_client_id',
  AttributeKeyClientType: 'client_type',
  AttributeKeyConsensusHeight: 'consensus_height',
  AttributeKeyConsensusHeights: 'consensus_heights',
  AttributeKeyHeader: 'header',
  AttributeKeyUpgradeStore: 'upgrade_store',
  AttributeKeyUpgradePlanHeight: 'upgrade_plan_height',
  AttributeKeyUpgradePlanTitle: 'title',
};
