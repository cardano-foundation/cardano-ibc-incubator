package probabilisticcore

import (
	"encoding/hex"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"golang.org/x/crypto/blake2b"
)

func TestEncodeNativeVerifiedBlockBodyHexStripsTaggedMetadata(t *testing.T) {
	bodyCbor := []byte{0xa0}
	witnessCbor := []byte{0xa0}
	taggedMetadataCbor := []byte{0xd9, 0x01, 0x03, 0xa1, 0x00, 0x01}

	var metadata cbor.LazyValue
	if err := metadata.UnmarshalCBOR(taggedMetadataCbor); err != nil {
		t.Fatalf("metadata unmarshal: %v", err)
	}

	bodyHex, err := EncodeNativeVerifiedBlockBodyHex(
		1,
		func(int) []byte { return bodyCbor },
		func(int) []byte { return witnessCbor },
		map[uint]*cbor.LazyValue{0: &metadata},
	)
	if err != nil {
		t.Fatalf("EncodeNativeVerifiedBlockBodyHex: %v", err)
	}

	bodyBytes, err := hex.DecodeString(bodyHex)
	if err != nil {
		t.Fatalf("decode body hex: %v", err)
	}
	var txsRaw [][]string
	if _, err := cbor.Decode(bodyBytes, &txsRaw); err != nil {
		t.Fatalf("decode native body wrapper: %v", err)
	}
	if len(txsRaw) != 1 {
		t.Fatalf("expected 1 tx, got %d", len(txsRaw))
	}
	if got, want := txsRaw[0][2], "a10001"; got != want {
		t.Fatalf("metadata mismatch: got %s want %s", got, want)
	}
}

func TestVerifyRawBlockBodyUsesEncodedWitnessShape(t *testing.T) {
	fields := rawBlockBodyFields{
		transactionBodies:      []byte{0x81, 0xa0},
		transactionWitnessSets: []byte{0xa1, 0x00, 0xa0},
		transactionMetadataSet: []byte{0xa0},
		invalidTransactions:    []byte{0x80},
	}

	expectedHash := rawBodyHash(fields)
	isValid, err := verifyRawBlockBody(fields, hex.EncodeToString(expectedHash[:]))
	if err != nil {
		t.Fatalf("verifyRawBlockBody: %v", err)
	}
	if !isValid {
		t.Fatal("expected raw body fields to verify")
	}

	arrayWitnessFields := fields
	arrayWitnessFields.transactionWitnessSets = []byte{0x81, 0xa0}
	isValid, err = verifyRawBlockBody(arrayWitnessFields, hex.EncodeToString(expectedHash[:]))
	if err != nil {
		t.Fatalf("verifyRawBlockBody with array witnesses: %v", err)
	}
	if isValid {
		t.Fatal("expected changed witness field encoding to produce a different body hash")
	}
}

func TestDecodeBabbageWitnessSetsPreservesRawRedeemerMap(t *testing.T) {
	rawWitnessSets := []byte{0x81, 0xa1, 0x05, 0xa0}

	witnessSets, err := decodeBabbageWitnessSets(rawWitnessSets, 1)
	if err != nil {
		t.Fatalf("decodeBabbageWitnessSets: %v", err)
	}
	if got, want := hex.EncodeToString(witnessSets[0].Cbor()), "a105a0"; got != want {
		t.Fatalf("witness set cbor mismatch: got %s want %s", got, want)
	}
}

func rawBodyHash(fields rawBlockBodyFields) [32]byte {
	transactionBodiesHash := blake2b.Sum256(fields.transactionBodies)
	transactionWitnessSetsHash := blake2b.Sum256(fields.transactionWitnessSets)
	transactionMetadataSetHash := blake2b.Sum256(fields.transactionMetadataSet)
	invalidTransactionsHash := blake2b.Sum256(fields.invalidTransactions)

	serialized := make([]byte, 0, 32*4)
	serialized = append(serialized, transactionBodiesHash[:]...)
	serialized = append(serialized, transactionWitnessSetsHash[:]...)
	serialized = append(serialized, transactionMetadataSetHash[:]...)
	serialized = append(serialized, invalidTransactionsHash[:]...)
	return blake2b.Sum256(serialized)
}
