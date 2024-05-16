package crypto

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"hash"

	blst "github.com/supranational/blst/bindings/go"
	"golang.org/x/crypto/blake2b"
)

var POP = []byte("PoP")

type BlstVk = blst.P1Affine

type BlstSig = blst.P2Affine

type BlstSk = blst.SecretKey

type AggregateSignature = blst.P2Aggregate

// MultiSig secret key, which is a wrapper over the BlstSk type from the blst
// library.
type SigningKey struct {
	*BlstSk
}

// MultiSig verification key, which is a wrapper over the BlstVk (element in G2)
// from the blst library.
type VerificationKey struct {
	*BlstVk
}

// MultiSig proof of possession, which contains two elements from G1. However,
// the two elements have different types: `k1` is represented as a BlstSig
// as it has the same structure, and this facilitates its verification. On
// the other hand, `k2` is a G1 point, as it does not share structure with
// the BLS signature, and we need to have an ad-hoc verification mechanism.
type ProofOfPossession struct {
	K1 *BlstSig
	K2 *blst.P1
}

// MultiSig public key, contains the verification key and the proof of possession.
type VerificationKeyPoP struct {
	/// The verification key.
	VK *VerificationKey
	/// Proof of Possession.
	POP *ProofOfPossession
}

type Signature struct {
	*BlstSig
}

// ====================== SigningKey implementation ======================
// Generate a secret key
func Gen() (*SigningKey, error) {
	ikm := make([]byte, 32)
	_, err := rand.Read(ikm)
	if err != nil {
		return nil, err
	}
	return &SigningKey{
		BlstSk: blst.KeyGen(ikm),
	}, nil
}

// Sign a message with the given secret key
func (sk *SigningKey) Sign(msg []byte) *Signature {
	var dst = []byte("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_")
	sig := new(BlstSig).Sign(sk.BlstSk, msg, dst)
	return &Signature{
		BlstSig: sig,
	}
}

// Convert the secret key into byte string.
func (sk *SigningKey) ToBytes() []byte {
	// TO-DO: Need to try ToBEndian/ToLEndian/Serialize
	return sk.BlstSk.ToBEndian()
}

// Convert a string of bytes into a `SigningKey`.
//
// # Error
// Fails if the byte string represents a scalar larger than the group order.
func (sk *SigningKey) FromBytes(bytes []byte) (*SigningKey, error) {
	if len(bytes) < 32 {
		return nil, fmt.Errorf("input bytes too short, expected at least 32 bytes")
	}

	// TO-DO: Need to try FromBEndian/FromLEndian/Deserialize
	sk.BlstSk = new(BlstSk).FromBEndian(bytes[:32])
	if sk.BlstSk == nil {
		return nil, fmt.Errorf("invalid signing key bytes")
	}
	return sk, nil
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
	if len(bytes) < 96 {
		return nil, fmt.Errorf("byte slice is too short to represent a valid VerificationKey")
	}

	vk.BlstVk = new(BlstVk).Uncompress(bytes[:96])
	if vk.BlstVk == nil || !vk.BlstVk.KeyValidate() {
		return nil, fmt.Errorf("verification key: invalid verification key bytes, %v", bytes)
	}

	return vk, nil
}

// Compare two `VerificationKey`. Used for PartialOrd impl, used to order signatures. The comparison
// function can be anything, as long as it is consistent.
func (vk *VerificationKey) CmpMspMvk(other *VerificationKey) int {
	selfBytes := vk.ToBytes()
	otherBytes := other.ToBytes()

	for i := 0; i < len(selfBytes); i++ {
		if selfBytes[i] < otherBytes[i] {
			return -1
		}
		if selfBytes[i] > otherBytes[i] {
			return 1
		}
	}
	return 0
}

// String provides a string representation of the VerificationKey,
// using its compressed byte format for display.
func (vk *VerificationKey) String() string {
	return fmt.Sprintf("%x", vk.ToBytes())
}

// Hash writes the byte representation of the VerificationKey to the hash.Hash state,
// providing a unique hash for the VerificationKey.
func (vk *VerificationKey) Hash(h hash.Hash) {
	bytes := vk.ToBytes()
	h.Write(bytes[:])
}

// Equals checks if two VerificationKeys are equal based on their byte representation.
func (vk *VerificationKey) Equals(other *VerificationKey) bool {
	return vk.Compare(other) == 0
}

// Compare provides a basic comparison operation on VerificationKeys to allow
// them to be sorted or compared directly. It's analogous to the Rust Ord trait implementation.
func (vk *VerificationKey) Compare(other *VerificationKey) int {
	return vk.CmpMspMvk(other)
}

// Convert a secret key into an `MspMvk`. This is performed by computing
// `MspMvk = g2 * sk`, where `g2` is the generator in G2. We can use the
// blst built-in function `sk_to_pk`.
func (vk *VerificationKey) FromSigningKey(sk *SigningKey) (*VerificationKey, error) {
	vk.BlstVk = new(BlstVk).From(sk.BlstSk)
	if vk.BlstVk == nil {
		return nil, fmt.Errorf("verification key: invalid from signing key, %v", sk)
	}
	return vk, nil
}

// Aggregate sums a slice of VerificationKeys into a single VerificationKey using
// BLS aggregate signature scheme. This is used for creating a combined public key.
func (vk *VerificationKey) AggregateVerificationKeys(keys []*VerificationKey) (*VerificationKey, error) {
	if len(keys) == 0 {
		return nil, fmt.Errorf("cannot aggregate an empty slice of keys")
	}

	blstVks := []*BlstVk{}
	for _, key := range keys {
		blstVks = append(blstVks, key.BlstVk)
	}

	aggregated := new(blst.P1Aggregate)
	if ok := aggregated.Aggregate(blstVks, false); !ok {
		return nil, fmt.Errorf("an mspmvk is always a valid key, this function only fails if keys is empty or if the keys are invalid, none of which can happen")
	}

	vk.BlstVk = aggregated.ToAffine()

	return vk, nil
}

// ====================== VerificationKeyPoP implementation ======================
// / if `e(k1,g2) = e(H_G1("PoP" || mvk),mvk)` and `e(g1,mvk) = e(k2,g2)`
// / are both true, return 1. The first part is a signature verification
// / of message "PoP", while the second we need to compute the pairing
// / manually.
// If we are really looking for performance improvements, we can combine the
// two final exponentiations (for verifying k1 and k2) into a single one.
func (vkp *VerificationKeyPoP) Check() error {
	result := verifyPairing(vkp.VK, vkp.POP)
	if !vkp.POP.K1.Verify(false, vkp.VK.BlstVk, true, POP, nil) || !result {
		fmt.Errorf("multisignature error: invalid key")
	}
	return nil
}

// / Convert to a 144 byte string.
// /
// / # Layout
// / The layout of a `PublicKeyPoP` encoding is
// / * Public key
// / * Proof of Possession
func (vkp *VerificationKeyPoP) ToBytes() [192]byte {
	var vkpBytes [192]byte
	copy(vkpBytes[:96], vkp.VK.ToBytes())  // Assumes ToBytes returns 96 bytes for the VK
	copy(vkpBytes[96:], vkp.POP.ToBytes()) // Assumes ToBytes returns 96 bytes for the POP
	return vkpBytes
}

// / Deserialize a byte string to a `PublicKeyPoP`.
func (vkp *VerificationKeyPoP) FromBytes(bytes []byte) (*VerificationKeyPoP, error) {
	mvk, err := new(VerificationKey).FromBytes(bytes[:96])
	if err != nil {
		return nil, err
	}

	pop, err := new(ProofOfPossession).FromBytes(bytes[96:])
	if err != nil {
		return nil, err
	}

	vkp.VK = mvk
	vkp.POP = pop
	return vkp, nil
}

func (vkp *VerificationKeyPoP) FromSigningKey(sk *SigningKey) (*VerificationKeyPoP, error) {
	mvk, err := new(VerificationKey).FromSigningKey(sk)
	if err != nil {
		return nil, err
	}

	pop, err := new(ProofOfPossession).FromSigningKey(sk)
	if err != nil {
		return nil, err
	}

	vkp.VK = mvk
	vkp.POP = pop
	return vkp, nil
}

// ====================== ProofOfPossession implementation ======================
// / Convert to a 96 byte string.
// /
// / # Layout
// / The layout of a `MspPoP` encoding is
// / * K1 (G1 point)
// / * K2 (G1 point)
func (pop *ProofOfPossession) ToBytes() []byte {
	var popBytes [96]byte
	k1Bytes := pop.K1.Serialize() // Assumes ToBytes returns [48]byte or similar
	copy(popBytes[:48], k1Bytes)

	k2Bytes := compressP1(pop.K2) // Assumes compressP1 returns [48]byte or similar and can error
	copy(popBytes[48:], k2Bytes)

	return popBytes[:]
}

// / Deserialize a byte string to a `PublicKeyPoP`.
func (pop *ProofOfPossession) FromBytes(bytes []byte) (*ProofOfPossession, error) {
	k1 := new(BlstSig).Deserialize(bytes[:48])
	k2, err := uncompressP1(bytes[48:96])
	if err != nil {
		return nil, err
	}

	pop.K1 = k1
	pop.K2 = k2
	return pop, nil
}

// / Convert a secret key into an `MspPoP`. This is performed by computing
// / `k1 =  H_G1(b"PoP" || mvk)` and `k2 = g1 * sk` where `H_G1` hashes into
// / `G1` and `g1` is the generator in `G1`.
func (pop *ProofOfPossession) FromSigningKey(sk *SigningKey) (*ProofOfPossession, error) {
	k1 := new(BlstSig).Sign(sk.BlstSk, POP, nil)
	k2 := scalarToPkInG1(sk)
	pop.K1 = k1
	pop.K2 = k2
	return pop, nil
}

// ====================== Signature implementation ======================
// / Verify a signature against a verification key.
func (s *Signature) Verify(msg []byte, mvk *VerificationKey) error {
	if ok := s.BlstSig.Verify(false, mvk.BlstVk, true, msg, nil); !ok {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

// / Dense mapping function indexed by the index to be evaluated.
// / We hash the signature to produce a 64 bytes integer.
// / The return value of this function refers to
// / `ev = H("map" || msg || index || σ) <- MSP.Eval(msg,index,σ)` given in paper.
func (s *Signature) Eval(msg []byte, index Index) ([64]byte, error) {
	hasher, err := blake2b.New512(nil)
	if err != nil {
		return [64]byte{}, err
	}
	hasher.Write([]byte("map"))
	hasher.Write(msg)
	hasher.Write(s.ToBytes()) // Assumed this method exists and returns a byte slice
	hasher.Write([]byte(fmt.Sprintf("%d", index)))

	var result [64]byte
	copy(result[:], hasher.Sum(nil))
	return result, nil
}

// / Convert an `Signature` to its compressed byte representation.
func (s *Signature) ToBytes() []byte {
	var bytes [48]byte
	copy(bytes[:], s.BlstSig.Serialize()) // Serialize assumed to return the full serialized data
	return bytes[:]
}

// / Convert a string of bytes into a `MspSig`.
// /
// / # Error
// / Returns an error if the byte string does not represent a point in the curve.
func (s *Signature) FromBytes(data []byte) (*Signature, error) {
	if len(data) != 48 {
		return nil, fmt.Errorf("data must be exactly 48 bytes")
	}
	s.BlstSig = new(BlstSig).Deserialize(data)
	return s, nil
}

// / Compare two signatures. Used for PartialOrd impl, used to rank signatures. The comparison
// / function can be anything, as long as it is consistent across different nodes.
func (s *Signature) CmpMsgSig(other *Signature) int {
	selfBytes := s.ToBytes()
	otherBytes := other.ToBytes()

	return bytes.Compare(selfBytes[:], otherBytes[:])
}

// / Aggregate a slice of verification keys and Signatures by first hashing the
// / signatures into random scalars, and multiplying the signature and verification
// / key with the resulting value. This follows the steps defined in Figure 6,
// / `Aggregate` step.
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
	var signatures []*blst.P2Affine
	for index, sig := range sigs {
		hasher := hashedSigs
		indexBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(indexBytes, uint64(index))
		hasher.Write(indexBytes)
		signatures = append(signatures, sig.BlstSig)
		scalars = append(scalars, hasher.Sum(nil)...)
	}

	groupedVks := new(blst.P2)
	groupedSigs := new(blst.P1)

	transmutedVks := make([]*blst.P2, len(vks))
	for i, vk := range vks {
		transmutedVks[i] = vkFromP2Affine(vk)
		groupedVks = groupedVks.Add(transmutedVks)
	}

	transmutedSigs := make([]*blst.P1, len(signatures))
	for i, sig := range signatures {
		transmutedSigs[i] = sigToP1(sig)
		groupedSigs = groupedSigs.Add(transmutedSigs)
	}

	aggrVk := p2AffineToVk(groupedVks.Mult(scalars, 128))
	aggrSig := p1AffineToSig(groupedSigs.Mult(scalars, 128))

	return &VerificationKey{aggrVk}, &Signature{aggrSig}, nil
}

// / Verify a set of signatures with their corresponding verification keys using the
// / aggregation mechanism of Figure 6.
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

// / Batch verify several sets of signatures with their corresponding verification keys.
func (s *Signature) BatchVerifyAggregates(msgs [][]byte, vks []*VerificationKey, sigs []*Signature) error {
	// Collect BLST signatures
	blstSigs := make([]*blst.P2Affine, len(sigs))
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

// Sum aggregates a list of signatures into a single signature.
func (s *Signature) Sum(signatures []*Signature) (*Signature, error) {
	if len(signatures) == 0 {
		return nil, fmt.Errorf("one cannot add an empty vector")
	}

	blstSigs := make([]*blst.P2Affine, len(signatures))
	for i, sig := range signatures {
		blstSigs[i] = sig.BlstSig
	}

	// Aggregate signatures
	aggregateSig := new(AggregateSignature)
	if ok := aggregateSig.Aggregate(blstSigs, false); !ok {
		return nil, fmt.Errorf("invalid aggregate signature")
	}
	s.BlstSig = aggregateSig.ToAffine()

	return s, nil
}

// PartialCmp compares two signatures and returns the comparison result.
func (s *Signature) PartialCmp(other *Signature) int {
	return s.Cmp(other)
}

// Cmp compares two signatures and returns the comparison result.
func (s *Signature) Cmp(other *Signature) int {
	return s.CmpMsgSig(other)
}
