package crypto

import (
	blst "github.com/supranational/blst/bindings/go"
)

type PublicKey = blst.P1Affine

type Signature = blst.P2Affine

// / MultiSig secret key, which is a wrapper over the BlstSk type from the blst
// / library.
type SigningKey struct {
	blst.SecretKey
}

// / MultiSig verification key, which is a wrapper over the BlstVk (element in G2)
// / from the blst library.
type VerificationKey struct {
	PublicKey
}

// / MultiSig proof of possession, which contains two elements from G1. However,
// / the two elements have different types: `k1` is represented as a BlstSig
// / as it has the same structure, and this facilitates its verification. On
// / the other hand, `k2` is a G1 point, as it does not share structure with
// / the BLS signature, and we need to have an ad-hoc verification mechanism.
type ProofOfPossession struct {
	K1 Signature
	K2 blst.P1
}

// / MultiSig public key, contains the verification key and the proof of possession.
type VerificationKeyPoP struct {
	VK  VerificationKey
	POP ProofOfPossession
}
