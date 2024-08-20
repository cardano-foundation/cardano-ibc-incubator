package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
	"reflect"
)

type MintConnectionRedeemerType int

const (
	ConnOpenInit MintConnectionRedeemerType = 121
	ConnOpenTry  MintConnectionRedeemerType = 122
)

type SpendConnectionRedeemerType int

const (
	ConnOpenAck     SpendConnectionRedeemerType = 121
	ConnOpenConfirm SpendConnectionRedeemerType = 122
)

type SpendConnectionRedeemerConnOpenAck struct {
	_                       struct{} `cbor:",toarray"`
	CounterpartyClientState MithrilClientStateSchema
	ProofTry                MerkleProofSchema
	ProofClient             MerkleProofSchema
	ProofHeight             HeightSchema
}

type SpendConnectionRedeemerConnOpenConfirm struct {
	_           struct{} `cbor:",toarray"`
	ProofAck    MerkleProofSchema
	ProofHeight HeightSchema
}

type MintConnectionRedeemerConnOpenInit struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
}

type MintConnectionRedeemerConnOpenTry struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
	ClientState      MithrilClientStateSchema
	ProofInit        MerkleProofSchema
	ProofClient      MerkleProofSchema
	ProofHeight      HeightSchema
}

type MintConnectionRedeemerSchema struct {
	Type  MintConnectionRedeemerType
	Value interface{}
}

type SpendConnectionRedeemerSchema struct {
	Type  SpendConnectionRedeemerType
	Value interface{}
}

func DecodeMintConnectionRedeemerSchema(mintConnEncoded string) (MintConnectionRedeemerSchema, error) {
	datumBytes, _ := hex.DecodeString(mintConnEncoded)
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(MintConnectionRedeemerConnOpenInit{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(MintConnectionRedeemerConnOpenTry{}), // your custom type
		122, // CBOR tag number for your custom type
	)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)

	var result interface{}
	err = dm.Unmarshal(datumBytes, &result)
	if err != nil {
		return MintConnectionRedeemerSchema{}, err
	}
	var mintConnRedeemer MintConnectionRedeemerSchema
	switch result.(type) {
	case MintConnectionRedeemerConnOpenInit: // custom type
		mintConnRedeemer.Type = ConnOpenInit
		mintConnRedeemer.Value = result.(MintConnectionRedeemerConnOpenInit)
	case MintConnectionRedeemerConnOpenTry:
		mintConnRedeemer.Type = ConnOpenTry
		mintConnRedeemer.Value = result.(MintConnectionRedeemerConnOpenTry)
	}
	return mintConnRedeemer, nil
}

func DecodeSpendConnectionRedeemerSchema(spendConnEncoded string) (SpendConnectionRedeemerSchema, error) {
	datumBytes, _ := hex.DecodeString(spendConnEncoded)
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendConnectionRedeemerConnOpenAck{}), // your custom type
		121, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(SpendConnectionRedeemerConnOpenConfirm{}), // your custom type
		122, // CBOR tag number for your custom type
	)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)

	var result interface{}
	err = dm.Unmarshal(datumBytes, &result)
	if err != nil {
		return SpendConnectionRedeemerSchema{}, err
	}
	var spendConnRedeemer SpendConnectionRedeemerSchema
	switch result.(type) {
	case SpendConnectionRedeemerConnOpenAck: // custom type
		spendConnRedeemer.Type = ConnOpenAck
		spendConnRedeemer.Value = result.(SpendConnectionRedeemerConnOpenAck)
	case SpendConnectionRedeemerConnOpenConfirm:
		spendConnRedeemer.Type = ConnOpenConfirm
		spendConnRedeemer.Value = result.(SpendConnectionRedeemerConnOpenConfirm)
	}
	return spendConnRedeemer, nil
}
