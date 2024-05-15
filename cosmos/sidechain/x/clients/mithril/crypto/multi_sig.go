package crypto

import (
	"crypto/rand"
	"fmt"
	"hash"

	blst "github.com/supranational/blst/bindings/go"
)

type BlstVk = blst.P1Affine

type BlstSig = blst.P2Affine

type BlstSk = blst.SecretKey

// / MultiSig secret key, which is a wrapper over the BlstSk type from the blst
// / library.
type SigningKey struct {
	*BlstSk
}

// / MultiSig verification key, which is a wrapper over the BlstVk (element in G2)
// / from the blst library.
type VerificationKey struct {
	*BlstVk
}

// / MultiSig proof of possession, which contains two elements from G1. However,
// / the two elements have different types: `k1` is represented as a BlstSig
// / as it has the same structure, and this facilitates its verification. On
// / the other hand, `k2` is a G1 point, as it does not share structure with
// / the BLS signature, and we need to have an ad-hoc verification mechanism.
type ProofOfPossession struct {
	K1 *BlstSig
	K2 *blst.P1
}

// / MultiSig public key, contains the verification key and the proof of possession.
type VerificationKeyPoP struct {
	/// The verification key.
	VK *VerificationKey
	/// Proof of Possession.
	POP *ProofOfPossession
}

type Signature struct {
	*BlstSig
}

// / ====================== SigningKey implementation ======================
// / Generate a secret key
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

// / Sign a message with the given secret key
func (sk *SigningKey) Sign(msg []byte) *Signature {
	var dst = []byte("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_")
	sig := new(BlstSig).Sign(sk.BlstSk, msg, dst)
	return &Signature{
		BlstSig: sig,
	}
}

// / Convert the secret key into byte string.
func (sk *SigningKey) ToBytes() [32]byte {
	// TO-DO: Need to try ToBEndian/ToLEndian/Serialize
	return [32]byte(sk.BlstSk.ToBEndian())
}

// / Convert a string of bytes into a `SigningKey`.
// /
// / # Error
// / Fails if the byte string represents a scalar larger than the group order.
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

// / ====================== VerificationKey implementation ======================
// / Convert an `VerificationKey` to its compressed byte representation.
func (vk *VerificationKey) ToBytes() [96]byte {
	return [96]byte(vk.BlstVk.Compress())
}

// / Convert a compressed byte string into a `VerificationKey`.
// /
// / # Error
// / This function fails if the bytes do not represent a compressed point of the prime
// / order subgroup of the curve Bls12-381.
func (vk *VerificationKey) FromBytes(bytes []byte) (*VerificationKey, error) {
	if len(bytes) < 96 {
		return nil, fmt.Errorf("byte slice is too short to represent a valid VerificationKey")
	}

	vk.BlstVk = new(BlstVk).Uncompress(bytes[:96])
	if vk.BlstVk == nil {
		return nil, fmt.Errorf("verification key: invalid verification key bytes, %v", bytes)
	}

	return vk, nil
}

// / Compare two `VerificationKey`. Used for PartialOrd impl, used to order signatures. The comparison
// / function can be anything, as long as it is consistent.
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

// / Convert a secret key into an `MspMvk`. This is performed by computing
// / `MspMvk = g2 * sk`, where `g2` is the generator in G2. We can use the
// / blst built-in function `sk_to_pk`.
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
