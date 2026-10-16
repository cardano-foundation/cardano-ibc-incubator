package crypto

import (
	"encoding/binary"
	"fmt"

	blst "github.com/supranational/blst/bindings/go"
	"golang.org/x/crypto/blake2b"
)

type BlstSig = blst.P1Affine

type BlstVk = blst.P2Affine

type AggregateSignature = blst.P1Aggregate

// MultiSig verification key, which is a wrapper over the BlstVk (element in G2)
// from the blst library.
type VerificationKey struct {
	*BlstVk
}

type Signature struct {
	*BlstSig
}

// ====================== VerificationKey implementation ======================
// Convert an `VerificationKey` to its compressed byte representation.
func (vk *VerificationKey) ToBytes() []byte {
	return vk.BlstVk.Compress()
}

// Convert a compressed byte string into a `VerificationKey`.
//
// # Error
// This function fails if the bytes do not represent a compressed point of the prime
// order subgroup of the curve Bls12-381.
func (vk *VerificationKey) FromBytes(bytes []byte) (*VerificationKey, error) {
	if len(bytes) != 96 {
		return nil, fmt.Errorf("verification key must be exactly 96 bytes")
	}

	vk.BlstVk = new(BlstVk).Uncompress(bytes)
	if vk.BlstVk == nil || !vk.BlstVk.KeyValidate() {
		return nil, fmt.Errorf("verification key: invalid verification key bytes, %v", bytes)
	}

	return vk, nil
}

// ====================== Signature implementation ======================
// Verify a signature against a verification key.
func (s *Signature) Verify(msg []byte, mvk *VerificationKey) error {
	if ok := s.BlstSig.Verify(false, mvk.BlstVk, true, msg, nil); !ok {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

// Dense mapping function indexed by the index to be evaluated.
// We hash the signature to produce a 64 bytes integer.
// The return value of this function refers to
// `ev = H("map" || msg || index || σ) <- MSP.Eval(msg,index,σ)` given in paper.
func (s *Signature) Eval(msg []byte, index Index) ([]byte, error) {
	hasher, err := blake2b.New512(nil)
	if err != nil {
		return nil, err
	}
	hasher.Write([]byte("map"))
	hasher.Write(msg)
	// mithril-stm hashes the index little-endian.
	indexBytes := make([]byte, 8)
	binary.LittleEndian.PutUint64(indexBytes, uint64(index))
	hasher.Write(indexBytes)
	hasher.Write(s.ToBytes())

	var result [64]byte
	copy(result[:], hasher.Sum(nil))
	return result[:], nil
}

// ToBytes returns Mithril's 48-byte compressed G1 signature encoding.
func (s *Signature) ToBytes() []byte {
	var bytes [48]byte
	copy(bytes[:], s.BlstSig.Compress())
	return bytes[:]
}

// Convert a string of bytes into a `MspSig`.
//
// # Error
// Returns an error if the byte string does not represent a point in the curve.
func (s *Signature) FromBytes(data []byte) (*Signature, error) {
	if len(data) != 48 {
		return nil, fmt.Errorf("data must be exactly 48 bytes")
	}
	// As mithril-stm's sig_validate: a subgroup point other than infinity.
	s.BlstSig = new(BlstSig).Uncompress(data)
	if s.BlstSig == nil || !s.BlstSig.SigValidate(true) {
		return nil, fmt.Errorf("signature is not a valid compressed G1 subgroup point")
	}
	return s, nil
}

// Aggregate a slice of verification keys and Signatures by first hashing the
// signatures into random scalars, and multiplying the signature and verification
// key with the resulting value. This follows the steps defined in Figure 6,
// `Aggregate` step.
func (s *Signature) Aggregate(vks []*VerificationKey, sigs []*Signature) (*VerificationKey, *Signature, error) {
	if len(vks) != len(sigs) || len(vks) == 0 {
		return nil, nil, fmt.Errorf("invalid input: number of verification keys and signatures must match and not be empty")
	}

	if len(vks) == 1 {
		return vks[0], sigs[0], nil
	}

	hashedSigs, err := blake2b.New(16, nil)
	if err != nil {
		return nil, nil, err
	}

	for _, sig := range sigs {
		hashedSigs.Write(sig.ToBytes())
	}

	var scalars []byte
	var signatures []*blst.P1Affine
	for index, sig := range sigs {
		hasher := hashedSigs
		indexBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(indexBytes, uint64(index))
		hasher.Write(indexBytes)
		signatures = append(signatures, sig.BlstSig)
		scalars = append(scalars, hasher.Sum(nil)...)
	}

	p1s := []*blst.P1{}
	p2s := []*blst.P2{}

	for _, sig := range signatures {
		p1s = append(p1s, sigToP1(sig))
	}

	for _, vk := range vks {
		p2s = append(p2s, vkFromP2Affine(vk))
	}

	groupedSigs := blst.P1sToAffine(p1s)
	groupedVks := blst.P2sToAffine(p2s)

	aggrSig := p1AffineToSig(groupedSigs.Mult(scalars, 128))
	aggrVk := p2AffineToVk(groupedVks.Mult(scalars, 128))

	return &VerificationKey{aggrVk}, &Signature{aggrSig}, nil
}

// Verify a set of signatures with their corresponding verification keys using the
// aggregation mechanism of Figure 6.
func (s *Signature) VerifyAggregate(msg []byte, vks []*VerificationKey, sigs []*Signature) error {
	aggrVk, aggrSig, err := s.Aggregate(vks, sigs)
	if err != nil {
		return err
	}

	if ok := aggrSig.BlstSig.Verify(false, aggrVk.BlstVk, true, msg, nil); !ok {
		return fmt.Errorf("verify aggregate: invalid signature")
	}
	return nil
}

// Batch verify several sets of signatures with their corresponding verification keys.
func (s *Signature) BatchVerifyAggregates(msgs [][]byte, vks []*VerificationKey, sigs []*Signature) error {
	// Collect BLST signatures
	blstSigs := make([]*blst.P1Affine, len(sigs))
	for i, sig := range sigs {
		blstSigs[i] = sig.BlstSig
	}

	// Aggregate signatures
	aggregateSig := new(AggregateSignature)
	if ok := aggregateSig.Aggregate(blstSigs, false); !ok {
		return fmt.Errorf("invalid aggregate signature")
	}
	batchedSig := aggregateSig.ToAffine()

	// Collect BLST verification keys
	p2Vks := make([]*BlstVk, len(vks))
	for i, vk := range vks {
		p2Vks[i] = vk.BlstVk
	}

	if ok := batchedSig.AggregateVerify(false, p2Vks, true, msgs, nil); !ok {
		return fmt.Errorf("invalid aggregate verification")
	}

	return nil
}
