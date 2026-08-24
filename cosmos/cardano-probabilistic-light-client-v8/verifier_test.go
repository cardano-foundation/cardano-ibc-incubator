package probabilistic

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/stretchr/testify/require"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"golang.org/x/crypto/blake2b"
)

func TestVerifyBridgeContinuityRejectsBadPrevHash(t *testing.T) {
	trustedBlock := &trustedBlockState{
		height:    &Height{RevisionHeight: 10},
		blockHash: "trusted-hash",
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

func TestInitialStateWithFourThousandPoolsStaysBelowOneMegabyte(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	stakeDistribution := make([]*StakeDistributionEntry, 0, 4_000)
	counters := make([]*OperationalCertificateCounter, 0, 4_000)
	for index := uint32(1); index <= 4_000; index++ {
		poolID := make([]byte, 28)
		binary.BigEndian.PutUint32(poolID[24:], index)
		vrfKeyHash := make([]byte, 32)
		binary.BigEndian.PutUint32(vrfKeyHash[28:], index)
		stakeDistribution = append(stakeDistribution, &StakeDistributionEntry{
			PoolId:                   hex.EncodeToString(poolID),
			Stake:                    1,
			VrfKeyHash:               vrfKeyHash,
			FirstRegistrationSlot:    1,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 4_000,
		})
		counters = append(counters, &OperationalCertificateCounter{
			PoolId:         poolID,
			SequenceNumber: 1,
		})
	}
	clientState.EpochStakeDistribution = cloneStakeDistributionEntries(stakeDistribution)
	clientState.EpochContexts[0].StakeDistribution = stakeDistribution
	clientState.LatestCheckpointOperationalCertificateCounters = counters
	clientBytes, err := clientState.Marshal()
	require.NoError(t, err)
	consensusBytes, err := newProbabilisticTestConsensusState("initial-block-hash").Marshal()
	require.NoError(t, err)

	require.Less(t, len(clientBytes)+len(consensusBytes), 1_000_000)
	require.Less(t, len(consensusBytes), 1_000)
}

func TestAuthenticateRealBabbageBlockEnforcesOperationalCertificateCounter(t *testing.T) {
	fixtureHex, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/babbage_block.hex")
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
		Hash:      decodedBlock.Hash(),
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
	)
	require.ErrorContains(t, err, "older than authenticated counter 9")

	counters := map[string]uint64{poolKey: 8}
	authenticated, err := clientState.authenticateProbabilisticBlock(
		block,
		"anchor",
		[]*EpochContext{epochContext},
		counters,
		true,
	)
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
			_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs), map[string]uint64{}, true)
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestAuthenticateProbabilisticBlockDoesNotMutateInput(t *testing.T) {
	cs := newProbabilisticTestClientState()
	block := makeTestProbabilisticBlock(t, 21, 210, hex.EncodeToString(bytes.Repeat([]byte{0x22}, 32)))
	block.Hash = "deadbeef"
	clone := cloneTestProbabilisticBlock(block)

	_, err := cs.authenticateProbabilisticBlock(block, "anchor", mustTestEpochContexts(t, cs), map[string]uint64{}, true)
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
	)
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
	)
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
	)
	require.ErrorContains(t, err, "older than authenticated counter 9")

	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"anchor",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		true,
	)
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
	)
	require.ErrorContains(t, err, "block slot mismatch")

	mutatedHeader := bytes.Clone(fixture.headerCbor)
	bodyHashOffset := bytes.Index(mutatedHeader, fixture.decodedHeader.Body.BlockBodyHash.Bytes())
	require.NotEqual(t, -1, bodyHashOffset)
	mutatedHeader[bodyHashOffset] ^= 0x01
	decodedMutatedHeader, err := probabilisticcore.DecodeLedgerHeader(mutatedHeader)
	require.NoError(t, err)
	compactBlock.HeaderCbor = mutatedHeader
	compactBlock.Hash = decodedMutatedHeader.Hash()
	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		false,
	)
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
	compactBlock.Hash = decodedMutatedCertificate.Hash()
	_, err = fixture.clientState.authenticateProbabilisticBlock(
		compactBlock,
		"bridge",
		[]*EpochContext{fixture.epochContext},
		map[string]uint64{},
		false,
	)
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
				)
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

	fixtureHex, err := os.ReadFile("../cardano-probabilistic-light-client-core/testdata/babbage_block.hex")
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
		Hash:      decodedBlock.Hash(),
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

func TestVerifyHeaderRejectsMissingTrustedConsensus(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-missing-trusted")
	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted consensus state not found")
}

func TestVerifyHeaderRejectsMissingOperationalCertificateBaseline(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-missing-opcert-baseline")
	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)

	decodedBridge, err := decodeLedgerBlock(header.BridgeBlocks[0].BlockCbor)
	require.NoError(t, err)
	cs.EpochContexts[0].StakeDistribution[0].PoolId = decodedBridge.IssuerVkey().PoolId()
	cs.OperationalCertificateCounterHistoryStartHeight = nil
	setConsensusState(
		clientStore,
		cdc,
		newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])),
		NewHeight(0, 10),
	)

	err = cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "operational certificate counter history start height must be present")
}

func TestVerifyHeaderRejectsCrossEpochBlock(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-cross-epoch")
	cs := newProbabilisticTestClientState()

	header := newVerifiedTestHeader(t)
	trustedHash := mustTestBlockPrevHash(t, header.BridgeBlocks[0])
	anchorPrevHash := header.BridgeBlocks[0].Hash
	header.BridgeBlocks = nil
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(trustedHash), NewHeight(0, 10))
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, anchorPrevHash)

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "outside available epoch context bounds")
}

func TestVerifyHeaderRejectsTrustedHeightOlderThanLatestHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-stale-trusted")
	cs := newProbabilisticTestClientState()
	cs.LatestHeight = NewHeight(0, 11)

	header := newVerifiedTestHeader(t)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(mustTestBlockPrevHash(t, header.BridgeBlocks[0])), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(header.BridgeBlocks[0].Hash), NewHeight(0, 11))

	err := cs.verifyHeader(sdk.Context{}, clientStore, cdc, header)
	require.ErrorContains(t, err, "trusted height")
	require.ErrorContains(t, err, "must equal latest authenticated checkpoint")
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

	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)
	require.ErrorContains(t, err, "stake distribution must not be empty")
}

func TestComputeHeaderSecurityMetricsExcludesPoolsRegisteredAfterCutoff(t *testing.T) {
	cs := newProbabilisticTestClientState()
	cutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive()
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
			slot:   120,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
			{height: 14, hash: "descendant-14", prevHash: "descendant-13", epoch: cs.CurrentEpoch, slotLeader: "pool-b"},
		},
	}

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
			slot:   120,
			epoch:  cs.CurrentEpoch,
		},
		descendantBlocks: []*authenticatedProbabilisticBlock{
			{height: 13, hash: "descendant-13", prevHash: "anchor-12", epoch: cs.CurrentEpoch, slotLeader: "pool-a"},
		},
	}

	qualifiedUniquePools, qualifiedUniqueStakeBps, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.NoError(t, err)
	require.Equal(t, uint64(1), qualifiedUniquePools)
	require.Equal(t, uint64(10000), qualifiedUniqueStakeBps)
}

func TestComputeHeaderSecurityMetricsFailsClosedWhenPoolAgeIsMissing(t *testing.T) {
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

	_, _, _, err := cs.computeHeaderSecurityMetrics(authenticatedHeader, epochContext)

	require.ErrorContains(t, err, "first registration slot missing")
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

func TestCheckForMisbehaviourDetectsConflictingHeaderAtSameHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-header")

	cs := newProbabilisticTestClientState()
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("existing-anchor"), NewHeight(0, 12))

	header := newVerifiedTestHeader(t)
	header.AnchorBlock.Hash = "different-anchor"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	header.NewEpochContext.StakeDistribution[0].Stake++

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestFirstRegistrationSlotConflictFreezesClient(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-registration-slot")

	cs := newProbabilisticTestClientState()
	setClientState(clientStore, cdc, cs)
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	cutoffSlot, err := cs.poolRegistrationCutoffSlotExclusive()
	require.NoError(t, err)
	require.Greater(t, cutoffSlot, header.NewEpochContext.StakeDistribution[0].FirstRegistrationSlot)
	header.NewEpochContext.StakeDistribution[0].FirstRegistrationSlot = cutoffSlot

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
	cs.UpdateStateOnMisbehaviour(ctx, cdc, clientStore, header)

	frozen, found := getClientState(clientStore, cdc)
	require.True(t, found)
	require.True(t, frozen.FrozenHeight.EQ(FrozenHeight))
	require.Equal(t, exported.Frozen, frozen.Status(ctx, clientStore, cdc))
}

func TestCheckForMisbehaviourIgnoresMatchingEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-matching-epoch-context")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	header.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))

	require.False(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingWindowAgainstStoredConsensus(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-window")

	cs := newProbabilisticTestClientState()
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("trusted-hash"), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("accepted-bridge-11"), NewHeight(0, 11))

	header := newVerifiedTestHeader(t)
	header.BridgeBlocks[0].Hash = "conflicting-bridge-11"

	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, clientStore, header))
}

func TestCheckForMisbehaviourDetectsConflictingMisbehaviourMessage(t *testing.T) {
	cs := newProbabilisticTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock.Hash = "different-anchor"

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestCheckForMisbehaviourDetectsConflictingEpochContextsInMisbehaviourMessage(t *testing.T) {
	cs := newProbabilisticTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header1.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	header2.NewEpochContext = cloneEpochContext(header1.NewEpochContext)
	header2.NewEpochContext.StakeDistribution[0].Stake++

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestCheckForMisbehaviourDetectsFirstRegistrationSlotConflictBetweenHeaders(t *testing.T) {
	cs := newProbabilisticTestClientState()
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header1.NewEpochContext = cloneEpochContext(mustCurrentTestEpochContext(t, cs))
	header2.NewEpochContext = cloneEpochContext(header1.NewEpochContext)
	header2.NewEpochContext.StakeDistribution[0].FirstRegistrationSlot++

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header1, header2)
	require.True(t, cs.CheckForMisbehaviour(sdk.Context{}, nil, nil, msg))
}

func TestVerifyMisbehaviourDoesNotRequireStoredTargetHeights(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-unstored-heights")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	trustedHash := mustTestBlockPrevHash(t, header.BridgeBlocks[0])
	anchorPrevHash := header.BridgeBlocks[0].Hash
	header.BridgeBlocks = nil
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, anchorPrevHash)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(trustedHash), NewHeight(0, 10))

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header, header)
	err := cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "could not get consensus state from clientStore")
	require.Contains(t, err.Error(), "outside available epoch context bounds")
}

func TestVerifyMisbehaviourDoesNotRejectStoredHeadersAsStale(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-misbehaviour-stale")

	cs := newProbabilisticTestClientState()
	header := newVerifiedTestHeader(t)
	trustedHash := mustTestBlockPrevHash(t, header.BridgeBlocks[0])
	anchorPrevHash := header.BridgeBlocks[0].Hash
	header.BridgeBlocks = nil
	header.AnchorBlock = makeTestProbabilisticBlock(t, 12, cs.CurrentEpochEndSlotExclusive, anchorPrevHash)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(trustedHash), NewHeight(0, 10))
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState(header.AnchorBlock.Hash), header.GetHeight())

	msg := NewMisbehaviour("08-cardano-probabilistic-0", header, header)
	err := cs.verifyMisbehaviour(ctx, clientStore, cdc, msg)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "expected newer header height")
	require.Contains(t, err.Error(), "outside available epoch context bounds")
}

func TestHeadersConflictRejectsNonConflictingHeaders(t *testing.T) {
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)

	require.False(t, headersConflict(header1, header2))

	header2.AnchorBlock.Hash = "different-anchor"
	require.True(t, headersConflict(header1, header2))
}

func TestHeadersConflictDetectsDifferentHeightOverlapMismatch(t *testing.T) {
	header1 := newVerifiedTestHeader(t)
	header2 := newVerifiedTestHeader(t)
	header2.AnchorBlock = makeTestProbabilisticBlock(t, 14, 140, header1.DescendantBlocks[0].Hash)
	header2.BridgeBlocks = []*ProbabilisticBlock{
		cloneTestProbabilisticBlock(header1.BridgeBlocks[0]),
		cloneTestProbabilisticBlock(header1.AnchorBlock),
		cloneTestProbabilisticBlock(header1.DescendantBlocks[0]),
	}
	header2.DescendantBlocks = nil

	require.False(t, headersConflict(header1, header2))

	header2.BridgeBlocks[0].Hash = "conflicting-bridge-11"
	require.True(t, headersConflict(header1, header2))
}

func TestHeaderValidateBasicRejectsTrustedHeightEdgeCases(t *testing.T) {
	header := newVerifiedTestHeader(t)

	header.TrustedHeight = &Height{}
	err := header.ValidateBasic()
	require.ErrorContains(t, err, "trusted height cannot be zero")

	header = newVerifiedTestHeader(t)
	header.TrustedHeight = &Height{RevisionHeight: header.AnchorBlock.Height.RevisionHeight}
	err = header.ValidateBasic()
	require.ErrorContains(t, err, "trusted height")
}

func TestPruneOldestConsensusStateRemovesLowestExpiredHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-prune-oldest")

	cs := newProbabilisticTestClientState()
	cs.TrustingPeriod = time.Second

	expiredAt := uint64(ctx.BlockTime().Add(-2 * time.Second).UnixNano())
	freshAt := uint64(ctx.BlockTime().UnixNano())

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         expiredAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x01}, 32),
		AcceptedBlockHash: "hash-10",
		AcceptedEpoch:     7,
	}, NewHeight(0, 10))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 10), NewHeight(0, 10), expiredAt)

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         expiredAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x02}, 32),
		AcceptedBlockHash: "hash-11",
		AcceptedEpoch:     7,
	}, NewHeight(0, 11))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 11), NewHeight(0, 11), expiredAt)

	setConsensusState(clientStore, cdc, &ConsensusState{
		Timestamp:         freshAt,
		IbcStateRoot:      bytes.Repeat([]byte{0x03}, 32),
		AcceptedBlockHash: "hash-12",
		AcceptedEpoch:     7,
	}, NewHeight(0, 12))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 12), NewHeight(0, 12), freshAt)

	_, found10Before := GetConsensusState(clientStore, cdc, NewHeight(0, 10))
	_, found11Before := GetConsensusState(clientStore, cdc, NewHeight(0, 11))
	_, found12Before := GetConsensusState(clientStore, cdc, NewHeight(0, 12))
	require.True(t, found10Before)
	require.True(t, found11Before)
	require.True(t, found12Before)

	cs.pruneOldestConsensusState(ctx, cdc, clientStore)

	_, found10 := GetConsensusState(clientStore, cdc, NewHeight(0, 10))
	_, found11 := GetConsensusState(clientStore, cdc, NewHeight(0, 11))
	_, found12 := GetConsensusState(clientStore, cdc, NewHeight(0, 12))

	require.False(t, found10)
	require.True(t, found11)
	require.True(t, found12)
}

func TestCollectReferencedConsensusEpochsCollectsAllStoredEpochs(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-collect-epochs")

	consensus7 := newProbabilisticTestConsensusState("hash-10")
	consensus7.AcceptedEpoch = 7
	setConsensusState(clientStore, cdc, consensus7, NewHeight(0, 10))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 10), NewHeight(0, 10), consensus7.Timestamp)

	consensus8 := newProbabilisticTestConsensusState("hash-11")
	consensus8.AcceptedEpoch = 8
	setConsensusState(clientStore, cdc, consensus8, NewHeight(0, 11))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 11), NewHeight(0, 11), consensus8.Timestamp)

	consensus9 := newProbabilisticTestConsensusState("hash-12")
	consensus9.AcceptedEpoch = 9
	setConsensusState(clientStore, cdc, consensus9, NewHeight(0, 12))
	setConsensusMetadataWithValues(clientStore, NewHeight(0, 12), NewHeight(0, 12), consensus9.Timestamp)

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
	require.Equal(t, clienttypes.GetSelfHeight(ctx), processedHeight)
}

func TestInitializeCreatesCheckpointCursorAtInitialConsensusState(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-initial-checkpoint")
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState("initial-block-hash")
	counters := []*OperationalCertificateCounter{
		{PoolId: bytes.Repeat([]byte{0x21}, 28), SequenceNumber: 3},
	}
	clientState.LatestCheckpointOperationalCertificateCounters = cloneOperationalCertificateCounters(counters)

	require.NoError(t, clientState.Initialize(ctx, cdc, clientStore, consensusState))

	stored, found := getClientState(clientStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(10), stored.LatestHeight.RevisionHeight)
	require.Equal(t, uint64(10), stored.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, "initial-block-hash", stored.LatestCheckpointBlockHash)
	require.Equal(t, uint64(7), stored.LatestCheckpointEpoch)
	require.Equal(t, counters, stored.LatestCheckpointOperationalCertificateCounters)
}

func TestInitializeRejectsOperationalCertificateHistoryStartingAtAnotherHeight(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-initial-counter-mismatch")
	clientState := newProbabilisticTestClientState()
	clientState.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 9)
	consensusState := newProbabilisticTestConsensusState("initial-block-hash")

	err := clientState.Initialize(ctx, cdc, clientStore, consensusState)
	require.ErrorContains(t, err, "must start at the initial client height")
}

func TestStatusRejectsInvalidOperationalCertificateHistoryStart(t *testing.T) {
	for _, tc := range []struct {
		name         string
		historyStart *Height
	}{
		{name: "missing", historyStart: nil},
		{name: "zero", historyStart: ZeroHeight()},
		{name: "newer than checkpoint", historyStart: NewHeight(0, 11)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cdc := newProbabilisticTestCodec()
			ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-invalid-counter-history-status")
			clientState := newProbabilisticTestClientState()
			clientState.OperationalCertificateCounterHistoryStartHeight = tc.historyStart
			setConsensusState(
				clientStore,
				cdc,
				newProbabilisticTestConsensusState("initial-block-hash"),
				clientState.LatestHeight,
			)

			require.Equal(t, exported.Expired, clientState.Status(ctx, clientStore, cdc))
		})
	}
}

func TestCheckpointCursorDoesNotCreateConsensusStateOrRenewTrust(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-checkpoint-trust")
	clientState := newProbabilisticTestClientState()
	clientState.TrustingPeriod = time.Second
	clientState.setLatestCheckpoint(NewHeight(0, 20), "checkpoint-block-hash", 8)
	clientState.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: bytes.Repeat([]byte{0x23}, 28), SequenceNumber: 4},
	}

	expiredTimestamp := uint64(ctx.BlockTime().Add(-2 * time.Second).UnixNano())
	consensusState := newProbabilisticTestConsensusState("root-block-hash")
	consensusState.Timestamp = expiredTimestamp
	setConsensusState(clientStore, cdc, consensusState, clientState.LatestHeight)

	trustedBlock, err := clientState.latestTrustedBlockState(clientStore, cdc)
	require.NoError(t, err)
	require.Equal(t, uint64(20), trustedBlock.height.RevisionHeight)
	require.Equal(t, "checkpoint-block-hash", trustedBlock.blockHash)
	require.Equal(t, uint64(8), trustedBlock.epoch)
	require.Equal(t, uint64(4), trustedBlock.operationalCertificateCounters[hex.EncodeToString(bytes.Repeat([]byte{0x23}, 28))])

	_, checkpointConsensusFound := GetConsensusState(clientStore, cdc, clientState.LatestCheckpointHeight)
	require.False(t, checkpointConsensusFound)
	require.Equal(t, exported.Expired, clientState.Status(ctx, clientStore, cdc))
}

func TestTrustedBlockStateReconstructsHistoricalCounterSnapshot(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-historical-counter-snapshot")
	clientState := newProbabilisticTestClientState()
	poolID := bytes.Repeat([]byte{0x25}, 28)
	clientState.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolID, SequenceNumber: 7},
	}
	initialConsensus := newProbabilisticTestConsensusState("historical-block-hash")
	setConsensusState(clientStore, cdc, initialConsensus, NewHeight(0, 10))
	clientState.setLatestCheckpoint(NewHeight(0, 10), "historical-block-hash", 7)
	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 12),
		[]*OperationalCertificateCounter{{PoolId: poolID, SequenceNumber: 9}},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 12), "latest-block-hash", 7)

	trustedBlock, err := clientState.trustedBlockStateAtHeight(clientStore, cdc, NewHeight(0, 10))
	require.NoError(t, err)
	require.Equal(t, uint64(7), trustedBlock.operationalCertificateCounters[hex.EncodeToString(poolID)])
}

func TestOperationalCertificateCounterHistoryRollsBackMultipleUpdates(t *testing.T) {
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-counter-history")
	clientState := newProbabilisticTestClientState()
	poolA := bytes.Repeat([]byte{0x25}, 28)
	poolB := bytes.Repeat([]byte{0x26}, 28)
	clientState.setLatestCheckpoint(NewHeight(0, 10), "block-10", 7)
	clientState.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolA, SequenceNumber: 7},
	}

	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 12),
		[]*OperationalCertificateCounter{
			{PoolId: poolA, SequenceNumber: 9},
			{PoolId: poolB, SequenceNumber: 3},
		},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 12), "block-12", 7)
	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 15),
		[]*OperationalCertificateCounter{
			{PoolId: poolA, SequenceNumber: 11},
			{PoolId: poolB, SequenceNumber: 3},
		},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 15), "block-15", 7)

	poolAKey := hex.EncodeToString(poolA)
	poolBKey := hex.EncodeToString(poolB)
	at10, err := clientState.operationalCertificateCounterMapAtHeight(clientStore, NewHeight(0, 10))
	require.NoError(t, err)
	require.Equal(t, uint64(7), at10[poolAKey])
	require.Zero(t, at10[poolBKey])
	at12, err := clientState.operationalCertificateCounterMapAtHeight(clientStore, NewHeight(0, 12))
	require.NoError(t, err)
	require.Equal(t, uint64(9), at12[poolAKey])
	require.Equal(t, uint64(3), at12[poolBKey])
	at15, err := clientState.operationalCertificateCounterMapAtHeight(clientStore, NewHeight(0, 15))
	require.NoError(t, err)
	require.Equal(t, uint64(11), at15[poolAKey])
	require.Equal(t, uint64(3), at15[poolBKey])

	// The second batch stores one pre-header value even when a certificate
	// rotates more than once inside the verified block sequence.
	require.Len(t, clientStore.Get(operationalCertificateCounterHistoryKey(NewHeight(0, 15))), operationalCertificateCounterRollbackEntrySize)
	err = clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 16),
		[]*OperationalCertificateCounter{{PoolId: poolA, SequenceNumber: 10}},
	)
	require.ErrorContains(t, err, "decreased")
}

func TestOperationalCertificateCounterHistoryCompactsToOldestUsableConsensus(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-counter-history-compaction")
	clientState := newProbabilisticTestClientState()
	poolID := bytes.Repeat([]byte{0x26}, 28)
	clientState.setLatestCheckpoint(NewHeight(0, 10), "block-10", 7)
	clientState.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolID, SequenceNumber: 7},
	}
	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 12),
		[]*OperationalCertificateCounter{{PoolId: poolID, SequenceNumber: 9}},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 12), "block-12", 7)
	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 15),
		[]*OperationalCertificateCounter{{PoolId: poolID, SequenceNumber: 11}},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 15), "block-15", 7)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("block-12"), NewHeight(0, 12))
	SetIterationKey(clientStore, NewHeight(0, 12))

	require.NoError(t, clientState.compactOperationalCertificateCounterHistory(clientStore, cdc))
	require.Equal(t, uint64(12), clientState.OperationalCertificateCounterHistoryStartHeight.RevisionHeight)
	require.Nil(t, clientStore.Get(operationalCertificateCounterHistoryKey(NewHeight(0, 12))))
	require.NotNil(t, clientStore.Get(operationalCertificateCounterHistoryKey(NewHeight(0, 15))))
	at12, err := clientState.operationalCertificateCounterMapAtHeight(clientStore, NewHeight(0, 12))
	require.NoError(t, err)
	require.Equal(t, uint64(9), at12[hex.EncodeToString(poolID)])
	_, err = clientState.operationalCertificateCounterMapAtHeight(clientStore, NewHeight(0, 10))
	require.ErrorContains(t, err, "history is unavailable")
}

func TestExportMetadataPreservesConsensusAndOperationalCertificateMetadata(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	_, clientStore := newProbabilisticTestClientStore(t, "probabilistic-counter-history-export")
	clientState := newProbabilisticTestClientState()
	metadataHeight := NewHeight(0, 10)
	processedHeight := clienttypes.NewHeight(0, 99)
	const processedTime = uint64(123456789)
	setClientState(clientStore, cdc, clientState)
	setConsensusState(clientStore, cdc, newProbabilisticTestConsensusState("block-10"), metadataHeight)
	setConsensusMetadataWithValues(clientStore, metadataHeight, processedHeight, processedTime)
	clientStore.Set(ProbabilisticScoreKey(metadataHeight.RevisionHeight), sdk.Uint64ToBigEndian(9_876))

	poolID := bytes.Repeat([]byte{0x27}, 28)
	clientState.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolID, SequenceNumber: 4},
	}
	require.NoError(t, clientState.persistOperationalCertificateCounterSnapshot(
		clientStore,
		NewHeight(0, 12),
		[]*OperationalCertificateCounter{{PoolId: poolID, SequenceNumber: 6}},
	))
	clientState.setLatestCheckpoint(NewHeight(0, 12), "block-12", 7)

	metadata := clientState.ExportMetadata(clientStore)
	require.Len(t, metadata, 5)
	metadataByKey := make(map[string][]byte, len(metadata))
	for _, entry := range metadata {
		metadataByKey[string(entry.GetKey())] = entry.GetValue()
	}
	for _, key := range [][]byte{
		ProcessedTimeKey(metadataHeight),
		ProcessedHeightKey(metadataHeight),
		IterationKey(metadataHeight),
		ProbabilisticScoreKey(metadataHeight.RevisionHeight),
		operationalCertificateCounterHistoryKey(NewHeight(0, 12)),
	} {
		require.Equal(t, clientStore.Get(key), metadataByKey[string(key)])
	}

	_, restoredStore := newProbabilisticTestClientStore(t, "probabilistic-counter-history-import")
	for _, entry := range metadata {
		restoredStore.Set(entry.GetKey(), entry.GetValue())
	}
	restoredProcessedTime, found := GetProcessedTime(restoredStore, metadataHeight)
	require.True(t, found)
	require.Equal(t, processedTime, restoredProcessedTime)
	restoredProcessedHeight, found := GetProcessedHeight(restoredStore, metadataHeight)
	require.True(t, found)
	require.True(t, metadataHeight.LT(restoredProcessedHeight))
	require.Equal(t, processedHeight.String(), restoredProcessedHeight.String())
	require.Equal(
		t,
		clientStore.Get(ProbabilisticScoreKey(metadataHeight.RevisionHeight)),
		restoredStore.Get(ProbabilisticScoreKey(metadataHeight.RevisionHeight)),
	)
	var restoredIterationHeights []uint64
	IterateConsensusStateAscending(restoredStore, func(height exported.Height) bool {
		restoredIterationHeights = append(restoredIterationHeights, height.GetRevisionHeight())
		return false
	})
	require.Equal(t, []uint64{metadataHeight.RevisionHeight}, restoredIterationHeights)
	_, found = GetConsensusState(restoredStore, cdc, metadataHeight)
	require.False(t, found)
	restored, err := clientState.operationalCertificateCounterMapAtHeight(restoredStore, NewHeight(0, 10))
	require.NoError(t, err)
	require.Equal(t, uint64(4), restored[hex.EncodeToString(poolID)])
}

func TestPersistCheckpointAdvancesCursorWithoutAdvancingIbcRoot(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-persist-checkpoint")
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState("root-block-hash")
	require.NoError(t, clientState.Initialize(ctx, cdc, clientStore, consensusState))

	epochContexts := mustTestEpochContexts(t, clientState)
	authenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height: 20,
			hash:   "checkpoint-block-hash",
			epoch:  7,
		},
		anchorOperationalCertificateCounters: []*OperationalCertificateCounter{
			{PoolId: bytes.Repeat([]byte{0x24}, 28), SequenceNumber: 5},
		},
	}
	require.NoError(t, clientState.persistCheckpoint(clientStore, cdc, epochContexts, authenticatedHeader))

	stored, found := getClientState(clientStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(10), stored.LatestHeight.RevisionHeight)
	require.Equal(t, uint64(20), stored.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, "checkpoint-block-hash", stored.LatestCheckpointBlockHash)
	require.Equal(t, authenticatedHeader.anchorOperationalCertificateCounters, stored.LatestCheckpointOperationalCertificateCounters)

	_, rootConsensusFound := GetConsensusState(clientStore, cdc, NewHeight(0, 10))
	_, checkpointConsensusFound := GetConsensusState(clientStore, cdc, NewHeight(0, 20))
	require.True(t, rootConsensusFound)
	require.False(t, checkpointConsensusFound)
	_, checkpointProcessedTimeFound := GetProcessedTime(clientStore, NewHeight(0, 20))
	require.False(t, checkpointProcessedTimeFound)
}

func TestIdleEpochCheckpointSequenceMakesNextHostStateReachableWithoutRenewingTrust(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, clientStore := newProbabilisticTestClientStore(t, "probabilistic-idle-epoch-checkpoints")
	clientState := newProbabilisticTestClientState()

	makeEpochContext := func(epoch, startSlot, endSlot uint64, nonceByte byte) *EpochContext {
		epochContext := cloneEpochContext(clientState.EpochContexts[0])
		epochContext.Epoch = epoch
		epochContext.EpochNonce = bytes.Repeat([]byte{nonceByte}, 32)
		epochContext.EpochStartSlot = startSlot
		epochContext.EpochEndSlotExclusive = endSlot
		return epochContext
	}

	epoch303 := makeEpochContext(303, 0, 1_000, 0x03)
	epoch304 := makeEpochContext(304, 1_000, 2_000, 0x04)
	epoch305 := makeEpochContext(305, 2_000, 3_000, 0x05)
	clientState.LatestHeight = NewHeight(0, 100)
	clientState.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 100)
	clientState.EpochContexts = []*EpochContext{epoch303}
	require.NoError(t, syncCurrentEpochFields(clientState, clientState.EpochContexts, 303))

	initialConsensus := newProbabilisticTestConsensusState("host-state-epoch-303")
	initialConsensus.AcceptedEpoch = 303
	initialConsensus.IbcStateRoot = bytes.Repeat([]byte{0x33}, 32)
	require.NoError(t, clientState.Initialize(ctx, cdc, clientStore, initialConsensus))

	initialProcessedTime, found := GetProcessedTime(clientStore, clientState.LatestHeight)
	require.True(t, found)
	initialProcessedHeight, found := GetProcessedHeight(clientStore, clientState.LatestHeight)
	require.True(t, found)

	checkpoints := []struct {
		height          uint64
		epoch           uint64
		hash            string
		newEpochContext *EpochContext
	}{
		{height: 101, epoch: 303, hash: "checkpoint-303", newEpochContext: nil},
		{height: 102, epoch: 304, hash: "checkpoint-304-rollover", newEpochContext: epoch304},
		{height: 103, epoch: 304, hash: "checkpoint-304-resume", newEpochContext: nil},
	}

	for _, checkpoint := range checkpoints {
		trustedBlock, err := clientState.latestTrustedBlockState(clientStore, cdc)
		require.NoError(t, err)

		header := &ProbabilisticHeader{
			TrustedHeight:   NewHeight(trustedBlock.height.RevisionNumber, trustedBlock.height.RevisionHeight),
			AnchorBlock:     &ProbabilisticBlock{Height: NewHeight(0, checkpoint.height), Hash: checkpoint.hash, BlockCbor: []byte{0x01}},
			NewEpochContext: checkpoint.newEpochContext,
			IsCheckpoint:    true,
		}
		require.NoError(t, header.ValidateBasic())

		authenticatedHeader := &authenticatedProbabilisticHeader{
			anchorBlock: &authenticatedProbabilisticBlock{
				height:   checkpoint.height,
				hash:     checkpoint.hash,
				prevHash: trustedBlock.blockHash,
				epoch:    checkpoint.epoch,
			},
		}
		require.NoError(t, verifyHeaderEpochTransition(header, trustedBlock, authenticatedHeader))
		require.NoError(t, verifyBridgeContinuity(authenticatedHeader, trustedBlock))

		epochContexts, err := mergeEpochContexts(clientState.EpochContexts, checkpoint.newEpochContext)
		require.NoError(t, err)
		require.NoError(t, clientState.persistCheckpoint(clientStore, cdc, epochContexts, authenticatedHeader))

		stored, found := getClientState(clientStore, cdc)
		require.True(t, found)
		clientState = stored

		require.Equal(t, uint64(100), clientState.LatestHeight.RevisionHeight)
		require.Equal(t, checkpoint.height, clientState.LatestCheckpointHeight.RevisionHeight)
		require.Equal(t, checkpoint.hash, clientState.LatestCheckpointBlockHash)
		require.Equal(t, checkpoint.epoch, clientState.LatestCheckpointEpoch)

		storedRoot, found := GetConsensusState(clientStore, cdc, NewHeight(0, 100))
		require.True(t, found)
		require.Equal(t, initialConsensus.IbcStateRoot, storedRoot.IbcStateRoot)
		require.Equal(t, initialConsensus.Timestamp, storedRoot.Timestamp)
		require.Equal(t, initialConsensus.AcceptedBlockHash, storedRoot.AcceptedBlockHash)
		require.Equal(t, initialConsensus.AcceptedEpoch, storedRoot.AcceptedEpoch)

		_, found = GetConsensusState(clientStore, cdc, NewHeight(0, checkpoint.height))
		require.False(t, found)
		_, found = GetProcessedTime(clientStore, NewHeight(0, checkpoint.height))
		require.False(t, found)
		_, found = GetProcessedHeight(clientStore, NewHeight(0, checkpoint.height))
		require.False(t, found)

		processedTime, found := GetProcessedTime(clientStore, NewHeight(0, 100))
		require.True(t, found)
		require.Equal(t, initialProcessedTime, processedTime)
		processedHeight, found := GetProcessedHeight(clientStore, NewHeight(0, 100))
		require.True(t, found)
		require.Equal(t, initialProcessedHeight, processedHeight)
		require.Equal(t, exported.Active, clientState.Status(ctx, clientStore, cdc))
	}

	trustedBlock, err := clientState.latestTrustedBlockState(clientStore, cdc)
	require.NoError(t, err)
	finalHeader := &ProbabilisticHeader{
		TrustedHeight:   NewHeight(trustedBlock.height.RevisionNumber, trustedBlock.height.RevisionHeight),
		AnchorBlock:     &ProbabilisticBlock{Height: NewHeight(0, 104), Hash: "host-state-epoch-305", BlockCbor: []byte{0x01}},
		HostStateTxHash: "host-state-tx-epoch-305",
		NewEpochContext: epoch305,
	}
	require.NoError(t, finalHeader.ValidateBasic())

	finalAuthenticatedHeader := &authenticatedProbabilisticHeader{
		anchorBlock: &authenticatedProbabilisticBlock{
			height:   104,
			hash:     "host-state-epoch-305",
			prevHash: trustedBlock.blockHash,
			epoch:    305,
		},
	}
	require.NoError(t, verifyHeaderEpochTransition(finalHeader, trustedBlock, finalAuthenticatedHeader))
	require.NoError(t, verifyBridgeContinuity(finalAuthenticatedHeader, trustedBlock))
	require.Equal(t, uint64(100), clientState.LatestHeight.RevisionHeight)

	storedRoot, found := GetConsensusState(clientStore, cdc, NewHeight(0, 100))
	require.True(t, found)
	require.Equal(t, initialConsensus.IbcStateRoot, storedRoot.IbcStateRoot)
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

	require.NoError(t, header.ValidateBasic())
	header.HostStateTxHash = "must-not-be-present"
	require.ErrorContains(t, header.ValidateBasic(), "must not contain HostState transaction fields")

	header.IsCheckpoint = false
	header.HostStateTxHash = ""
	require.ErrorContains(t, header.ValidateBasic(), "must contain a HostState transaction hash")
}

func newProbabilisticTestCodec() codec.BinaryCodec {
	registry := codectypes.NewInterfaceRegistry()
	RegisterInterfaces(registry)
	return codec.NewProtoCodec(registry)
}

func newProbabilisticTestClientStore(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "cardano-probabilistic-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	return ctx, stateStore.GetKVStore(key)
}

func newProbabilisticTestClientState() *ClientState {
	zeroHeight := ZeroHeight()
	epochStakeDistribution := []*StakeDistributionEntry{
		{
			PoolId:                   "pool-a",
			Stake:                    10_000,
			VrfKeyHash:               bytes.Repeat([]byte{0x02}, 32),
			FirstRegistrationSlot:    1,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 1,
		},
	}
	epochNonce := bytes.Repeat([]byte{0x03}, 32)
	return &ClientState{
		ChainId:                          "cardano-test",
		LatestHeight:                     &Height{RevisionHeight: 10},
		FrozenHeight:                     zeroHeight,
		CurrentEpoch:                     7,
		TrustingPeriod:                   24 * time.Hour,
		HostStateNftPolicyId:             bytes.Repeat([]byte{0x01}, 28),
		HostStateNftTokenName:            []byte("host-state"),
		EpochStakeDistribution:           cloneStakeDistributionEntries(epochStakeDistribution),
		EpochNonce:                       bytes.Clone(epochNonce),
		SlotsPerKesPeriod:                129600,
		MaxKesEvolutions:                 62,
		ActiveSlotCoefficientNumerator:   1,
		ActiveSlotCoefficientDenominator: 20,
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

func newProbabilisticTestConsensusState(acceptedBlockHash string) *ConsensusState {
	return &ConsensusState{
		Timestamp:         uint64(time.Unix(1_700_000_000, 0).UnixNano()),
		IbcStateRoot:      bytes.Repeat([]byte{0x11}, 32),
		AcceptedBlockHash: acceptedBlockHash,
		AcceptedEpoch:     7,
		UniquePoolsCount:  1,
		UniqueStakeBps:    10_000,
		SecurityScoreBps:  10_000,
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

func makeTestProbabilisticBlock(t *testing.T, blockNumber, slot uint64, prevHashHex string) *ProbabilisticBlock {
	t.Helper()

	block := ledger.BabbageBlock{
		Header: &ledger.BabbageBlockHeader{},
	}
	block.Header.Body.BlockNumber = blockNumber
	block.Header.Body.Slot = slot
	if prevHashHex != "" {
		prevHashBytes, err := hex.DecodeString(prevHashHex)
		require.NoError(t, err)
		block.Header.Body.PrevHash = ledger.NewBlake2b256(prevHashBytes)
	}

	blockCbor, err := cbor.Encode(block)
	require.NoError(t, err)
	_, err = cbor.Decode(blockCbor, &block)
	require.NoError(t, err)

	return &ProbabilisticBlock{
		Height:    &Height{RevisionHeight: block.BlockNumber()},
		Hash:      block.Hash(),
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
