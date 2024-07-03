package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
)

type AuthTokenSchema struct {
	_        struct{} `cbor:",toarray"`
	PolicyId []byte
	Name     []byte
}

func DecodeAuthTokenSchema(authTokenEncoded string) (*AuthTokenSchema, error) {
	var vOutput AuthTokenSchema
	datumBytes, err := hex.DecodeString(authTokenEncoded)
	if err != nil {
		return nil, err
	}

	err = cbor.Unmarshal(datumBytes, &vOutput)
	if err != nil {
		return nil, err
	}
	return &vOutput, nil
}
