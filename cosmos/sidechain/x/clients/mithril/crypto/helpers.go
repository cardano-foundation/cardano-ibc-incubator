package crypto

import (
	"encoding/binary"
	"fmt"
	"math/bits"

	blst "github.com/supranational/blst/bindings/go"
)

// ---------------------------------------------------------------------
// Unsafe helpers
// ---------------------------------------------------------------------
// verifyPairing checks if the pairing `e(g1,mvk) = e(k2,g2)` holds.
func verifyPairing(vk *VerificationKey, pop *ProofOfPossession) bool {
	g1P := blst.P1Generator().ToAffine()
	mvkP := new(blst.P2Affine).Uncompress(vk.BlstVk.Compress())
	mlLhs := blst.Fp12MillerLoop(mvkP, g1P)

	k2P := pop.K2.ToAffine()
	g2P := blst.P2Generator().ToAffine()
	mlRhs := blst.Fp12MillerLoop(g2P, k2P)

	return blst.Fp12FinalVerify(mlLhs, mlRhs)
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
	out := blst.P1{}
	defaultBlstP1Affine := blst.P1Affine{}
	out.FromAffine(defaultBlstP1Affine.From(sk.BlstSk))
	return &out
}

func vkFromP2Affine(vk *VerificationKey) *blst.P2 {
	projectiveP2 := &blst.P2{}
	projectiveP2.FromAffine(new(blst.P2Affine).Uncompress(vk.Compress()))
	return projectiveP2
}

func sigToP1(sig *BlstSig) *blst.P1 {
	projectiveP1 := blst.P1{}
	p1AffineFromBlstSig := new(blst.P1Affine).Uncompress(sig.Compress())
	projectiveP1.FromAffine(p1AffineFromBlstSig)
	return &projectiveP1
}

func p2AffineToVk(groupedVks *blst.P2) *BlstVk {
	affineP2 := groupedVks.ToAffine()
	blstVk := new(blst.P1Affine).Uncompress(affineP2.Compress())
	return blstVk
}

func p1AffineToSig(groupedSigs *blst.P1) *BlstSig {
	affineP1 := groupedSigs.ToAffine()
	blstSig := new(blst.P2Affine).Uncompress(affineP1.Compress())
	return blstSig
}

// ////////////////
// Heap Helpers //
// ////////////////
// parent returns the index of the parent of the given node.
func parent(index uint64) (uint64, error) {
	if index == 0 {
		return 0, fmt.Errorf("the root node does not have a parent")
	}
	return (index - 1) / 2, nil
}

// leftChild returns the index of the left child of the given node.
func leftChild(index uint64) uint64 {
	return (2 * index) + 1
}

// rightChild returns the index of the right child of the given node.
func rightChild(index uint64) uint64 {
	return (2 * index) + 2
}

// sibling returns the index of the sibling of the given node.
func sibling(index uint64) (uint64, error) {
	if index == 0 {
		return 0, fmt.Errorf("the root node does not have a sibling")
	}
	if index%2 == 1 {
		return index + 1, nil
	}
	return index - 1, nil
}

func nextPowerOfTwo(x uint64) uint64 {
	if x < 2 {
		return 1
	}
	return 1 << (64 - bits.LeadingZeros64(x-1))
}

func toByteSlice(indices []uint64) []byte {
	result := make([]byte, 8*len(indices))
	for i, val := range indices {
		binary.BigEndian.PutUint64(result[i*8:], val)
	}
	return result
}
