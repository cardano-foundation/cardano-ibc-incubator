package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
)

type ClientDatumSchema struct {
	_     struct{} `cbor:",toarray"`
	State ClientDatumStateSchema
	Token TokenDatum
}
type TokenDatum struct {
	_        struct{} `cbor:",toarray"`
	PolicyId []byte
	Name     []byte
}

type ClientDatumStateSchema struct {
	_               struct{} `cbor:",toarray"`
	ClientState     ClientStateDatumSchema
	ConsensusStates map[HeightSchema]ConsensusStateDatumSchema
}

type ClientStateDatumSchema struct {
	_               struct{} `cbor:",toarray"`
	ChainId         []byte
	TrustLevel      TrustLevelDatum
	TrustingPeriod  uint64
	UnbondingPeriod uint64
	MaxClockDrift   uint64
	FrozenHeight    HeightSchema
	LatestHeight    HeightSchema
	ProofSpecs      []ProofSpecsDatum
}
type TrustLevelDatum struct {
	_           struct{} `cbor:",toarray"`
	Numerator   uint64
	Denominator uint64
}
type ProofSpecsDatum struct {
	_         struct{} `cbor:",toarray"`
	LeafSpec  LeafSpecDatum
	InnerSpec InnerSpecDatum
	MaxDepth  int32
	MinDepth  int32
	// (PrehashKeyBeforeComparison.(cbor.Tag)).Number => False: 121, True: 122
	PrehashKeyBeforeComparison interface{}
}
type LeafSpecDatum struct {
	_            struct{} `cbor:",toarray"`
	Hash         int32
	PrehashKey   int32
	PrehashValue int32
	Length       int32
	Prefix       []byte
}
type InnerSpecDatum struct {
	_               struct{} `cbor:",toarray"`
	ChildOrder      []int32
	ChildSize       int32
	MinPrefixLength int32
	MaxPrefixLength int32
	EmptyChild      []byte
	Hash            int32
}
type ConsensusStateDatumSchema struct {
	_                  struct{} `cbor:",toarray"`
	Timestamp          uint64
	NextValidatorsHash []byte
	Root               RootHashInDatum
}
type RootHashInDatum struct {
	_    struct{} `cbor:",toarray"`
	Hash []byte
}

func DecodeClientDatumSchema(datumEncoded string) (*ClientDatumSchema, error) {
	var vOutput ClientDatumSchema
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
