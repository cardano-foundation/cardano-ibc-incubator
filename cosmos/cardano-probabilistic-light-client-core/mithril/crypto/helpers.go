package crypto

import (
	"encoding/binary"
	"math"
	"math/big"
	"sync"
	"sync/atomic"

	blst "github.com/supranational/blst/bindings/go"
)

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

func toByteSlice(indices []uint64) []byte {
	result := make([]byte, 8*len(indices))
	for i, val := range indices {
		binary.BigEndian.PutUint64(result[i*8:], val)
	}
	return result
}

// machineEpsilon is f64::EPSILON, the tolerance mithril-stm uses for phi_f = 1.
const machineEpsilon = 2.220446049250313e-16

// EvLtPhi reports whether the lottery value ev wins for a party holding stake
// of totalStake, that is whether ev/2^512 < 1 - (1 - phiF)^(stake/totalStake).
// It follows mithril-stm's default num-integer backend: ev is read
// little-endian, c = ln(1 - phiF), and 2^512/(2^512 - ev) < exp(-w*c) is decided
// by an exact Taylor expansion with an early stop. The logarithm is correctly
// rounded with exact arithmetic, so every processor reaches the same result.
func EvLtPhi(phiF float64, ev []byte, stake Stake, totalStake Stake) bool {
	if totalStake == 0 || len(ev) != 64 {
		return false
	}
	if math.Abs(phiF-1.0) < machineEpsilon {
		return true
	}
	if !(phiF > 0 && phiF <= 1) {
		return false
	}
	littleEndian := make([]byte, len(ev))
	for i, b := range ev {
		littleEndian[len(ev)-1-i] = b
	}
	evMax := new(big.Int).Lsh(big.NewInt(1), 512)
	q := new(big.Rat).SetFrac(evMax, new(big.Int).Sub(evMax, new(big.Int).SetBytes(littleEndian)))
	c := lotteryLog(phiF)
	if c == nil {
		return false
	}
	w := new(big.Rat).SetFrac(new(big.Int).SetUint64(uint64(stake)), new(big.Int).SetUint64(uint64(totalStake)))
	x := new(big.Rat).Neg(new(big.Rat).Mul(w, c))
	return taylorComparison(1000, q, x)
}

// lotteryLogs caches c = ln(1 - phiF) per phiF. Only authenticated
// parameters reach the lottery, so there are only a few distinct values.
var lotteryLogs sync.Map

const maxLotteryLogs = 64

var lotteryLogCount atomic.Int64

// lotteryLog returns c as an exact rational. Callers must not modify it.
func lotteryLog(phiF float64) *big.Rat {
	key := math.Float64bits(phiF)
	if cached, ok := lotteryLogs.Load(key); ok {
		return cached.(*big.Rat)
	}
	c := new(big.Rat).SetFloat64(correctlyRoundedLog(1.0 - phiF))
	if c != nil && lotteryLogCount.Load() < maxLotteryLogs {
		if _, loaded := lotteryLogs.LoadOrStore(key, c); !loaded {
			lotteryLogCount.Add(1)
		}
	}
	return c
}

// correctlyRoundedLog returns ln(x) for x in (0, 1) rounded to the nearest
// binary64. math.Log can differ in its last bit between architectures, because
// the compiler may fuse its multiply-adds on some of them.
func correctlyRoundedLog(x float64) float64 {
	const precision = 256
	mantissa, exponent := math.Frexp(x)
	result := new(big.Float).SetPrec(precision).SetInt64(int64(exponent))
	result.Mul(result, atanhSeriesLog(new(big.Float).SetPrec(precision).SetInt64(2), precision))
	result.Add(result, atanhSeriesLog(new(big.Float).SetPrec(precision).SetFloat64(mantissa), precision))
	value, _ := result.Float64()
	return value
}

// atanhSeriesLog returns ln(m) = 2 atanh((m-1)/(m+1)) for m in [1/2, 2].
func atanhSeriesLog(m *big.Float, precision uint) *big.Float {
	one := new(big.Float).SetPrec(precision).SetInt64(1)
	z := new(big.Float).SetPrec(precision).Quo(
		new(big.Float).SetPrec(precision).Sub(m, one),
		new(big.Float).SetPrec(precision).Add(m, one),
	)
	z2 := new(big.Float).SetPrec(precision).Mul(z, z)
	sum := new(big.Float).SetPrec(precision).Set(z)
	power := new(big.Float).SetPrec(precision).Set(z)
	for n := int64(3); z.Sign() != 0; n += 2 {
		power.Mul(power, z2)
		term := new(big.Float).SetPrec(precision).Quo(power, new(big.Float).SetPrec(precision).SetInt64(n))
		if term.Sign() == 0 || term.MantExp(nil) < sum.MantExp(nil)-int(precision)-8 {
			break
		}
		sum.Add(sum, term)
	}
	return sum.Mul(sum, new(big.Float).SetPrec(precision).SetInt64(2))
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
