package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
)

type ConnectionDatumSchema struct {
	_ struct{} `cbor:",toarray"`
}

type ConnectionDatum struct {
	_     struct{} `cbor:",toarray"`
	State ConnectionEndDatum
	Token AuthTokenSchema
}

type VersionDatum struct {
	_          struct{} `cbor:",toarray"`
	Identifier []byte
	Features   [][]byte
}

type CounterpartyDatum struct {
	_            struct{} `cbor:",toarray"`
	ClientId     []byte
	ConnectionId []byte
	Prefix       MerklePrefixDatum
}

type MerklePrefixDatum struct {
	_         struct{} `cbor:",toarray"`
	KeyPrefix []byte
}

func DecodeConnectionDatumSchema(connectionDatumEncoded string) (*ConnectionDatumSchema, error) {
	var vOutput ConnectionDatumSchema
	datumBytes, err := hex.DecodeString(connectionDatumEncoded)
	if err != nil {
		return nil, err
	}

	err = cbor.Unmarshal(datumBytes, &vOutput)
	if err != nil {
		return nil, err
	}
	return &vOutput, nil
}
