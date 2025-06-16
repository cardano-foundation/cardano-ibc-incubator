package ibc_types

import (
	"github.com/fxamacker/cbor/v2"
	"reflect"
)

type ConnectionEndDatum struct {
	_        struct{} `cbor:",toarray"`
	ClientId []byte
	Versions []VersionDatum
	// Little hack with this kind of Enum
	// (State.(cbor.Tag)).Number => UNINITIALIZED: 121, INIT: 122, TRYOPEN: 123, OPEN: 124
	State        ConnectionEndState
	Counterparty CounterpartyDatum
	DelayPeriod  uint64
}

type ConnectionEndState int32

const (
	ConnectionStateUninitialized ConnectionEndState = 0
	ConnectionStateInit          ConnectionEndState = 1
	ConnectionStateTryOpen       ConnectionEndState = 2
	ConnectionStateOpen          ConnectionEndState = 3
)

func (c *ConnectionEndState) UnmarshalCBOR(data []byte) error {
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ConnectionEndState(ConnectionStateUninitialized)), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ConnectionEndState(ConnectionStateInit)), // your custom type
		122, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ConnectionEndState(ConnectionStateTryOpen)), // your custom type
		123, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(ConnectionEndState(ConnectionStateOpen)), // your custom type
		124, // CBOR tag number for your custom type
	)
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(data, &result)
	if err != nil {
		return err
	}
	switch result.(cbor.Tag).Number {
	case 121:
		*c = ConnectionStateUninitialized
	case 122:
		*c = ConnectionStateInit
	case 123:
		*c = ConnectionStateTryOpen
	case 124:
		*c = ConnectionStateOpen
	}

	return nil
}
