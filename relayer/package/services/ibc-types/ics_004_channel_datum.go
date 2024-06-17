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
	Ordering       ChannelState
	Counterparty   ChannelCounterpartyDatum
	ConnectionHops [][]byte
	Version        []byte
}
type ChannelCounterpartyDatum struct {
	_         struct{} `cbor:",toarray"`
	PortId    []byte
	ChannelId []byte
}

type ChannelState int32

const (
	ChannelStateUninitialized ConnectionEndState = 0
	ChannelStateInit          ConnectionEndState = 1
	ChannelStateTryOpen       ConnectionEndState = 2
	ChannelStateOpen          ConnectionEndState = 3
	ChannelStateClose         ConnectionEndState = 4
)

func (c *ChannelState) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelState(ChannelStateUninitialized)), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelState(ChannelStateInit)), // your custom type
		122, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelState(ChannelStateTryOpen)), // your custom type
		123, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelState(ChannelStateOpen)), // your custom type
		124, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ChannelState(ChannelStateClose)), // your custom type
		125, // CBOR tag number for your custom type
	)
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(data, &result)
	if err != nil {
		return err
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
