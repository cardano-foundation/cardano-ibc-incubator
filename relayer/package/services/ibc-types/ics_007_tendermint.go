package ibc_types

type HeightSchema struct {
	_              struct{} `cbor:",toarray"`
	RevisionNumber uint64
	RevisionHeight uint64
}
