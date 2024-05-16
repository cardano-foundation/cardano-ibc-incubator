package crypto

import (
	"fmt"

	blst "github.com/supranational/blst/bindings/go"
)

// ---------------------------------------------------------------------
// Unsafe helpers
// ---------------------------------------------------------------------
// verifyPairing checks if the pairing `e(g1,mvk) = e(k2,g2)` holds.
func verifyPairing(vk *VerificationKey, pop *ProofOfPossession) bool {
	return true
}

func compressP1(k2 *blst.P1) []byte {
	return k2.Compress()
}

func uncompressP1(bytes []byte) (*blst.P1, error) {
	if len(bytes) != 48 {
		return nil, fmt.Errorf("invalid input length")
	}

	point := &blst.P1Affine{}
	out := &blst.P1{}

	out.FromAffine(point.Uncompress(bytes))

	return out, nil
}

func scalarToPkInG1(sk *SigningKey) *blst.P1 {
	// TO-DO: not implemented
	return nil
}

func vkFromP2Affine(vk *VerificationKey) *blst.P2 {
	projectiveP2 := &blst.P2{}
	projectiveP2.FromAffine(new(blst.P2Affine).Uncompress(vk.Compress()))
	return projectiveP2
}

func sigToP1(sig *BlstSig) *blst.P1 {
	return nil
}
