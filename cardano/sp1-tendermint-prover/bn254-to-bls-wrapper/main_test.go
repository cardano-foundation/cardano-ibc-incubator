package main

import (
	"bytes"
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bls12-381"
)

func TestCardanoCommitmentHasherAcceptsSplitWrites(t *testing.T) {
	_, _, generator, _ := bls12381.Generators()
	raw := generator.RawBytes()

	oneWrite := newCardanoCommitmentHasher()
	_, _ = oneWrite.Write(raw[:])
	want := oneWrite.Sum(nil)

	splitWrites := newCardanoCommitmentHasher()
	_, _ = splitWrites.Write(raw[:31])
	_, _ = splitWrites.Write(raw[31:])
	got := splitWrites.Sum(nil)
	if !bytes.Equal(got, want) {
		t.Fatalf("split transcript hash %x does not match one-write hash %x", got, want)
	}
	if new(big.Int).SetBytes(got).Cmp(ecc.BLS12_381.ScalarField()) >= 0 {
		t.Fatalf("masked digest is outside the BLS12-381 scalar field: %x", got)
	}
}

func TestCardanoCommitmentDigestMatchesAikenFixture(t *testing.T) {
	compressed, err := hex.DecodeString("a751fcd6a58236d2744926eeb8bca2d23713bd32201496aae9c501636cbeb39ca4612ee8a5c0c2a8007d849ecfec8585")
	if err != nil {
		t.Fatal(err)
	}
	var commitment bls12381.G1Affine
	read, err := commitment.SetBytes(compressed)
	if err != nil {
		t.Fatal(err)
	}
	if read != len(compressed) {
		t.Fatalf("decoded %d of %d commitment bytes", read, len(compressed))
	}
	digest, err := cardanoCommitmentDigest(commitment.Marshal())
	if err != nil {
		t.Fatal(err)
	}
	const want = "1589d10f2d7b601456fe122e5a84cecdd1a5ff7aee0f80ee55e3e7494106dc81"
	if hex.EncodeToString(digest[:]) != want {
		t.Fatalf("commitment digest %x does not match %s", digest, want)
	}
}
