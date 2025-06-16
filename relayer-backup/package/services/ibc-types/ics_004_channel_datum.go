package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
	"reflect"
)

type ChannelDatumSchema struct {
	_      struct{} `cbor:",toarray"`
	State  ChannelStateSchema
	PortId []byte
	Token  AuthTokenSchema
}

type ChannelStateSchema struct {
	_                     struct{} `cbor:",toarray"`
	Channel               ChannelSchema
	NextSequenceSend      uint64
	NextSequenceRecv      uint64
	NextSequenceAck       uint64
	PacketCommitment      map[uint64][]byte
	PacketReceipt         map[uint64][]byte
	PacketAcknowledgement map[uint64][]byte
}

type ChannelSchema struct {
	_ struct{} `cbor:",toarray"`
	// Little hack with this kind of Enum
	// (State.(cbor.Tag)).Number => UNINITIALIZED: 121, INIT: 122, TRYOPEN: 123, OPEN: 124, CLOSED: 125
	State ConnectionEndState
	// Little hack with this kind of Enum
	// (Ordering.(cbor.Tag)).Number => None: 121, Unordered: 122, Ordered: 123
	Ordering       ChannelOrdering
	Counterparty   ChannelCounterpartyDatum
	ConnectionHops [][]byte
	Version        []byte
}

type ChannelCounterpartyDatum struct {
	_         struct{} `cbor:",toarray"`
	PortId    []byte
	ChannelId []byte
}

type ChannelOrdering int32

const (
	ChannelOrderingNone      ChannelOrdering = 0
	ChannelOrderingUnordered ChannelOrdering = 1
	ChannelOrderingOrdered   ChannelOrdering = 2
)

func (c *ChannelOrdering) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelOrdering(ChannelOrderingNone)), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelOrdering(ChannelOrderingUnordered)), // your custom type
		122, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelOrdering(ChannelOrderingOrdered)), // your custom type
		123, // CBOR tag number for your custom type
	)
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(data, &result)
	if err != nil {
		return err
	}

	switch result.(cbor.Tag).Number {
	case 121:
		*c = ChannelOrderingNone
	case 122:
		*c = ChannelOrderingUnordered
	case 123:
		*c = ChannelOrderingOrdered
	}

	return nil
}

func DecodeChannelDatumSchema(channelDatumEncoded string) (*ChannelDatumSchema, error) {
	var vOutput ChannelDatumSchema
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
