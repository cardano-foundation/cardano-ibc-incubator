package types

import (
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
)

type Proof struct {
	Proof  []byte
	Height clienttypes.Height
}

type PacketInfo struct {
	// Height at which packet event was emitted height
	Height uint64 `json:"height,omitempty"`
	// Packet sequence
	Sequence uint64 `json:"sequence,omitempty"`
	// Source port
	SourcePort string `json:"source_port,omitempty"`
	// Source channel
	SourceChannel string `json:"source_channel,omitempty"`
	// Destination port
	DestinationPort string `json:"destination_port,omitempty"`
	// Destination channel
	DestinationChannel string `json:"destination_channel,omitempty"`
	// Channel order
	ChannelOrder string `json:"channel_order,omitempty"`
	// Opaque packet data
	Data []byte `json:"data,omitempty"`
	// Timeout height
	TimeoutHeight clienttypes.Height `json:"timeout_height,omitempty"`
	// Timeout timestamp
	TimeoutTimestamp uint64 `json:"timeout_timestamp,omitempty"`
	// Packet acknowledgement
	Ack []byte `json:"ack,omitempty"`
}

type ConnHandshakeProof struct {
	// Protobuf encoded client state
	ClientState clienttypes.IdentifiedClientState
	// Trie proof for connection state, client state and consensus state
	Proof []byte
	// Proof height
	Height clienttypes.Height
}

type BlockNumberOrHash struct {
	Hash   *string `json:"hash,omitempty"`
	Number uint32  `json:"number,omitempty"`
}

type IBCEventsQueryResult []map[string]interface{}
