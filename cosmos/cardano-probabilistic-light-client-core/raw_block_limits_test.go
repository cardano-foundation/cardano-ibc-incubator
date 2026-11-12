package probabilisticcore

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strconv"
	"testing"

	ledgercbor "github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/blinklabs-io/gouroboros/ledger/common"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
)

// Build a witness set without recursively encoding the test data. The four
// enclosing containers count toward the decoder's nesting limit.
func nestedWitnessSet(depth int, constructors bool) []byte {
	layer := []byte{0x81}
	if constructors {
		layer = []byte{0xd8, 0x79, 0x81}
	}
	raw := []byte{0x81, 0xa1, 0x05, 0xa1, 0x82, 0x00, 0x00, 0x82}
	raw = append(raw, bytes.Repeat(layer, depth)...)
	raw = append(raw, 0x00, 0x82, 0x00, 0x00)
	return raw
}

func TestRawFallbackAcceptsNestedPreviewBlock(t *testing.T) {
	block, err := decodeRawBodyBlock(previewBlockForHeaderDetection(t))
	require.NoError(t, err)
	require.Equal(t, uint64(4_846_910), block.BlockNumber())
	nonce, err := hex.DecodeString("25e7ec25915768e9f511635286ab9b7bfc4b66c0ca64cd674a10a8e5d54b7ee2")
	require.NoError(t, err)
	valid, _, err := VerifyNativeBlock(block, nonce, 129600, 62, fullStakePraosParameters())
	require.NoError(t, err)
	require.True(t, valid)
}

func TestRawWitnessDecodersKeepLedgerNestingBound(t *testing.T) {
	for _, constructors := range []bool{false, true} {
		name := "lists"
		if constructors {
			name = "constructors"
		}
		t.Run(name, func(t *testing.T) {
			raw := nestedWitnessSet(ledgercbor.MaxNestedLevels-4, constructors)
			conway, err := decodeConwayWitnessSets(raw, 1)
			require.NoError(t, err)
			require.Len(t, conway, 1)
			require.Equal(t, raw[1:], conway[0].Cbor())
			babbage, err := decodeBabbageWitnessSets(raw, 1)
			require.NoError(t, err)
			require.Len(t, babbage, 1)
			require.Equal(t, raw[1:], babbage[0].Cbor())

			tooDeep := nestedWitnessSet(ledgercbor.MaxNestedLevels-3, constructors)
			_, err = decodeConwayWitnessSets(tooDeep, 1)
			require.ErrorContains(t, err, "exceeded max nested level")
			_, err = decodeBabbageWitnessSets(tooDeep, 1)
			require.ErrorContains(t, err, "exceeded max nested level")
		})
	}
}

func TestPoolCertificatesAcceptNestedWitnessDataAndCheckSignatures(t *testing.T) {
	operator := ed25519.NewKeyFromSeed(make([]byte, 32))
	operatorHash := ledger.IssuerVkey(operator.Public().(ed25519.PublicKey)).Hash()
	retirement := []any{uint64(4), operatorHash.Bytes(), uint64(9)}
	for _, signed := range []bool{true, false} {
		name := "signed"
		var signers []ed25519.PrivateKey
		if signed {
			signers = []ed25519.PrivateKey{operator}
		} else {
			name = "unsigned"
		}
		t.Run(name, func(t *testing.T) {
			var fields []cbor.RawMessage
			_, err := ledgercbor.Decode(poolCertificateBlock(t, []any{retirement}, signers, false), &fields)
			require.NoError(t, err)
			var witnesses []map[uint64]cbor.RawMessage
			require.NoError(t, cbor.Unmarshal(fields[2], &witnesses))
			data := append(bytes.Repeat([]byte{0x81}, 64), 0x00)
			witnesses[0][5], err = cbor.Marshal(map[common.RedeemerKey]any{
				{Tag: common.RedeemerTagReward, Index: 0}: []any{cbor.RawMessage(data), []uint64{0, 0}},
			})
			require.NoError(t, err)
			fields[2], err = cbor.Marshal(witnesses)
			require.NoError(t, err)
			bodyFields := rawBlockBodyFields{fields[1], fields[2], fields[3], fields[4]}
			bodyHash := rawBodyHash(bodyFields)
			header := &ledger.ConwayBlockHeader{}
			header.Body.BlockBodyHash = ledger.NewBlake2b256(bodyHash[:])
			fields[0], err = ledgercbor.Encode(header)
			require.NoError(t, err)
			raw, err := cbor.Marshal(fields)
			require.NoError(t, err)
			// Use the library decoder here to isolate the certificate reader
			// from fallback decoding. These are authenticated-body fixtures,
			// not complete ledger-valid transactions or signed block headers.
			decoded, err := ledger.NewConwayBlockFromCbor(raw)
			require.NoError(t, err)
			block := wrapRawBodyFields(decoded, bodyFields)
			events, err := AuthenticatedPoolCertificates(block)
			if !signed {
				require.ErrorContains(t, err, "missing an authenticated operator or owner signature")
				return
			}
			require.NoError(t, err)
			require.Len(t, events, 1)
			require.Equal(t, operatorHash.Bech32("pool"), events[0].PoolID)
			require.True(t, events[0].Retirement)
			require.Equal(t, uint64(9), events[0].RetirementEpoch)
		})
	}
}

func TestRawWitnessDecoderResourceBounds(t *testing.T) {
	const childEnv = "CARDANO_RAW_DECODER_STRESS_CHILD"
	if os.Getenv(childEnv) != "1" {
		// Isolate a fatal stack overflow from the rest of the test process.
		cmd := exec.Command(os.Args[0], "-test.run=^TestRawWitnessDecoderResourceBounds$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		output, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", output)
		t.Logf("%s", output)
		return
	}
	previousStack := debug.SetMaxStack(32 << 20)
	defer debug.SetMaxStack(previousStack)
	previousMemory := debug.SetMemoryLimit(128 << 20)
	defer debug.SetMemoryLimit(previousMemory)

	// Alternating constructor tags and arrays add recursive calls even though
	// a single tag does not add to fxamacker's nesting count.
	raw := nestedWitnessSet(ledgercbor.MaxNestedLevels-4, true)
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for range 16 {
		witnesses, err := decodeConwayWitnessSets(raw, 1)
		require.NoError(t, err)
		require.Len(t, witnesses, 1)
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc
	require.Less(t, allocated, uint64(16<<20), "raw extraction must not build a nested object tree")
	t.Logf("16 maximum-depth decodes allocated %d bytes with a 32 MiB stack cap and 128 MiB soft memory limit", allocated)
}

func BenchmarkRawWitnessDecoderNesting(b *testing.B) {
	for _, depth := range []int{32, 88, 4096, ledgercbor.MaxNestedLevels - 4} {
		b.Run(strconv.Itoa(depth), func(b *testing.B) {
			raw := nestedWitnessSet(depth, true)
			b.SetBytes(int64(len(raw)))
			b.ReportAllocs()
			for b.Loop() {
				if _, err := decodeConwayWitnessSets(raw, 1); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
