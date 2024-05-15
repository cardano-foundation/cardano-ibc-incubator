package crypto

import (
	"crypto/rand"
	"errors"

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
	return [32]byte(sk.BlstSk.Serialize())
}

// / Convert a string of bytes into a `SigningKey`.
// /
// / # Error
// / Fails if the byte string represents a scalar larger than the group order.
func (sk *SigningKey) FromBytes(bytes []byte) (*SigningKey, error) {
	if len(bytes) < 32 {
		return nil, errors.New("input bytes too short, expected at least 32 bytes")
	}

	sk.BlstSk = new(BlstSk).Deserialize(bytes[:32])
	if sk.BlstSk == nil {
		return nil, errors.New("invalid signing key bytes")
	}
	return sk, nil
}
