package probabilisticcore

import (
	"fmt"
	"math/big"

	"golang.org/x/crypto/blake2b"
)

const (
	fixedE34MaxIterations = 1000
	fixedE34MaxBounds     = 128
)

var (
	fixedE34Resolution = new(big.Int).Exp(big.NewInt(10), big.NewInt(34), nil)
	fixedE34Epsilon    = new(big.Int).Exp(big.NewInt(10), big.NewInt(10), nil)
	praosCertNatMax    = new(big.Int).Lsh(big.NewInt(1), 256)
)

// IsPraosLeaderEligible applies the Babbage/Conway Praos leader check to a
// raw, 64-byte unified VRF output. stakeNumerator/stakeDenominator is the
// issuer's exact relative active stake, and activeSlotNumerator/
// activeSlotDenominator is the exact active-slot coefficient from the Shelley
// genesis configuration.
//
// The arithmetic mirrors cardano-ledger's Fixed E34 implementation of
// checkLeaderNatValue. In particular, every fixed-point operation rounds down
// like Haskell's Data.Fixed; no floating-point arithmetic is used.
func IsPraosLeaderEligible(
	vrfOutput []byte,
	stakeNumerator uint64,
	stakeDenominator uint64,
	activeSlotNumerator uint64,
	activeSlotDenominator uint64,
) (bool, error) {
	if len(vrfOutput) != 64 {
		return false, fmt.Errorf("Praos VRF output must be 64 bytes, got %d", len(vrfOutput))
	}
	if stakeDenominator == 0 {
		return false, fmt.Errorf("Praos stake denominator must be greater than zero")
	}
	if stakeNumerator > stakeDenominator {
		return false, fmt.Errorf(
			"Praos stake numerator %d exceeds denominator %d",
			stakeNumerator,
			stakeDenominator,
		)
	}
	if activeSlotDenominator == 0 {
		return false, fmt.Errorf("Praos active-slot denominator must be greater than zero")
	}
	if activeSlotNumerator == 0 || activeSlotNumerator > activeSlotDenominator {
		return false, fmt.Errorf(
			"Praos active-slot coefficient must be in (0, 1], got %d/%d",
			activeSlotNumerator,
			activeSlotDenominator,
		)
	}

	leaderValue := praosLeaderValue(vrfOutput)
	leaderNatural := new(big.Int).SetBytes(leaderValue[:])
	return isPraosLeaderNaturalEligible(
		leaderNatural,
		stakeNumerator,
		stakeDenominator,
		activeSlotNumerator,
		activeSlotDenominator,
	)
}

func isPraosLeaderNaturalEligible(
	leaderNatural *big.Int,
	stakeNumerator uint64,
	stakeDenominator uint64,
	activeSlotNumerator uint64,
	activeSlotDenominator uint64,
) (bool, error) {
	if leaderNatural == nil || leaderNatural.Sign() < 0 || leaderNatural.Cmp(praosCertNatMax) >= 0 {
		return false, fmt.Errorf("Praos leader value must be in [0, 2^256)")
	}

	// cardano-ledger deliberately makes f == 1 an unconditional success because
	// ln(1-f) is undefined. Production networks use a substantially smaller f.
	if activeSlotNumerator == activeSlotDenominator {
		return true, nil
	}

	stake, err := fixedE34FromUintRatio(stakeNumerator, stakeDenominator)
	if err != nil {
		return false, err
	}
	activeSlot, err := fixedE34FromUintRatio(activeSlotNumerator, activeSlotDenominator)
	if err != nil {
		return false, err
	}
	oneMinusActiveSlot := fixedE34Sub(fixedE34One(), activeSlot)
	activeSlotLog, err := fixedE34Ln(oneMinusActiveSlot)
	if err != nil {
		return false, fmt.Errorf("compute Praos active-slot logarithm: %w", err)
	}

	// p = leaderNatural / 2^256 and recipQ = 1/(1-p).
	qDenominator := new(big.Int).Sub(new(big.Int).Set(praosCertNatMax), leaderNatural)
	recipQ, err := fixedE34FromBigRatio(praosCertNatMax, qDenominator)
	if err != nil {
		return false, fmt.Errorf("compute Praos VRF comparison value: %w", err)
	}

	// p < 1-(1-f)^sigma iff 1/(1-p) < exp(-sigma*ln(1-f)).
	// Preserve Haskell's parsing of -fromRational sigma * c as
	// -(fromRational sigma * c). Negating after the rounded multiplication can
	// differ by one E34 unit from multiplying two negated operands.
	exponent := new(big.Int).Neg(fixedE34Mul(stake, activeSlotLog))
	comparison, err := fixedE34TaylorExpCmp(fixedE34FromInt64(3), recipQ, exponent)
	if err != nil {
		return false, fmt.Errorf("compare Praos leader threshold: %w", err)
	}
	return comparison == fixedE34Below, nil
}

// praosLeaderValue performs Praos range extension for the leader use of the
// unified VRF certificate: Blake2b-256("L" || rawVRFOutput).
func praosLeaderValue(vrfOutput []byte) [32]byte {
	var input [65]byte
	input[0] = 'L'
	copy(input[1:], vrfOutput)
	return blake2b.Sum256(input[:])
}

type fixedE34Comparison uint8

const (
	fixedE34MaxReached fixedE34Comparison = iota
	fixedE34Below
	fixedE34Above
)

func fixedE34One() *big.Int {
	return new(big.Int).Set(fixedE34Resolution)
}

func fixedE34FromInt64(value int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(value), fixedE34Resolution)
}

func fixedE34FromUintRatio(numerator, denominator uint64) (*big.Int, error) {
	return fixedE34FromBigRatio(
		new(big.Int).SetUint64(numerator),
		new(big.Int).SetUint64(denominator),
	)
}

func fixedE34FromBigRatio(numerator, denominator *big.Int) (*big.Int, error) {
	scaledNumerator := new(big.Int).Mul(numerator, fixedE34Resolution)
	return floorQuotient(scaledNumerator, denominator)
}

func fixedE34Add(left, right *big.Int) *big.Int {
	return new(big.Int).Add(left, right)
}

func fixedE34Sub(left, right *big.Int) *big.Int {
	return new(big.Int).Sub(left, right)
}

func fixedE34Mul(left, right *big.Int) *big.Int {
	product := new(big.Int).Mul(left, right)
	result, err := floorQuotient(product, fixedE34Resolution)
	if err != nil {
		panic(err) // fixedE34Resolution is a non-zero constant
	}
	return result
}

func fixedE34Div(numerator, denominator *big.Int) (*big.Int, error) {
	scaledNumerator := new(big.Int).Mul(numerator, fixedE34Resolution)
	return floorQuotient(scaledNumerator, denominator)
}

func fixedE34Abs(value *big.Int) *big.Int {
	return new(big.Int).Abs(value)
}

func fixedE34Ceiling(value *big.Int) *big.Int {
	negated := new(big.Int).Neg(value)
	floor, err := floorQuotient(negated, fixedE34Resolution)
	if err != nil {
		panic(err) // fixedE34Resolution is a non-zero constant
	}
	return floor.Neg(floor)
}

// floorQuotient matches Haskell's div for signed integers. big.Int.QuoRem
// truncates toward zero, so a non-integral negative quotient needs one more
// step toward negative infinity.
func floorQuotient(numerator, denominator *big.Int) (*big.Int, error) {
	if denominator.Sign() == 0 {
		return nil, fmt.Errorf("fixed-point division by zero")
	}

	quotient := new(big.Int)
	remainder := new(big.Int)
	quotient.QuoRem(numerator, denominator, remainder)
	if remainder.Sign() != 0 && numerator.Sign() != denominator.Sign() {
		quotient.Sub(quotient, big.NewInt(1))
	}
	return quotient, nil
}

func fixedE34IPow(value *big.Int, exponent int64) (*big.Int, error) {
	if exponent < 0 {
		positive, err := fixedE34IPowPositive(value, -exponent)
		if err != nil {
			return nil, err
		}
		return fixedE34Div(fixedE34One(), positive)
	}
	return fixedE34IPowPositive(value, exponent)
}

// fixedE34IPowPositive preserves cardano-ledger's ipow' multiplication order,
// which matters because every Fixed E34 multiplication rounds down.
func fixedE34IPowPositive(value *big.Int, exponent int64) (*big.Int, error) {
	switch {
	case exponent == 0:
		return fixedE34One(), nil
	case exponent%2 == 0:
		half, err := fixedE34IPowPositive(value, exponent/2)
		if err != nil {
			return nil, err
		}
		return fixedE34Mul(half, half), nil
	default:
		remainder, err := fixedE34IPowPositive(value, exponent-1)
		if err != nil {
			return nil, err
		}
		return fixedE34Mul(value, remainder), nil
	}
}

func fixedE34Exp(value *big.Int) (*big.Int, error) {
	if value.Sign() < 0 {
		positive, err := fixedE34Exp(new(big.Int).Neg(value))
		if err != nil {
			return nil, err
		}
		return fixedE34Div(fixedE34One(), positive)
	}
	if value.Sign() == 0 {
		return fixedE34One(), nil
	}

	integerScale := fixedE34Ceiling(value)
	if !integerScale.IsInt64() || integerScale.Sign() <= 0 {
		return nil, fmt.Errorf("fixed-point exponential scale is out of range")
	}
	scale := integerScale.Int64()
	reduced, err := fixedE34Div(value, fixedE34FromInt64(scale))
	if err != nil {
		return nil, err
	}
	series := fixedE34TaylorExp(reduced)
	return fixedE34IPow(series, scale)
}

func fixedE34TaylorExp(value *big.Int) *big.Int {
	lastTerm := fixedE34One()
	accumulator := fixedE34One()
	divisor := fixedE34One()
	one := fixedE34One()

	for iteration := 1; iteration < fixedE34MaxIterations; iteration++ {
		nextTerm, err := fixedE34Div(fixedE34Mul(lastTerm, value), divisor)
		if err != nil {
			panic(err) // divisor starts at one and only increases
		}
		if fixedE34Abs(nextTerm).Cmp(fixedE34Epsilon) < 0 {
			return accumulator
		}
		accumulator = fixedE34Add(accumulator, nextTerm)
		lastTerm = nextTerm
		divisor = fixedE34Add(divisor, one)
	}
	return accumulator
}

func fixedE34Ln(value *big.Int) (*big.Int, error) {
	if value.Sign() <= 0 {
		return nil, fmt.Errorf("fixed-point logarithm input must be positive")
	}

	expOne, err := fixedE34Exp(fixedE34One())
	if err != nil {
		return nil, err
	}
	lowerExponent, upperExponent, err := fixedE34Bound(expOne, value)
	if err != nil {
		return nil, err
	}
	exponent, err := fixedE34Contract(expOne, value, lowerExponent, upperExponent)
	if err != nil {
		return nil, err
	}
	exponentiated, err := fixedE34IPow(expOne, exponent)
	if err != nil {
		return nil, err
	}
	ratio, err := fixedE34Div(value, exponentiated)
	if err != nil {
		return nil, err
	}
	fraction := fixedE34Sub(ratio, fixedE34One())
	continuedFraction, err := fixedE34LnContinuedFraction(fraction)
	if err != nil {
		return nil, err
	}
	return fixedE34Add(fixedE34FromInt64(exponent), continuedFraction), nil
}

func fixedE34Bound(factor, value *big.Int) (int64, int64, error) {
	lower, err := fixedE34Div(fixedE34One(), factor)
	if err != nil {
		return 0, 0, err
	}
	upper := new(big.Int).Set(factor)
	lowerExponent := int64(-1)
	upperExponent := int64(1)

	for iteration := 0; iteration < fixedE34MaxBounds; iteration++ {
		if lower.Cmp(value) <= 0 && value.Cmp(upper) <= 0 {
			return lowerExponent, upperExponent, nil
		}
		lower = fixedE34Mul(lower, lower)
		upper = fixedE34Mul(upper, upper)
		lowerExponent *= 2
		upperExponent *= 2
	}
	return 0, 0, fmt.Errorf("fixed-point logarithm bounds did not converge")
}

func fixedE34Contract(factor, value *big.Int, lower, upper int64) (int64, error) {
	for iteration := 0; iteration < fixedE34MaxBounds; iteration++ {
		if lower+1 == upper {
			return lower, nil
		}
		middle := lower + (upper-lower)/2
		candidate, err := fixedE34IPow(factor, middle)
		if err != nil {
			return 0, err
		}
		if value.Cmp(candidate) < 0 {
			upper = middle
		} else {
			lower = middle
		}
	}
	return 0, fmt.Errorf("fixed-point logarithm contraction did not converge")
}

func fixedE34LnContinuedFraction(value *big.Int) (*big.Int, error) {
	aNm2 := fixedE34One()
	bNm2 := new(big.Int)
	aNm1 := new(big.Int)
	bNm1 := fixedE34One()
	var lastValue *big.Int

	for iteration := 0; iteration <= fixedE34MaxIterations; iteration++ {
		var an *big.Int
		if iteration == 0 {
			an = new(big.Int).Set(value)
		} else {
			factor := int64((iteration + 1) / 2)
			an = fixedE34Mul(fixedE34FromInt64(factor*factor), value)
		}
		bn := fixedE34FromInt64(int64(iteration + 1))
		aN := fixedE34Add(fixedE34Mul(bn, aNm1), fixedE34Mul(an, aNm2))
		bN := fixedE34Add(fixedE34Mul(bn, bNm1), fixedE34Mul(an, bNm2))
		convergent, err := fixedE34Div(aN, bN)
		if err != nil {
			return nil, err
		}

		if iteration == fixedE34MaxIterations ||
			(lastValue != nil && fixedE34Abs(fixedE34Sub(lastValue, convergent)).Cmp(fixedE34Epsilon) < 0) {
			return convergent, nil
		}

		lastValue = convergent
		aNm2, bNm2 = aNm1, bNm1
		aNm1, bNm1 = aN, bN
	}

	return nil, fmt.Errorf("fixed-point logarithm continued fraction did not terminate")
}

// fixedE34TaylorExpCmp mirrors cardano-ledger's taylorExpCmp. A BELOW result
// means cmp is conclusively below exp(value), which is the successful Praos
// leader condition.
func fixedE34TaylorExpCmp(bound, cmp, value *big.Int) (fixedE34Comparison, error) {
	errTerm := new(big.Int).Set(value)
	accumulator := fixedE34One()
	divisor := fixedE34One()
	one := fixedE34One()

	for iteration := 0; iteration < fixedE34MaxIterations; iteration++ {
		nextDivisor := fixedE34Add(divisor, one)
		nextErr, err := fixedE34Div(fixedE34Mul(errTerm, value), nextDivisor)
		if err != nil {
			return fixedE34MaxReached, err
		}
		nextAccumulator := fixedE34Add(accumulator, errTerm)
		errorBound := fixedE34Abs(fixedE34Mul(nextErr, bound))

		if cmp.Cmp(fixedE34Add(nextAccumulator, errorBound)) >= 0 {
			return fixedE34Above, nil
		}
		if cmp.Cmp(fixedE34Sub(nextAccumulator, errorBound)) < 0 {
			return fixedE34Below, nil
		}

		errTerm = nextErr
		accumulator = nextAccumulator
		divisor = nextDivisor
	}
	return fixedE34MaxReached, nil
}
