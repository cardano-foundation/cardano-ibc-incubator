import { gql } from '@apollo/client';

const MESSAGE_FRAGMENT = gql`
  fragment MessageFields on Message {
    id
    nodeId
    chainId
    code
    txHash
    msgIdx
    sender
    msgType
    data
    msgError
    time
    gas
    packet {
      id
      srcChain
      srcPort
      srcChannel
      sequence
      dstChain
      dstPort
      dstChannel
      data
      module
    }
  }
`;

const PACKET_FRAGMENT = gql`
  fragment PacketFragment on Packet {
    id
    srcChain
    srcPort
    srcChannel
    sequence
    dstChain
    dstPort
    dstChannel
    data
    module
    parentPacketId
  }
`;

const PACKET_FRAGMENT_RECURSIVE = gql`
  ${PACKET_FRAGMENT}
  fragment PacketFragmentRecursive on Packet {
    ...PacketFragment
    parentPacket {
      ...PacketFragment
      parentPacket {
        ...PacketFragment
        parentPacket {
          ...PacketFragment
          parentPacket {
            ...PacketFragment
            parentPacket {
              ...PacketFragment
              parentPacket {
                ...PacketFragment
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_MESSAGES_BY_TX_HASH = gql`
  ${MESSAGE_FRAGMENT}
  query GetMsgsByTxHash($txHash: String!) {
    messages(filter: { txHash: { equalTo: $txHash } }, orderBy: TIME_ASC) {
      nodes {
        ...MessageFields
      }
    }
  }
`;

export const GET_MESSAGES_BY_PACKET_ID = gql`
  ${MESSAGE_FRAGMENT}
  query GetMsgsByPacketId($packetId: String!) {
    messages(filter: { packetId: { equalTo: $packetId } }, orderBy: TIME_ASC) {
      nodes {
        ...MessageFields
      }
    }
  }
`;

export const GET_PACKET_BY_PACKET_ID = gql`
  ${PACKET_FRAGMENT_RECURSIVE}
  query GetPacketByPacketId($packetId: String!) {
    packets(filter: { id: { equalTo: $packetId } }) {
      nodes {
        ...PacketFragmentRecursive
      }
    }
  }
`;

export const GET_PACKET_BY_PARENT_PACKET_ID = gql`
  ${PACKET_FRAGMENT_RECURSIVE}
  query GetPacketByParentPacketId($packetId: String!) {
    packets(filter: { parentPacketId: { equalTo: $packetId } }) {
      nodes {
        ...PacketFragmentRecursive
      }
    }
  }
`;

export const GET_PACKET_BY_PARENT_PACKET_ID_SINGLE = gql`
  ${PACKET_FRAGMENT}
  query GetPacketByParentPacketIdSingle($packetId: String!) {
    packets(filter: { parentPacketId: { equalTo: $packetId } }) {
      nodes {
        ...PacketFragment
      }
    }
  }
`;

const PACKET_FLOW_FRAGMENT = gql`
  fragment PacketFlowFragment on PacketFlow {
    id
    fromTxHash
    fromAddress
    fromChainId
    status
    toTxHash
    toAddress
    createTime
    endTime
  }
`;

export const GET_PACKET_FLOWS = gql`
  ${PACKET_FLOW_FRAGMENT}
  query packetFlows($queryFilter: PacketFlowFilter, $first: Int, $offset: Int) {
    packetFlows(
      filter: $queryFilter
      orderBy: CREATE_TIME_DESC
      first: $first
      offset: $offset
    ) {
      totalCount
      nodes {
        ...PacketFlowFragment
      }
    }
  }
`;
