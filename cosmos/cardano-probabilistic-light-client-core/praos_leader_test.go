package probabilisticcore

import (
	"encoding/hex"
	"math/big"
	"testing"
)

func TestPraosLeaderValueUsesCPraosDomainSeparation(t *testing.T) {
	testCases := []struct {
		name      string
		vrfOutput []byte
		wantHex   string
	}{
		{
			name:      "zero output",
			vrfOutput: make([]byte, 64),
			wantHex:   "3ad7cca60479a085a3503e278a1b8bc44e3e4f76434142201e47eebf7e06d164",
		},
		{
			name:      "ascending output",
			vrfOutput: ascendingBytes(64),
			wantHex:   "5ac759eb0e7c23c36ce750660cfef3fc461f3d973202b094b7e45d435adc30ab",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := praosLeaderValue(testCase.vrfOutput)
			if gotHex := hex.EncodeToString(got[:]); gotHex != testCase.wantHex {
				t.Fatalf("leader value mismatch: got %s want %s", gotHex, testCase.wantHex)
			}
		})
	}
}

func TestFixedE34ActiveSlotLogMatchesCardanoLedger(t *testing.T) {
	testCases := []struct {
		name        string
		numerator   uint64
		denominator uint64
		wantRaw     string
	}{
		{
			name:        "mainnet one twentieth",
			numerator:   1,
			denominator: 20,
			wantRaw:     "-512932943875505334261962382072846",
		},
		{
			name:        "one quarter",
			numerator:   1,
			denominator: 4,
			wantRaw:     "-2876820724517809274392188808427957",
		},
		{
			name:        "one half",
			numerator:   1,
			denominator: 2,
			wantRaw:     "-6931471805599453094172321354910343",
		},
		{
			name:        "near one",
			numerator:   999,
			denominator: 1000,
			wantRaw:     "-69077552789821370520539745376002385",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			activeSlot, err := fixedE34FromUintRatio(testCase.numerator, testCase.denominator)
			if err != nil {
				t.Fatalf("fixed active-slot coefficient: %v", err)
			}
			got, err := fixedE34Ln(fixedE34Sub(fixedE34One(), activeSlot))
			if err != nil {
				t.Fatalf("active-slot logarithm: %v", err)
			}
			if got.String() != testCase.wantRaw {
				t.Fatalf("active-slot logarithm mismatch: got %s want %s", got, testCase.wantRaw)
			}
		})
	}
}

func TestPraosLeaderEligibilityMatchesCardanoLedgerBoundaries(t *testing.T) {
	testCases := []struct {
		name             string
		stakeNumerator   uint64
		stakeDenominator uint64
		lastEligible     string
	}{
		{
			name:             "full stake",
			stakeNumerator:   1,
			stakeDenominator: 1,
			lastEligible:     "5789604461865809771178559585453480198369100028462394554171107519592419624996",
		},
		{
			name:             "half stake",
			stakeNumerator:   1,
			stakeDenominator: 2,
			lastEligible:     "2931921182127356605124805567179037765694055864783790725199616097393573858374",
		},
		{
			name:             "one percent stake",
			stakeNumerator:   1,
			stakeDenominator: 100,
			lastEligible:     "59378347352865455582606810972490071285536333355677752233003202029151775518",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			lastEligible := mustBigInt(t, testCase.lastEligible)
			eligible, err := isPraosLeaderNaturalEligible(
				lastEligible,
				testCase.stakeNumerator,
				testCase.stakeDenominator,
				1,
				20,
			)
			if err != nil {
				t.Fatalf("last eligible value: %v", err)
			}
			if !eligible {
				t.Fatal("Cardano ledger's last eligible value was rejected")
			}

			firstIneligible := new(big.Int).Add(lastEligible, big.NewInt(1))
			eligible, err = isPraosLeaderNaturalEligible(
				firstIneligible,
				testCase.stakeNumerator,
				testCase.stakeDenominator,
				1,
				20,
			)
			if err != nil {
				t.Fatalf("first ineligible value: %v", err)
			}
			if eligible {
				t.Fatal("Cardano ledger's first ineligible value was accepted")
			}
		})
	}
}

func TestFixedE34PraosExponentPreservesLedgerNegationOrder(t *testing.T) {
	stake, err := fixedE34FromUintRatio(1, 100)
	if err != nil {
		t.Fatalf("fixed stake: %v", err)
	}
	activeSlot, err := fixedE34FromUintRatio(1, 20)
	if err != nil {
		t.Fatalf("fixed active-slot coefficient: %v", err)
	}
	activeSlotLog, err := fixedE34Ln(fixedE34Sub(fixedE34One(), activeSlot))
	if err != nil {
		t.Fatalf("active-slot logarithm: %v", err)
	}

	// Cardano evaluates this as -(stake * log), so it negates only after the
	// negative Fixed E34 product has rounded down. (-stake) * log is one raw
	// unit smaller for this vector.
	exponent := new(big.Int).Neg(fixedE34Mul(stake, activeSlotLog))
	const want = "5129329438755053342619623820729"
	if exponent.String() != want {
		t.Fatalf("Praos exponent mismatch: got %s want %s", exponent, want)
	}
}

func TestIsPraosLeaderEligibleUsesStakeDependentThreshold(t *testing.T) {
	vrfOutput := make([]byte, 64)
	vrfOutput[7] = 20

	eligible, err := IsPraosLeaderEligible(vrfOutput, 1, 1, 1, 20)
	if err != nil {
		t.Fatalf("full stake eligibility: %v", err)
	}
	if !eligible {
		t.Fatal("expected VRF output to be eligible at full stake")
	}

	eligible, err = IsPraosLeaderEligible(vrfOutput, 1, 10, 1, 20)
	if err != nil {
		t.Fatalf("one-tenth stake eligibility: %v", err)
	}
	if eligible {
		t.Fatal("expected the same VRF output to be ineligible at one-tenth stake")
	}
}

func TestIsPraosLeaderEligibleHandlesDegenerateAndInvalidInputs(t *testing.T) {
	vrfOutput := make([]byte, 64)

	eligible, err := IsPraosLeaderEligible(vrfOutput, 0, 1, 1, 20)
	if err != nil {
		t.Fatalf("zero stake: %v", err)
	}
	if eligible {
		t.Fatal("zero stake must not be eligible when f is less than one")
	}

	eligible, err = IsPraosLeaderEligible(vrfOutput, 0, 1, 1, 1)
	if err != nil {
		t.Fatalf("f=1: %v", err)
	}
	if !eligible {
		t.Fatal("f=1 must follow cardano-ledger's unconditional-success rule")
	}

	testCases := []struct {
		name                  string
		vrfOutput             []byte
		stakeNumerator        uint64
		stakeDenominator      uint64
		activeSlotNumerator   uint64
		activeSlotDenominator uint64
	}{
		{name: "short VRF output", vrfOutput: make([]byte, 63), stakeNumerator: 1, stakeDenominator: 1, activeSlotNumerator: 1, activeSlotDenominator: 20},
		{name: "zero stake denominator", vrfOutput: vrfOutput, stakeNumerator: 1, stakeDenominator: 0, activeSlotNumerator: 1, activeSlotDenominator: 20},
		{name: "stake above total", vrfOutput: vrfOutput, stakeNumerator: 2, stakeDenominator: 1, activeSlotNumerator: 1, activeSlotDenominator: 20},
		{name: "zero active-slot numerator", vrfOutput: vrfOutput, stakeNumerator: 1, stakeDenominator: 1, activeSlotNumerator: 0, activeSlotDenominator: 20},
		{name: "zero active-slot denominator", vrfOutput: vrfOutput, stakeNumerator: 1, stakeDenominator: 1, activeSlotNumerator: 1, activeSlotDenominator: 0},
		{name: "active-slot coefficient above one", vrfOutput: vrfOutput, stakeNumerator: 1, stakeDenominator: 1, activeSlotNumerator: 21, activeSlotDenominator: 20},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := IsPraosLeaderEligible(
				testCase.vrfOutput,
				testCase.stakeNumerator,
				testCase.stakeDenominator,
				testCase.activeSlotNumerator,
				testCase.activeSlotDenominator,
			)
			if err == nil {
				t.Fatal("expected invalid input to fail")
			}
		})
	}
}

func TestFloorQuotientMatchesDataFixedNegativeRounding(t *testing.T) {
	got, err := fixedE34FromBigRatio(big.NewInt(-1), big.NewInt(3))
	if err != nil {
		t.Fatalf("negative fixed rational: %v", err)
	}
	const want = "-3333333333333333333333333333333334"
	if got.String() != want {
		t.Fatalf("negative fixed rational mismatch: got %s want %s", got, want)
	}
}

func ascendingBytes(length int) []byte {
	result := make([]byte, length)
	for index := range result {
		result[index] = byte(index)
	}
	return result
}

func mustBigInt(t *testing.T, value string) *big.Int {
	t.Helper()
	result, ok := new(big.Int).SetString(value, 10)
	if !ok {
		t.Fatalf("invalid test integer %q", value)
	}
	return result
}
