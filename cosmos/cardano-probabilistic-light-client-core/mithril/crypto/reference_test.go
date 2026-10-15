package crypto

import (
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"math"
	"math/big"
	"os"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

// Vectors from tests/mithril-reference, which signs with mithril-stm 0.12.0
// as pinned by the Mithril mainnet aggregator 0.9.22 (3f6cb73).
type referenceCase struct {
	Name   string `json:"name"`
	Params struct {
		K    uint64  `json:"k"`
		M    uint64  `json:"m"`
		PhiF float64 `json:"phi_f"`
	} `json:"params"`
	Message                  string `json:"message"`
	AggregateVerificationKey string `json:"aggregate_verification_key"`
	TotalStake               Stake  `json:"total_stake"`
	Parties                  []struct {
		Stake     Stake `json:"stake"`
		Signature *struct {
			Sigma   []uint8 `json:"sigma"`
			Indexes []Index `json:"indexes"`
		} `json:"signature"`
	} `json:"parties"`
	Aggregate *struct {
		MultiSignature string `json:"multi_signature"`
		Verified       bool   `json:"verified"`
	} `json:"aggregate"`
}

func loadReferenceCases(t *testing.T) []referenceCase {
	t.Helper()
	file, err := os.Open("../../testdata/mithril/stm-reference-vectors.json.gz")
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	var vectors struct {
		Lotteries []referenceCase `json:"lotteries"`
	}
	require.NoError(t, json.NewDecoder(reader).Decode(&vectors))
	require.NotEmpty(t, vectors.Lotteries)
	return vectors.Lotteries
}

func decodeHexJSON(t *testing.T, encoded string, value any) {
	t.Helper()
	raw, err := hex.DecodeString(encoded)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, value))
}

// Every index upstream's signer won, and no other, wins here: the lottery
// value, its byte order and the lottery predicate all match upstream.
func TestLotteryMatchesUpstream(t *testing.T) {
	for _, reference := range loadReferenceCases(t) {
		t.Run(reference.Name, func(t *testing.T) {
			var avk StmAggrVerificationKey
			decodeHexJSON(t, reference.AggregateVerificationKey, &avk)
			require.Equal(t, reference.TotalStake, avk.TotalStake)
			message, err := hex.DecodeString(reference.Message)
			require.NoError(t, err)
			msgp := avk.MTCommitment.ConcatWithMsg(message)
			signed := 0
			for _, party := range reference.Parties {
				if party.Signature == nil {
					continue
				}
				signed++
				sigma, err := new(Signature).FromBytes(party.Signature.Sigma)
				require.NoError(t, err)
				var won []Index
				for index := Index(0); uint64(index) < reference.Params.M; index++ {
					ev, err := sigma.Eval(msgp, index)
					require.NoError(t, err)
					if EvLtPhi(reference.Params.PhiF, ev, party.Stake, avk.TotalStake) {
						won = append(won, index)
					}
				}
				expected := append([]Index(nil), party.Signature.Indexes...)
				sort.Slice(expected, func(i, j int) bool { return expected[i] < expected[j] })
				require.Equal(t, expected, won, "stake %d", party.Stake)
			}
			require.NotZero(t, signed)
		})
	}
}

// Upstream's aggregates verify, and claiming an index that did not win is
// rejected even when every signature and Merkle path is genuine.
func TestUpstreamAggregatesVerifyAndLostIndicesAreRejected(t *testing.T) {
	for _, reference := range loadReferenceCases(t) {
		t.Run(reference.Name, func(t *testing.T) {
			require.NotNil(t, reference.Aggregate)
			require.True(t, reference.Aggregate.Verified)
			var avk StmAggrVerificationKey
			decodeHexJSON(t, reference.AggregateVerificationKey, &avk)
			message, err := hex.DecodeString(reference.Message)
			require.NoError(t, err)
			params := &StmParameters{K: reference.Params.K, M: reference.Params.M, PhiF: reference.Params.PhiF}
			var aggregate StmAggrSig
			decodeHexJSON(t, reference.Aggregate.MultiSignature, &aggregate)
			require.NoError(t, aggregate.Verify(message, &avk, params))
			if reference.Params.PhiF == 1 {
				return
			}

			used := map[Index]bool{}
			for _, party := range aggregate.Signatures {
				for _, index := range party.Sig.Indexes {
					used[index] = true
				}
			}
			forged := aggregate
			forged.Signatures = append([]StmSigRegParty(nil), aggregate.Signatures...)
			party := forged.Signatures[0]
			signature := *party.Sig
			msgp := avk.MTCommitment.ConcatWithMsg(message)
			for index := Index(0); uint64(index) < params.M; index++ {
				ev, err := signature.Sigma.Eval(msgp, index)
				require.NoError(t, err)
				if !used[index] && !EvLtPhi(params.PhiF, ev, party.RegParty.Stake, avk.TotalStake) {
					signature.Indexes = append(append([]Index(nil), signature.Indexes...), index)
					break
				}
			}
			require.Greater(t, len(signature.Indexes), len(party.Sig.Indexes))
			forged.Signatures[0] = StmSigRegParty{Sig: &signature, RegParty: party.RegParty}
			require.ErrorContains(t, forged.Verify(message, &avk, params), "lottery check failed")
		})
	}
}

// exactThreshold returns floor(2^512 * (1 - exp(w*c))), the lottery boundary
// for the binary64 c the verifier uses, computed to 1024 bits.
func exactThreshold(phiF float64, stake, total Stake) *big.Int {
	const precision = 1024
	c := new(big.Float).SetPrec(precision).SetFloat64(correctlyRoundedLog(1 - phiF))
	x := new(big.Float).SetPrec(precision).Quo(new(big.Float).SetPrec(precision).SetUint64(uint64(stake)), new(big.Float).SetPrec(precision).SetUint64(uint64(total)))
	x.Mul(x, c)
	exp := new(big.Float).SetPrec(precision).SetInt64(1)
	term := new(big.Float).SetPrec(precision).SetInt64(1)
	for n := int64(1); n < 400; n++ {
		term.Mul(term, x)
		term.Quo(term, new(big.Float).SetPrec(precision).SetInt64(n))
		exp.Add(exp, term)
	}
	p := new(big.Float).SetPrec(precision).Sub(new(big.Float).SetPrec(precision).SetInt64(1), exp)
	p.SetMantExp(p, 512)
	threshold, _ := p.Int(nil)
	return threshold
}

func littleEndianEV(value *big.Int) []byte {
	big := value.FillBytes(make([]byte, 64))
	ev := make([]byte, 64)
	for i, b := range big {
		ev[63-i] = b
	}
	return ev
}

func TestLotteryBoundaries(t *testing.T) {
	maxEV := littleEndianEV(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 512), big.NewInt(1)))
	zero := make([]byte, 64)

	// mithril-stm treats phi_f within f64::EPSILON of 1 as always winning.
	require.True(t, EvLtPhi(1, maxEV, 1, 1_000_000))
	require.True(t, EvLtPhi(math.Nextafter(1, 0), maxEV, 1, 1_000_000))
	require.False(t, EvLtPhi(1-2*machineEpsilon, maxEV, 1, 1_000_000))

	// Invalid inputs lose instead of panicking.
	for _, phiF := range []float64{0, -0.1, 1.5, math.NaN(), math.Inf(1)} {
		require.False(t, EvLtPhi(phiF, zero, 1, 2), "phi_f %v", phiF)
	}
	require.False(t, EvLtPhi(0.2, zero, 1, 0), "zero total stake")
	require.False(t, EvLtPhi(0.2, zero[:63], 1, 2), "short lottery value")

	// The comparison resolves exactly either side of the boundary, including
	// for stakes that do not fit int64.
	for _, test := range []struct {
		phiF         float64
		stake, total Stake
	}{
		{0.2, 1, 3},
		{0.2, 2_431_347_067_481, 4_041_757_324_338_452},
		{0.65, 1, 11_111},
		{0.95, 2, 6},
		{0.2, 1 << 62, (1 << 63) + (1 << 62) + 6},
		{0.2, math.MaxUint64, math.MaxUint64},
	} {
		threshold := exactThreshold(test.phiF, test.stake, test.total)
		margin := new(big.Int).Lsh(big.NewInt(1), 400)
		require.True(t, EvLtPhi(test.phiF, littleEndianEV(new(big.Int).Sub(threshold, margin)), test.stake, test.total), "%+v below", test)
		require.False(t, EvLtPhi(test.phiF, littleEndianEV(new(big.Int).Add(threshold, margin)), test.stake, test.total), "%+v above", test)
	}
}

// The correctly rounded logarithm agrees with the platform logarithm to the
// last bit for the lottery's inputs, and is exact for the configured phi_f.
func TestCorrectlyRoundedLog(t *testing.T) {
	for _, phiF := range []float64{0.2, 0.65, 0.95, 0.5, 0.1} {
		require.Equal(t, math.Log(1-phiF), correctlyRoundedLog(1-phiF), "phi_f %v", phiF)
	}
	for x := 0.0001; x < 1; x += 0.0009765625 {
		got, want := correctlyRoundedLog(x), math.Log(x)
		require.LessOrEqual(t, math.Abs(got-want), math.Abs(math.Nextafter(want, 0)-want), "x %v", x)
	}
}
