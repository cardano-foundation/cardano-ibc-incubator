package ibc_types

type MithrilHeightSchema struct {
	_              struct{} `cbor:",toarray"`
	RevisionNumber uint64
	RevisionHeight uint64
}

type MithrilProtocolParametersSchema struct {
	_    struct{} `cbor:",toarray"`
	K    uint64
	M    uint64
	PhiF *FractionSchema
}

type FractionSchema struct {
	_           struct{} `cbor:",toarray"`
	Numerator   uint64
	Denominator uint64
}

type MithrilClientStateSchema struct {
	_                  struct{} `cbor:",toarray"`
	ChainId            []byte
	LatestHeight       *MithrilHeightSchema
	FrozenHeight       *MithrilHeightSchema
	CurrentEpoch       uint64
	TrustingPeriod     uint64
	ProtocolParameters *MithrilProtocolParametersSchema
	UpgradePath        [][]byte
}
