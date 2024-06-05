package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
)

type ChannelDatumWithPort struct {
	_      struct{} `cbor:",toarray"`
	State  ChannelDatumState
	PortId []byte
	Token  AuthTokenSchema
}

type ChannelDatumState struct {
	_                     struct{} `cbor:",toarray"`
	Channel               ChannelDatum
	NextSequenceSend      uint64
	NextSequenceRecv      uint64
	NextSequenceAck       uint64
	PacketCommitment      map[uint64][]byte
	PacketReceipt         map[uint64][]byte
	PacketAcknowledgement map[uint64][]byte
}

type ChannelDatum struct {
	_ struct{} `cbor:",toarray"`
	// Little hack with this kind of Enum
	// (State.(cbor.Tag)).Number => UNINITIALIZED: 121, INIT: 122, TRYOPEN: 123, OPEN: 124, CLOSED: 125
	State interface{}
	// Little hack with this kind of Enum
	// (Ordering.(cbor.Tag)).Number => None: 121, Unordered: 122, Ordered: 123
	Ordering       interface{}
	Counterparty   ChannelCounterpartyDatum
	ConnectionHops [][]byte
	Version        []byte
}
type ChannelCounterpartyDatum struct {
	_         struct{} `cbor:",toarray"`
	PortId    []byte
	ChannelId []byte
}

func DecodeChannelDatumWithPort(channelDatumEncoded string) (*ChannelDatumWithPort, error) {
	var vOutput ChannelDatumWithPort
	datumBytes, err := hex.DecodeString(channelDatumEncoded)
	if err != nil {
		return nil, err
	}

	err = cbor.Unmarshal(datumBytes, &vOutput)
	if err != nil {
		return nil, err
	}
	return &vOutput, nil
}
