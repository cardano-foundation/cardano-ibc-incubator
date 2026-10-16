package state

import (
	"bytes"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	dbm "github.com/cosmos/cosmos-db"

	"github.com/stretchr/testify/require"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"golang.org/x/crypto/blake2b"
)

func TestVerifyBridgeContinuityRejectsBadPrevHash(t *testing.T) {
	trustedBlock := &trustedBlockState{
		height:    &Height{RevisionHeight: 10},
		blockHash: testBlockHash("trusted-hash"),
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		bridgeBlocks: []*authenticatedProbabilisticBlock{
			{
				height:   11,
				hash:     "bridge-11",
				prevHash: "wrong-prev",
			},
		},
		anchorBlock: &authenticatedProbabilisticBlock{
			height:   12,
			hash:     "anchor-12",
			prevHash: "bridge-11",
		},
	}

	err := verifyBridgeContinuity(authenticatedHeader, trustedBlock)
	require.ErrorContains(t, err, "does not connect to trusted chain")
}

func TestOperationalCertificateCountersAcceptEqualAndIncreasingSequences(t *testing.T) {
	poolA := bytes.Repeat([]byte{0x0a}, 28)
	poolB := bytes.Repeat([]byte{0x0b}, 28)
	counters := map[string]uint64{
		hex.EncodeToString(poolA): 4,
		hex.EncodeToString(poolB): 9,
	}

	require.NoError(t, advanceOperationalCertificateCounter(counters, poolA, 4))
	require.NoError(t, advanceOperationalCertificateCounter(counters, poolA, 7))
	require.Equal(t, uint64(7), counters[hex.EncodeToString(poolA)])
	require.Equal(t, uint64(9), counters[hex.EncodeToString(poolB)])
}

func TestOperationalCertificateCountersRejectDecreasingSequence(t *testing.T) {
	poolID := bytes.Repeat([]byte{0x0c}, 28)
	poolKey := hex.EncodeToString(poolID)
	counters := map[string]uint64{poolKey: 5}

	err := advanceOperationalCertificateCounter(counters, poolID, 4)
	require.ErrorContains(t, err, "older than authenticated counter 5")
	require.Equal(t, uint64(5), counters[poolKey])
}

func TestOperationalCertificateCounterSnapshotStopsAtAnchor(t *testing.T) {
	poolA := bytes.Repeat([]byte{0x0d}, 28)
	poolB := bytes.Repeat([]byte{0x0e}, 28)
	counters := map[string]uint64{}

	// Bridge blocks are applied before the accepted anchor.
	require.NoError(t, advanceOperationalCertificateCounter(counters, poolA, 2))
	require.NoError(t, advanceOperationalCertificateCounter(counters, poolB, 3))
	anchorSnapshot := operationalCertificateCountersFromMap(counters)

	// Descendants authenticate stability, but the persisted cursor remains the anchor.
	require.NoError(t, advanceOperationalCertificateCounter(counters, poolA, 4))
	anchorCounters, err := operationalCertificateCounterMap(anchorSnapshot)
	require.NoError(t, err)
	require.Equal(t, uint64(2), anchorCounters[hex.EncodeToString(poolA)])
	require.Equal(t, uint64(4), counters[hex.EncodeToString(poolA)])
}

func TestOperationalCertificateCounterStateIsCanonicalAndSparse(t *testing.T) {
	poolA := bytes.Repeat([]byte{0xaa}, 28)
	poolB := bytes.Repeat([]byte{0xbb}, 28)
	encoded := operationalCertificateCountersFromMap(map[string]uint64{
		hex.EncodeToString(poolB): 0,
		hex.EncodeToString(poolA): 2,
	})

	require.Len(t, encoded, 1)
	require.Equal(t, poolA, encoded[0].PoolId)
	require.Equal(t, uint64(2), encoded[0].SequenceNumber)
	_, err := normalizeOperationalCertificateCounters([]*OperationalCertificateCounter{
		{PoolId: poolA, SequenceNumber: 1},
		{PoolId: bytes.Clone(poolA), SequenceNumber: 2},
	})
	require.ErrorContains(t, err, "duplicate operational certificate counter")
	_, err = normalizeOperationalCertificateCounters([]*OperationalCertificateCounter{
		{PoolId: poolB, SequenceNumber: 0},
	})
	require.ErrorContains(t, err, "must be omitted")
}

func TestAuthenticateRealBabbageBlockEnforcesOperationalCertificateCounter(t *testing.T) {
	fixtureHex, err := os.ReadFile("../testdata/babbage_block.hex")
	require.NoError(t, err)
	blockCbor, err := hex.DecodeString(strings.Join(strings.Fields(string(fixtureHex)), ""))
	require.NoError(t, err)
	decodedBlock, err := decodeLedgerBlock(blockCbor)
	require.NoError(t, err)
	epochNonce, err := hex.DecodeString("53606952e39eadd5eea559be517f9741c9538073e987ec1b7a6c7a05db6195d3")
	require.NoError(t, err)
	_, _, vrfKey, err := buildBlockVerificationArtifacts(decodedBlock)
	require.NoError(t, err)
	vrfKeyHash := blake2b.Sum256(vrfKey)

	clientState := newProbabilisticTestClientState()
	clientState.SystemStartUnixNs = 1
	clientState.SlotLengthNs = 1
	clientState.CurrentEpochStartSlot = decodedBlock.SlotNumber()
	clientState.CurrentEpochEndSlotExclusive = decodedBlock.SlotNumber() + 1
	epochContext := &EpochContext{
		Epoch:                 7,
		EpochNonce:            epochNonce,
		SlotsPerKesPeriod:     129600,
		EpochStartSlot:        decodedBlock.SlotNumber(),
		EpochEndSlotExclusive: decodedBlock.SlotNumber() + 1,
		StakeDistribution: []*StakeDistributionEntry{{
			PoolId:                   decodedBlock.IssuerVkey().PoolId(),
			Stake:                    1,
			VrfKeyHash:               vrfKeyHash[:],
			RelativeStakeNumerator:   4_178_103_721_131,
			RelativeStakeDenominator: 5_019_556_879_197_493,
		}},
	}
	block := &ProbabilisticBlock{
		Height:    NewHeight(0, decodedBlock.BlockNumber()),
		Hash:      decodedBlock.Hash().String(),
		Slot:      decodedBlock.SlotNumber(),
		Epoch:     epochContext.Epoch,
		Timestamp: 1 + decodedBlock.SlotNumber(),
		BlockCbor: blockCbor,
	}
	poolKey := hex.EncodeToString(decodedBlock.IssuerVkey().Hash().Bytes())

	_, err = clientState.authenticateProbabilisticBlock(
		block,
		"anchor",
		[]*EpochContext{epochContext},
		map[string]uint64{poolKey: 9},
		true,
		testNonceTracker(t, block, []*EpochContext{epochContext}), testPoolRegistryTracker(t, block, []*EpochContext{epochContext}))
	require.ErrorContains(t, err, "older than authenticated counter 9")

	counters := map[string]uint64{poolKey: 8}
	authenticated, err := clientState.authenticateProbabilisticBlock(
		block,
		"anchor",
		[]*EpochContext{epochContext},
		counters,
		true,
		testNonceTracker(t, block, []*EpochContext{epochContext}), testPoolRegistryTracker(t, block, []*EpochContext{epochContext}))
	require.NoError(t, err)
	require.Equal(t, uint64(8), authenticated.operationalCertificateSequenceNumber)
	require.Equal(t, uint64(8), counters[poolKey])
}

func TestAuthenticateProbabilisticBlockRejectsMismatchedClaims(t *testing.T) {
	valid := makeTestProbabilisticBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))

	testCases := []struct {
		name   string
		mutate func(*ProbabilisticBlock)
		want   string
	}{
		{
			name: "hash mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Hash = "deadbeef"
			},
			want: "block hash mismatch",
		},
		{
			name: "height mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Height = &Height{RevisionHeight: valid.Height.RevisionHeight + 1}
			},
			want: "block height mismatch",
		},
		{
			name: "slot mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Slot = valid.Slot + 1
			},
			want: "block slot mismatch",
		},
		{
			name: "timestamp mismatch",
			mutate: func(block *ProbabilisticBlock) {
				block.Timestamp++
			},
			want: "block timestamp mismatch",
		},
	}

	cs := newProbabilisticTestClientState()
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			block := cloneTestProbabilisticBlock(valid)
			tc.mutate(block)
			_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs), map[string]uint64{}, true, testNonceTracker(t, block, mustTestEpochContexts(t, cs)), testPoolRegistryTracker(t, block, mustTestEpochContexts(t, cs)))
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestAuthenticateProbabilisticBlockDoesNotMutateInput(t *testing.T) {
	cs := newProbabilisticTestClientState()
	block := makeTestProbabilisticBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))
	block.Hash = "deadbeef"
	clone := cloneTestProbabilisticBlock(block)

	_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs), map[string]uint64{}, true, testNonceTracker(t, block, mustTestEpochContexts(t, cs)), testPoolRegistryTracker(t, block, mustTestEpochContexts(t, cs)))
	require.Error(t, err)
	require.Equal(t, clone, block)
}

func TestValidateProbabilisticBlockWitnessEnforcesRoles(t *testing.T) {
	testCases := []struct {
		name             string
		block            *ProbabilisticBlock
		requireFullBlock bool
		wantErr          string
	}{
		{name: "root accepts full block", block: &ProbabilisticBlock{BlockCbor: []byte{0x01}}, requireFullBlock: true},
		{name: "non-root accepts legacy full block", block: &ProbabilisticBlock{BlockCbor: []byte{0x01}}},
		{name: "non-root accepts compact header", block: &ProbabilisticBlock{HeaderCbor: []byte{0x01}}},
		{name: "root rejects compact header", block: &ProbabilisticBlock{HeaderCbor: []byte{0x01}}, requireFullBlock: true, wantErr: "requires full block_cbor"},
		{name: "rejects missing witness", block: &ProbabilisticBlock{}, wantErr: "must contain block_cbor or header_cbor"},
		{name: "rejects ambiguous witness", block: &ProbabilisticBlock{BlockCbor: []byte{0x01}, HeaderCbor: []byte{0x02}}, wantErr: "cannot contain both"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateProbabilisticBlockWitness(tc.block, "test", tc.requireFullBlock)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestAuthenticateBabbageHeaderWitnessMatchesLegacyFullBlock(t *testing.T) {
	fixture := loadBabbageWitnessFixture(t)
	poolKey := hex.EncodeToString(fixture.decodedHeader.IssuerVkey().Hash().Bytes())
	fullCounters := map[string]uint64{}

	full, err := fixture.clientState.authenticateProbabilisticBlock(
		fixture.block,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		fullCounters,
		false,
		testNonceTracker(t, fixture.block, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, fixture.block, []*EpochContext{fixture.epochContext}))
	require.NoError(t, err)
	require.Equal(t, uint64(8), full.operationalCertificateSequenceNumber)
	require.Equal(t, uint64(8), fullCounters[poolKey])

	compactBlock := cloneTestProbabilisticBlock(fixture.block)
	compactBlock.BlockCbor = nil
	compactBlock.HeaderCbor = bytes.Clone(fixture.headerCbor)
	compactCounters := map[string]uint64{}
	compact, err := fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		compactCounters,
		false,
		testNonceTracker(t, compactBlock, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, compactBlock, []*EpochContext{fixture.epochContext}))
	require.NoError(t, err)
	require.Equal(t, full, compact)
	require.Equal(t, probabilisticcore.HeaderBodyHash(fixture.decodedHeader), compact.bodyHash)
	require.Equal(t, uint64(8), compact.operationalCertificateSequenceNumber)
	require.Equal(t, uint64(8), compactCounters[poolKey])

	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{poolKey: 9},
		false,
		testNonceTracker(t, compactBlock, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, compactBlock, []*EpochContext{fixture.epochContext}))
	require.ErrorContains(t, err, "older than authenticated counter 9")

	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"anchor",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		true,
		testNonceTracker(t, compactBlock, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, compactBlock, []*EpochContext{fixture.epochContext}))
	require.ErrorContains(t, err, "requires full block_cbor")
}

func TestAuthenticateBabbageHeaderWitnessRejectsMutations(t *testing.T) {
	fixture := loadBabbageWitnessFixture(t)
	compactBlock := cloneTestProbabilisticBlock(fixture.block)
	compactBlock.BlockCbor = nil
	compactBlock.HeaderCbor = bytes.Clone(fixture.headerCbor)

	wrongSlot := cloneTestProbabilisticBlock(compactBlock)
	wrongSlot.Slot++
	_, err := fixture.clientState.authenticateProbabilisticBlock(
		wrongSlot,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		false,
		testNonceTracker(t, wrongSlot, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, wrongSlot, []*EpochContext{fixture.epochContext}))
	require.ErrorContains(t, err, "block slot mismatch")

	mutatedHeader := bytes.Clone(fixture.headerCbor)
	bodyHashOffset := bytes.Index(mutatedHeader, fixture.decodedHeader.Body.BlockBodyHash.Bytes())
	require.NotEqual(t, -1, bodyHashOffset)
	mutatedHeader[bodyHashOffset] ^= 0x01
	decodedMutatedHeader, err := probabilisticcore.DecodeLedgerHeader(mutatedHeader)
	require.NoError(t, err)
	compactBlock.HeaderCbor = mutatedHeader
	compactBlock.Hash = decodedMutatedHeader.Hash().String()
	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		false,
		testNonceTracker(t, compactBlock, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, compactBlock, []*EpochContext{fixture.epochContext}))
	require.ErrorContains(t, err, "header failed native Cardano verification")

	mutatedCertificate := bytes.Clone(fixture.headerCbor)
	signatureOffset := bytes.Index(mutatedCertificate, fixture.decodedHeader.Body.OpCert.Signature)
	require.NotEqual(t, -1, signatureOffset)
	mutatedCertificate[signatureOffset] ^= 0x01
	decodedMutatedCertificate, err := probabilisticcore.DecodeLedgerHeader(mutatedCertificate)
	require.NoError(t, err)
	compactBlock = cloneTestProbabilisticBlock(fixture.block)
	compactBlock.BlockCbor = nil
	compactBlock.HeaderCbor = mutatedCertificate
	compactBlock.Hash = decodedMutatedCertificate.Hash().String()
	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		false,
		testNonceTracker(t, compactBlock, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(t, compactBlock, []*EpochContext{fixture.epochContext}))
	require.ErrorContains(t, err, "operational certificate cold-key signature is invalid")
}

func BenchmarkAuthenticateBabbageWitness(b *testing.B) {
	fixture := loadBabbageWitnessFixture(b)
	poolKey := hex.EncodeToString(fixture.decodedHeader.IssuerVkey().Hash().Bytes())
	compactBlock := cloneTestProbabilisticBlock(fixture.block)
	compactBlock.BlockCbor = nil
	compactBlock.HeaderCbor = bytes.Clone(fixture.headerCbor)

	benchmarks := []struct {
		name  string
		block *ProbabilisticBlock
		size  int
	}{
		{name: "legacy_full_block", block: fixture.block, size: len(fixture.block.BlockCbor)},
		{name: "header_only", block: compactBlock, size: len(compactBlock.HeaderCbor)},
	}

	for _, benchmark := range benchmarks {
		b.Run(benchmark.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(benchmark.size))
			for b.Loop() {
				counters := map[string]uint64{poolKey: 8}
				authenticated, err := fixture.clientState.authenticateProbabilisticBlock(
					benchmark.block,
					"bridge",
					[]*EpochContext{fixture.epochContext},
					counters,
					false,
					testNonceTracker(b, benchmark.block, []*EpochContext{fixture.epochContext}), testPoolRegistryTracker(b, benchmark.block, []*EpochContext{fixture.epochContext}))
				if err != nil {
					b.Fatal(err)
				}
				if authenticated.operationalCertificateSequenceNumber != 8 || counters[poolKey] != 8 {
					b.Fatalf(
						"unexpected operational certificate result: sequence=%d counter=%d",
						authenticated.operationalCertificateSequenceNumber,
						counters[poolKey],
					)
				}
			}
		})
	}
}

type babbageWitnessFixture struct {
	clientState   *ClientState
	epochContext  *EpochContext
	block         *ProbabilisticBlock
	headerCbor    []byte
	decodedHeader *ledger.BabbageBlockHeader
}

func loadBabbageWitnessFixture(t testing.TB) babbageWitnessFixture {
	t.Helper()

	fixtureHex, err := os.ReadFile("../testdata/babbage_block.hex")
	require.NoError(t, err)
	blockCbor, err := hex.DecodeString(strings.Join(strings.Fields(string(fixtureHex)), ""))
	require.NoError(t, err)
	decodedBlock, err := decodeLedgerBlock(blockCbor)
	require.NoError(t, err)
	headerHex, _, vrfKey, err := buildBlockVerificationArtifacts(decodedBlock)
	require.NoError(t, err)
	headerCbor, err := hex.DecodeString(headerHex)
	require.NoError(t, err)
	decodedHeader, err := probabilisticcore.DecodeLedgerHeader(headerCbor)
	require.NoError(t, err)
	epochNonce, err := hex.DecodeString("53606952e39eadd5eea559be517f9741c9538073e987ec1b7a6c7a05db6195d3")
	require.NoError(t, err)
	vrfKeyHash := blake2b.Sum256(vrfKey)

	clientState := newProbabilisticTestClientState()
	clientState.SystemStartUnixNs = 1
	clientState.SlotLengthNs = 1
	clientState.CurrentEpochStartSlot = decodedBlock.SlotNumber()
	clientState.CurrentEpochEndSlotExclusive = decodedBlock.SlotNumber() + 1
	epochContext := &EpochContext{
		Epoch:                 7,
		EpochNonce:            epochNonce,
		SlotsPerKesPeriod:     129600,
		EpochStartSlot:        decodedBlock.SlotNumber(),
		EpochEndSlotExclusive: decodedBlock.SlotNumber() + 1,
		StakeDistribution: []*StakeDistributionEntry{{
			PoolId:                   decodedBlock.IssuerVkey().PoolId(),
			Stake:                    1,
			VrfKeyHash:               vrfKeyHash[:],
			RelativeStakeNumerator:   4_178_103_721_131,
			RelativeStakeDenominator: 5_019_556_879_197_493,
		}},
	}
	block := &ProbabilisticBlock{
		Height:    NewHeight(0, decodedBlock.BlockNumber()),
		Hash:      decodedBlock.Hash().String(),
		Slot:      decodedBlock.SlotNumber(),
		Epoch:     epochContext.Epoch,
		Timestamp: 1 + decodedBlock.SlotNumber(),
		BlockCbor: blockCbor,
	}
	return babbageWitnessFixture{
		clientState:   clientState,
		epochContext:  epochContext,
		block:         block,
		headerCbor:    headerCbor,
		decodedHeader: decodedHeader,
	}
}

func TestVerifyHostStateTxIncludedInAnchorBlockRejectsMissingTx(t *testing.T) {
	header := &ProbabilisticHeader{
		AnchorBlock:     makeTestProbabilisticBlock(t, 30, 300, hex.EncodeToString(bytes.Repeat([]byte{0x33}, 32))),
		HostStateTxHash: "deadbeef",
	}

	err := verifyHostStateTxIncludedInAnchorBlock(header)
	require.ErrorContains(t, err, "not found in authenticated anchor block")
}

func TestHostStateExtractionRejectsPhase2InvalidTransaction(t *testing.T) {
	fixtureHex, err := os.ReadFile("../testdata/babbage_host_state_tx_validity_block.hex")
	require.NoError(t, err)
	blockCbor, err := hex.DecodeString(strings.TrimSpace(string(fixtureHex)))
	require.NoError(t, err)
	decodedBlock, err := decodeLedgerBlock(blockCbor)
	require.NoError(t, err)
	require.Len(t, decodedBlock.Transactions(), 2)
	transactions := decodedBlock.Transactions()
	require.False(t, transactions[0].IsValid())
	require.True(t, transactions[1].IsValid())

	epochNonce := bytes.Repeat([]byte{0x55}, 32)
	_, _, vrfKey, err := buildBlockVerificationArtifacts(decodedBlock)
	require.NoError(t, err)
	vrfKeyHash := blake2b.Sum256(vrfKey)
	clientState := newProbabilisticTestClientState()
	clientState.SystemStartUnixNs = 1
	clientState.SlotLengthNs = 1
	clientState.CurrentEpochStartSlot = decodedBlock.SlotNumber()
	clientState.CurrentEpochEndSlotExclusive = decodedBlock.SlotNumber() + 1
	clientState.SlotsPerKesPeriod = 100
	clientState.ActiveSlotCoefficientNumerator = 1
	clientState.ActiveSlotCoefficientDenominator = 1
	clientState.HostStateNftPolicyId = bytes.Repeat([]byte{0x24}, 28)
	clientState.HostStateNftTokenName = []byte("host-state")
	epochContext := &EpochContext{
		Epoch:                 7,
		EpochNonce:            epochNonce,
		SlotsPerKesPeriod:     100,
		EpochStartSlot:        decodedBlock.SlotNumber(),
		EpochEndSlotExclusive: decodedBlock.SlotNumber() + 1,
		StakeDistribution: []*StakeDistributionEntry{{
			PoolId:                   decodedBlock.IssuerVkey().PoolId(),
			Stake:                    1,
			VrfKeyHash:               vrfKeyHash[:],
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 1,
		}},
	}
	anchorBlock := &ProbabilisticBlock{
		Height:    NewHeight(0, decodedBlock.BlockNumber()),
		Hash:      decodedBlock.Hash().String(),
		Slot:      decodedBlock.SlotNumber(),
		Epoch:     epochContext.Epoch,
		Timestamp: 1 + decodedBlock.SlotNumber(),
		BlockCbor: blockCbor,
	}
	_, err = clientState.authenticateProbabilisticBlock(
		anchorBlock,
		"anchor",
		[]*EpochContext{epochContext},
		map[string]uint64{},
		true,
		testNonceTracker(t, anchorBlock, []*EpochContext{epochContext}), testPoolRegistryTracker(t, anchorBlock, []*EpochContext{epochContext}))
	require.NoError(t, err)

	testCases := []struct {
		name         string
		transaction  ledger.Transaction
		invalid      bool
		expectedRoot []byte
	}{
		{
			name:        "phase-2-invalid target",
			transaction: transactions[0],
			invalid:     true,
		},
		{
			name:         "valid control",
			transaction:  transactions[1],
			expectedRoot: bytes.Repeat([]byte{0x43}, 32),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			header := &ProbabilisticHeader{
				AnchorBlock:     anchorBlock,
				HostStateTxHash: tc.transaction.Hash().String(),
			}
			_, authenticationErr := clientState.authenticateHeaderBlocksWithContexts(
				header,
				[]*EpochContext{epochContext},
				map[string]uint64{},
				testHeaderTrustedNonceState(t, header, []*EpochContext{epochContext}))
			root, rootErr := clientState.ExtractIbcStateRootFromHostStateTx(header)

			if tc.invalid {
				require.ErrorContains(t, authenticationErr, "phase-2 invalid")
				require.ErrorIs(t, authenticationErr, ErrInvalidHostStateCommitment)
				require.ErrorContains(t, rootErr, "phase-2 invalid")
				require.ErrorIs(t, rootErr, ErrInvalidHostStateCommitment)
				require.Nil(t, root)
				return
			}

			require.NoError(t, authenticationErr)
			require.NoError(t, rootErr)
			require.Equal(t, tc.expectedRoot, root)
		})
	}
}

func TestComputeHeaderSecurityMetricsRejectsEmptyEpochStakeDistribution(t *testing.T) {
	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
	}

	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
		},
	}

	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	authenticatedHeader.anchorSettlementCredit = &SettlementCreditState{Epoch: epochContext.Epoch}
	authenticatedHeader.anchorPoolProduction = &PoolProductionHistory{Epoch: epochContext.Epoch}
	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
	require.ErrorContains(t, err, "stake distribution must not be empty")
}

func TestComputeHeaderSecurityMetricsExcludesPoolsRegisteredAfterCutoff(t *testing.T) {
	cs := newProbabilisticTestClientState()
	cutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive(testMaturePoolSlot)
	require.NoError(t, err)
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "pool-a",
				Stake:                 500,
				VrfKeyHash:            bytes.Repeat([]byte{0x02}, 32),
				FirstRegistrationSlot: 1,
			},
			{
				PoolId:                "pool-b",
				Stake:                 500,
				VrfKeyHash:            bytes.Repeat([]byte{0x04}, 32),
				FirstRegistrationSlot: cutoffSlot,
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			slot:   testMaturePoolSlot,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
			{height: 14, hash: "descendant-14", prevHash: "descendant-13", epoch: cs.CurrentEpoch, slotLeader: "pool-b"},
		},
	}

	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	authenticatedHeader.anchorSettlementCredit = mustTestSettlementCredit(epochContext)
	authenticatedHeader.anchorPoolProduction = testPoolProduction(epochContext)
	qualifiedUniquePools, qualifiedUniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedUniquePools)
	require.Equal(t, uint64(5000), qualifiedUniqueStakeBps)
}

func TestComputeHeaderSecurityMetricsIgnoresPoolRegistrationCutoffEnv(t *testing.T) {
	t.Setenv("CARDANO_STABILITY_POOL_REGISTRATION_CUTOFF_SLOT", "2")

	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:                "pool-a",
				Stake:                 10_000,
				VrfKeyHash:            bytes.Repeat([]byte{0x02}, 32),
				FirstRegistrationSlot: 3,
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			slot:   testMaturePoolSlot,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
		},
	}

	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, epochContext.StakeDistribution)
	authenticatedHeader.anchorSettlementCredit = mustTestSettlementCredit(epochContext)
	authenticatedHeader.anchorPoolProduction = testPoolProduction(epochContext)
	qualifiedUniquePools, qualifiedUniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedUniquePools)
	require.Equal(t, uint64(10000), qualifiedUniqueStakeBps)
}

func TestComputeHeaderSecurityMetricsFailsClosedWhenRegistrationIsMissing(t *testing.T) {
	cs := newProbabilisticTestClientState()
	epochContext := &EpochContext{
		Epoch:                 cs.CurrentEpoch,
		EpochNonce:            bytes.Repeat([]byte{0x03}, 32),
		SlotsPerKesPeriod:     cs.SlotsPerKesPeriod,
		EpochStartSlot:        cs.CurrentEpochStartSlot,
		EpochEndSlotExclusive: cs.CurrentEpochEndSlotExclusive,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:     "pool-a",
				Stake:      10_000,
				VrfKeyHash: bytes.Repeat([]byte{0x02}, 32),
			},
		},
	}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 12,
			hash:   "anchor-12",
			slot:   120,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
		},
	}

	authenticatedHeader.anchorPoolRegistry = testPoolRegistry(epochContext.Epoch, nil)
	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.ErrorContains(t, err, "no authenticated effective registration")
}

func TestVerifyHeaderEpochTransitionAcceptsAdjacentEpochRollover(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 8},
	}
	trustedBlock := &trustedBlockState{epoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			epoch: 8,
		},
		bridgeBlocks: []*authenticatedProbabilisticBlock{
			{epoch: 7},
			{epoch: 8},
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{epoch: 8},
		},
	}

	err := verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader)
	require.NoError(t, err)
}

func TestVerifyHeaderEpochTransitionAcceptsMatchingSameEpochContext(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 7},
	}
	trustedBlock := &trustedBlockState{epoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock:      &authenticatedProbabilisticBlock{epoch: 7},
		bridgeBlocks:     []*authenticatedProbabilisticBlock{{epoch: 7}},
		descendantBlocks: []*authenticatedProbabilisticBlock{{epoch: 7}},
	}

	err := verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader)
	require.NoError(t, err)
}

func TestVerifyHeaderEpochTransitionRejectsMismatchedSameEpochContext(t *testing.T) {
	header := &ProbabilisticHeader{
		NewEpochContext: &EpochContext{Epoch: 8},
	}
	trustedBlock := &trustedBlockState{epoch: 7}
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock:      &authenticatedProbabilisticBlock{epoch: 7},
		bridgeBlocks:     []*authenticatedProbabilisticBlock{{epoch: 7}},
		descendantBlocks: []*authenticatedProbabilisticBlock{{epoch: 7}},
	}

	err := verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader)
	require.ErrorContains(t, err, "same-epoch new_epoch_context epoch 8 must match accepted epoch 7")
}

func TestNormalizeEpochContextsRejectsConflictingDuplicateEpoch(t *testing.T) {
	cs := newProbabilisticTestClientState()
	first := cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	second := cloneEpochContext(first)
	second.StakeDistribution[0].Stake++

	_, err := normalizeEpochContexts([]*EpochContext{first, second})
	require.ErrorContains(t, err, "conflicting epoch context for epoch 7")
}

func TestNormalizeEpochContextsRejectsConflictingFirstRegistrationSlot(t *testing.T) {
	cs := newProbabilisticTestClientState()
	first := cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	second := cloneEpochContext(first)
	second.StakeDistribution[0].FirstRegistrationSlot++

	_, err := normalizeEpochContexts([]*EpochContext{first, second})
	require.ErrorContains(t, err, "conflicting epoch context for epoch 7")
}

func TestMergeEpochContextsAllowsCandidateForStoredEpoch(t *testing.T) {
	cs := newProbabilisticTestClientState()
	stored := cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	candidate := cloneEpochContext(stored)
	candidate.StakeDistribution[0].Stake++

	contexts, err := mergeEpochContexts([]*EpochContext{stored}, candidate)
	require.NoError(t, err)
	require.Len(t, contexts, 1)
	require.Equal(t, candidate.StakeDistribution[0].Stake, contexts[0].StakeDistribution[0].Stake)
}

func TestCheckForMisbehaviourIgnoresUnsignedEpochContextDisagreement(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	header.NewEpochContext.StakeDistribution[0].Stake++

	require.False(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourIgnoresMatchingEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-matching-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))

	require.False(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestHeaderValidateBasicRejectsTrustedHeightEdgeCases(t *testing.T) {
	header := newVerifiedTestHeader(t)

	header.TrustedHeight = &Height{}
	err := header.validateObservationEvidence()
	require.ErrorContains(t, err, "trusted height cannot be zero")

	header = newVerifiedTestHeader(t)
	header.TrustedHeight = &Height{RevisionHeight: header.AnchorBlock.Height.RevisionHeight}
	err = header.validateObservationEvidence()
	require.ErrorContains(t, err, "trusted height")
}

func TestCollectReferencedConsensusEpochsCollectsAllStoredEpochs(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-collect-epochs")

	consensus7 := newProbabilisticTestConsensusState(testBlockHash("hash-10"))
	consensus7.AcceptedEpoch = 7
	setTestMetadataConsensus(clientStore, cdc, consensus7, NewHeight(0, 10))
	SetConsensusMetadataWithValues(clientStore, NewHeight(0, 10), NewHeight(0, 10), consensus7.Timestamp)

	consensus8 := newProbabilisticTestConsensusState(testBlockHash("hash-11"))
	consensus8.AcceptedEpoch = 8
	setTestMetadataConsensus(clientStore, cdc, consensus8, NewHeight(0, 11))
	SetConsensusMetadataWithValues(clientStore, NewHeight(0, 11), NewHeight(0, 11), consensus8.Timestamp)

	consensus9 := newProbabilisticTestConsensusState(testBlockHash("hash-12"))
	consensus9.AcceptedEpoch = 9
	setTestMetadataConsensus(clientStore, cdc, consensus9, NewHeight(0, 12))
	SetConsensusMetadataWithValues(clientStore, NewHeight(0, 12), NewHeight(0, 12), consensus9.Timestamp)

	referencedEpochs := collectReferencedConsensusEpochs(clientStore, cdc)

	require.Equal(t, map[uint64]struct{}{
		7: {},
		8: {},
		9: {},
	}, referencedEpochs)
}

func TestSetConsensusMetadataStoresParseableProcessedHeight(t *testing.T) {
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-processed-height")
	consensusHeight := NewHeight(0, 42)

	setConsensusMetadata(ctx, clientStore, consensusHeight)

	processedHeight, found := GetProcessedHeight(clientStore, consensusHeight)
	require.True(t, found)
	require.Equal(t, ctx.SelfHeight, processedHeight)
}

func TestCheckpointHeaderHasNoHostStateCommitment(t *testing.T) {
	header := &ProbabilisticHeader{
		TrustedHeight: &Height{RevisionHeight: 10},
		AnchorBlock: &ProbabilisticBlock{
			Height:    &Height{RevisionHeight: 11},
			Hash:      "checkpoint-hash",
			BlockCbor: []byte{0x01},
		},
		IsCheckpoint: true,
	}

	require.NoError(t, header.validateObservationEvidence())
	header.HostStateTxHash = "must-not-be-present"
	require.ErrorContains(t, header.validateObservationEvidence(), "must not contain HostState transaction fields")

	header.IsCheckpoint = false
	header.HostStateTxHash = ""
	require.NoError(t, header.validateObservationEvidence())
}

func newProbabilisticTestCodec() StateCodec { return jsonTestCodec{} }

func newProbabilisticTestClientStore(t *testing.T, keyName string) (Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := Context{Time: time.Unix(1_700_000_000, 0), Height: 100, SelfHeight: NewHostHeight(0, 100)}
	// Unit tests model an uninterrupted host. Native acceptance records real blocks.
	ctx.HostProgress = testHostProgress

	return ctx, stateStore.GetKVStore(key)
}

func testHostProgress(current Context) *HostProgress {
	return &HostProgress{
		Height: current.Height, TimeUnixNs: uint64(current.Time.UnixNano()),
		PreviousTimeUnixNs: uint64(current.Time.UnixNano() - 1), ClockID: 1, ObservationTime: uint64(current.Time.UnixNano()), PreviousObservationTime: uint64(current.Time.UnixNano() - 1),
	}
}

func newProbabilisticTestClientState() *ClientState {
	zeroHeight := ZeroHeight()
	epochStakeDistribution := []*StakeDistributionEntry{
		{
			PoolId:                   "pool-a",
			Stake:                    10_000,
			VrfKeyHash:               bytes.Repeat([]byte{0x02}, 32),
			FirstRegistrationSlot:    0,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 1,
		},
	}
	epochNonce := bytes.Repeat([]byte{0x03}, 32)
	return &ClientState{
		LatestCheckpointHeight:                          NewHeight(0, 10),
		LatestCheckpointBlockHash:                       testBlockHash("trusted-hash"),
		LatestCheckpointEpoch:                           7,
		LatestCheckpointTimestamp:                       1_700_000_000_000_000_000,
		ChainId:                                         "cardano-test",
		LatestHeight:                                    &Height{RevisionHeight: 10},
		FrozenHeight:                                    zeroHeight,
		CurrentEpoch:                                    7,
		TrustingPeriod:                                  24 * time.Hour,
		HostStateNftPolicyId:                            bytes.Repeat([]byte{0x01}, 28),
		PacketLanePolicyId:                              bytes.Repeat([]byte{0x04}, 28),
		HostStateNftTokenName:                           []byte("host-state"),
		EpochStakeDistribution:                          cloneStakeDistributionEntries(epochStakeDistribution),
		EpochNonce:                                      bytes.Clone(epochNonce),
		LatestCheckpointNonceState:                      testNonceState(epochNonce),
		LatestCheckpointPoolRegistry:                    testPoolRegistry(7, epochStakeDistribution),
		LatestCheckpointSettlementCredit:                mustTestSettlementCredit(&EpochContext{Epoch: 7, StakeDistribution: epochStakeDistribution}),
		LatestCheckpointPoolProduction:                  testPoolProduction(&EpochContext{Epoch: 7, StakeDistribution: epochStakeDistribution}),
		RandomnessStabilisationWindowSlots:              10,
		SlotsPerKesPeriod:                               129600,
		MaxKesEvolutions:                                62,
		ActiveSlotCoefficientNumerator:                  1,
		ActiveSlotCoefficientDenominator:                20,
		MaxClockDrift:                                   time.Minute,
		OperationalCertificateCounterHistoryStartHeight: NewHeight(0, 10),
		CurrentEpochStartSlot:                           0,
		CurrentEpochEndSlotExclusive:                    1_000_000,
		SystemStartUnixNs:                               1_700_000_000_000_000_000,
		SlotLengthNs:                                    1_000_000_000,
		EpochContexts: []*EpochContext{
			{
				Epoch:                 7,
				StakeDistribution:     epochStakeDistribution,
				EpochNonce:            epochNonce,
				SlotsPerKesPeriod:     129600,
				EpochStartSlot:        0,
				EpochEndSlotExclusive: 1_000_000,
			},
		},
	}
}

func setTestCheckpoint(
	t testing.TB,
	clientState *ClientState,
	height *Height,
	hash string,
	epoch uint64,
	slot uint64,
) {
	t.Helper()
	timestamp, err := clientState.DeriveTimestampFromSlot(slot)
	require.NoError(t, err)
	clientState.setLatestCheckpoint(height, hash, epoch, slot, timestamp)
}

func setTestPacketSnapshot(t testing.TB, consensus *ConsensusState, height uint64) {
	t.Helper()
	raw, err := probabilisticcore.EncodePacketStateSnapshot(probabilisticcore.PacketStateSnapshot{
		Height: height, BlockHash: consensus.AcceptedBlockHash, HostTxHash: strings.Repeat("22", 32),
		HostRoot: consensus.IbcStateRoot, Lanes: map[string]probabilisticcore.TrackedPacketLane{},
	})
	require.NoError(t, err)
	consensus.PacketStateSnapshot = raw
}

func testBlockHash(label string) string {
	hash := blake2b.Sum256([]byte(label))
	return hex.EncodeToString(hash[:])
}

func newProbabilisticTestConsensusState(acceptedBlockHash string, heights ...uint64) *ConsensusState {
	height := uint64(10)
	if len(heights) > 0 {
		height = heights[0]
	}
	snapshot, _ := probabilisticcore.EncodePacketStateSnapshot(probabilisticcore.PacketStateSnapshot{
		Height: height, BlockHash: acceptedBlockHash, HostTxHash: strings.Repeat("22", 32),
		HostRoot: bytes.Repeat([]byte{0x11}, 32), Lanes: map[string]probabilisticcore.TrackedPacketLane{},
	})
	return &ConsensusState{
		PacketStateSnapshot: snapshot,
		NonceState:          testNonceState(bytes.Repeat([]byte{0x03}, 32)),
		PoolRegistry:        clonePoolRegistry(newProbabilisticTestClientState().LatestCheckpointPoolRegistry),
		SettlementCredit:    cloneSettlementCredit(newProbabilisticTestClientState().LatestCheckpointSettlementCredit),
		PoolProduction:      clonePoolProduction(newProbabilisticTestClientState().LatestCheckpointPoolProduction),
		Timestamp:           uint64(time.Unix(1_700_000_000, 0).UnixNano()),
		IbcStateRoot:        bytes.Repeat([]byte{0x11}, 32),
		AcceptedBlockHash:   acceptedBlockHash,
		AcceptedEpoch:       7,
		UniquePoolsCount:    1,
		UniqueStakeBps:      10_000,
		SecurityScoreBps:    10_000,
	}
}

func newVerifiedTestHeader(t *testing.T) *ProbabilisticHeader {
	t.Helper()

	trustedHash := bytes.Repeat([]byte{0x11}, 32)
	bridge := makeTestProbabilisticBlock(t, 11, 110, hex.EncodeToString(trustedHash))
	anchor := makeTestProbabilisticBlock(t, 12, 120, bridge.Hash)
	descendant := makeTestProbabilisticBlock(t, 13, 130, anchor.Hash)

	return &ProbabilisticHeader{
		TrustedHeight:          &Height{RevisionHeight: 10},
		BridgeBlocks:           []*ProbabilisticBlock{bridge},
		AnchorBlock:            anchor,
		DescendantBlocks:       []*ProbabilisticBlock{descendant},
		HostStateTxHash:        "deadbeef",
		HostStateTxOutputIndex: 0,
	}
}

func makeTestProbabilisticBlock(t testing.TB, blockNumber, slot uint64, prevHashHex string) *ProbabilisticBlock {
	t.Helper()

	block := ledger.BabbageBlock{
		BlockHeader: &ledger.BabbageBlockHeader{},
	}
	block.BlockHeader.Body.BlockNumber = blockNumber
	block.BlockHeader.Body.Slot = slot
	if prevHashHex != "" {
		prevHashBytes, err := hex.DecodeString(prevHashHex)
		require.NoError(t, err)
		block.BlockHeader.Body.PrevHash = ledger.NewBlake2b256(prevHashBytes)
	}

	// Hash the exact encoded body components, just as ledger validation does.
	initial, err := cbor.Encode(block)
	require.NoError(t, err)
	var fields []cbor.RawMessage
	_, err = cbor.Decode(initial, &fields)
	require.NoError(t, err)
	hashes := []byte{}
	for _, field := range fields[1:] {
		hash := blake2b.Sum256(field)
		hashes = append(hashes, hash[:]...)
	}
	hash := blake2b.Sum256(hashes)
	block.BlockHeader.Body.BlockBodyHash = ledger.NewBlake2b256(hash[:])
	blockCbor, err := cbor.Encode(block)
	require.NoError(t, err)
	_, err = cbor.Decode(blockCbor, &block)
	require.NoError(t, err)

	return &ProbabilisticBlock{
		Height:    &Height{RevisionHeight: block.BlockNumber()},
		Hash:      block.Hash().String(),
		Slot:      block.SlotNumber(),
		Epoch:     7,
		Timestamp: 1_700_000_000_000_000_000 + block.SlotNumber()*1_000_000_000,
		BlockCbor: blockCbor,
	}
}

func mustTestBlockPrevHash(t *testing.T, block *ProbabilisticBlock) string {
	t.Helper()

	decodedBlock, err := decodeLedgerBlock(block.BlockCbor)
	require.NoError(t, err)

	prevHash, err := blockPrevHash(decodedBlock)
	require.NoError(t, err)

	return prevHash
}

func cloneTestProbabilisticBlock(block *ProbabilisticBlock) *ProbabilisticBlock {
	if block == nil {
		return nil
	}
	clone := *block
	if block.Height != nil {
		height := *block.Height
		clone.Height = &height
	}
	if block.BlockCbor != nil {
		clone.BlockCbor = append([]byte(nil), block.BlockCbor...)
	}
	if block.HeaderCbor != nil {
		clone.HeaderCbor = append([]byte(nil), block.HeaderCbor...)
	}
	return &clone
}

func mustTestEpochContexts(t *testing.T, cs *ClientState) []*EpochContext {
	t.Helper()

	contexts, err := cs.normalizedEpochContexts()
	require.NoError(t, err)
	return contexts
}

func mustCurrentTestEpochContext(t *testing.T, cs *ClientState) *EpochContext {
	t.Helper()

	context := epochContextByEpoch(mustTestEpochContexts(t, cs), cs.CurrentEpoch)
	require.NotNil(t, context)
	return context
}

// Metadata iteration tests use bounded records without requiring proof pages.
func setTestMetadataConsensus(store storetypes.KVStore, cdc StateCodec, input *ConsensusState, height HeightValue) {
	record := &ConsensusState{Timestamp: input.Timestamp, IbcStateRoot: bytes.Clone(input.IbcStateRoot), AcceptedBlockHash: input.AcceptedBlockHash, AcceptedEpoch: input.AcceptedEpoch, VerificationGeneration: 1, CheckpointReference: bytes.Repeat([]byte{1}, 32), PacketStateReference: bytes.Repeat([]byte{2}, 32)}
	store.Set(generationKey(), uint64ToBigEndian(1))
	SetConsensusState(store, cdc, record, height)
}
