package ibc_types

import (
	"github.com/fxamacker/cbor/v2"
	"reflect"
)

type MerkleProofSchema struct {
	_      struct{} `cbor:",toarray"`
	Proofs []CommitmentProofSchema
}

type CommitmentProofSchema struct {
	_     struct{}                   `cbor:",toarray"`
	Proof CommitmentProofProofSchema `cbor:"proof"`
}

type CommitmentProofProofSchema struct {
	_     struct{} `cbor:",toarray"`
	Value interface{}
	Type  string
}

type CommitmentProofBatch []byte
type CommitmentProofCompressed []byte

// Define custom unmarshal function to handle the enum-like structure
func (cp *CommitmentProofProofSchema) UnmarshalCBOR(data []byte) error {
	var rs interface{}
	cbor.Unmarshal(data, &rs)
	//var raw CommitmentProofProofSchema
	tags := cbor.NewTagSet()
	err := tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(CommitmentProofExist{}), // your custom type
		121,                                    // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(CommitmentProofNonexist{}), // your custom type
		122, // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(CommitmentProofBatch("")), // your custom type
		123,                                      // CBOR tag number for your custom type
	)
	err = tags.Add(
		cbor.TagOptions{EncTag: cbor.EncTagRequired, DecTag: cbor.DecTagRequired},
		reflect.TypeOf(CommitmentProofCompressed("")), // your custom type
		124, // CBOR tag number for your custom type
	)

	// Create decoding mode with TagSet
	dm, err := cbor.DecOptions{}.DecModeWithTags(tags)
	var result interface{}
	err = dm.Unmarshal(data, &result)

	if err != nil {
		return err
	}
	switch result.(type) {
	case CommitmentProofExist:
		//bytes, _ := json.Marshal(result)
		//var commitmentProofExist CommitmentProofExist
		//json.Unmarshal(bytes, &commitmentProofExist)
		cp.Value = &result
		cp.Type = "CommitmentProofExist"
	case CommitmentProofNonexist:
		//bytes, _ := json.Marshal(result)
		//var commitmentProofNonexist CommitmentProofNonexist
		//json.Unmarshal(bytes, &commitmentProofNonexist)
		cp.Value = &result
		cp.Type = "CommitmentProofNonexist"
	case CommitmentProofBatch:
		cp.Value = "CommitmentProofBatch"
		cp.Type = "CommitmentProofBatch"
	case CommitmentProofCompressed:
		cp.Value = "CommitmentProofCompressed"
		cp.Type = "CommitmentProofCompressed"
	}
	return nil
}

type CommitmentProofExist struct {
	_     struct{} `cbor:",toarray"`
	Exist ExistenceProofSchema
}

type LeafOpSchema struct {
	_            struct{} `cbor:",toarray"`
	Hash         uint64
	PrehashKey   uint64
	PrehashValue uint64
	Length       uint64
	Prefix       []byte
}

type ExistenceProofSchema struct {
	_     struct{} `cbor:",toarray"`
	Key   []byte
	Value []byte
	Leaf  LeafOpSchema
	Path  []InnerOpSchema
}

type InnerOpSchema struct {
	_      struct{} `cbor:",toarray"`
	Hash   uint64
	Prefix []byte
	Suffix []byte
}

type CommitmentProofNonexist struct {
	_        struct{} `cbor:",toarray"`
	NonExist NonExistenceProofSchema
}

type NonExistenceProofSchema struct {
	_     struct{} `cbor:",toarray"`
	Key   []byte
	Left  ExistenceProofSchema
	Right ExistenceProofSchema
}
