package crypto

import (
	"encoding/binary"
	"fmt"
	"math"
	"math/big"
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
	projectiveP2.FromAffine(vk.BlstVk)
	return projectiveP2
}

func sigToP1(sig *BlstSig) *blst.P1 {
	projectiveP1 := blst.P1{}
	projectiveP1.FromAffine(sig)
	return &projectiveP1
}

func p2AffineToVk(groupedVks *blst.P2) *BlstVk {
	p2Affine := groupedVks.ToAffine()
	return p2Affine
}

func p1AffineToSig(groupedSigs *blst.P1) *BlstSig {
	p1Affine := groupedSigs.ToAffine()
	return p1Affine
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

func EvLtPhi(phiF float64, ev []byte, stake Stake, totalStake Stake) bool {
	// If phiF = 1, then we automatically break with true
	if math.Abs(phiF-1.0) < math.SmallestNonzeroFloat64 {
		return true
	}

	evMax := new(big.Int).Exp(big.NewInt(2), big.NewInt(512), nil)
	evBigInt := new(big.Int).SetBytes(ev[:])
	evBigInt = evBigInt.Mod(evBigInt, evMax)

	q := new(big.Rat).SetFrac(evMax, new(big.Int).Sub(evMax, evBigInt))

	c := new(big.Rat).SetFloat64(math.Log(1.0 - phiF))
	if c == nil {
		panic("Only fails if the float is infinite or NaN.")
	}

	w := new(big.Rat).SetFrac(big.NewInt(int64(stake)), big.NewInt(int64(totalStake)))
	x := new(big.Rat).Neg(new(big.Rat).Mul(w, c))

	// Now we compute a taylor function that breaks when the result is known.
	return taylorComparison(1000, q, x)
}

func taylorComparison(bound int, cmp, x *big.Rat) bool {
	newX := new(big.Rat).Set(x)
	phi := new(big.Rat).SetInt64(1)
	divisor := new(big.Rat).SetInt64(1)

	for i := 0; i < bound; i++ {
		phi.Add(phi, newX)

		divisor.Add(divisor, big.NewRat(1, 1))
		newX.Mul(newX, x)
		newX.Quo(newX, divisor)

		errorTerm := new(big.Rat).Mul(new(big.Rat).Abs(newX), big.NewRat(3, 1)) // newX * M

		if cmp.Cmp(new(big.Rat).Add(phi, errorTerm)) > 0 {
			return false
		} else if cmp.Cmp(new(big.Rat).Sub(phi, errorTerm)) < 0 {
			return true
		}
	}

	return false
}
