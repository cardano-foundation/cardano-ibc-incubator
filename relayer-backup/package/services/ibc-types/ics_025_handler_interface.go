package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
)

type HandlerStateSchema struct {
	_                      struct{} `cbor:",toarray"`
	NextClientSequence     uint64
	NextConnectionSequence uint64
	NextChannelSequence    uint64
	BoundPort              []uint64
}

type HandlerDatumSchema struct {
	_     struct{} `cbor:",toarray"`
	State HandlerStateSchema
	Token AuthTokenSchema
}

func DecodeHandlerDatumSchema(datumEncoded string) (*HandlerDatumSchema, error) {
	var vOutput HandlerDatumSchema
	datumBytes, err := hex.DecodeString(datumEncoded)
	if err != nil {
		return nil, err
	}

	err = cbor.Unmarshal(datumBytes, &vOutput)
	if err != nil {
		return nil, err
	}
	return &vOutput, nil
}
