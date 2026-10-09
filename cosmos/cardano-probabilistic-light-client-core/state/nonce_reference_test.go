package state

import (
	"bytes"
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

type nodeNonceState struct {
	EpochNonce          *string `json:"epochNonce"`
	EvolvingNonce       *string `json:"evolvingNonce"`
	CandidateNonce      *string `json:"candidateNonce"`
	LabNonce            *string `json:"labNonce"`
	LastEpochBlockNonce *string `json:"lastEpochBlockNonce"`
}

type nonceReferenceBlock struct {
	Height uint64          `json:"height"`
	Slot   uint64          `json:"slot"`
	Hash   string          `json:"hash"`
	Header string          `json:"header_cbor"`
	Body   string          `json:"block_cbor"`
	State  *nodeNonceState `json:"node_state"`
}

type nonceReference struct {
	EpochLength       uint64                `json:"epoch_length"`
	Window            uint64                `json:"randomness_stabilisation_window_slots"`
	KesPeriod         uint64                `json:"slots_per_kes_period"`
	MaxKes            uint64                `json:"max_kes_evolutions"`
	ActiveNumerator   uint64                `json:"active_slot_numerator"`
	ActiveDenominator uint64                `json:"active_slot_denominator"`
	Blocks            []nonceReferenceBlock `json:"blocks"`
}

func referenceNonceState(t *testing.T, state *nodeNonceState) *PraosNonceState {
	t.Helper()
	require.NotNil(t, state)
	decode := func(value *string) []byte {
		if value == nil {
			return nil
		}
		b, err := hex.DecodeString(*value)
		require.NoError(t, err)
		require.Len(t, b, 32)
		return b
	}
	return &PraosNonceState{EpochNonce: decode(state.EpochNonce), EvolvingNonce: decode(state.EvolvingNonce),
		CandidateNonce: decode(state.CandidateNonce), LastAppliedBlockNonce: decode(state.LabNonce), LastEpochBlockNonce: decode(state.LastEpochBlockNonce)}
}

func loadNonceReference(t *testing.T) (*nonceReference, *ClientState, []*EpochContext, *trustedBlockState) {
	t.Helper()
	f, err := os.Open("../testdata/praos_nonce_node.json.gz")
	require.NoError(t, err)
	defer f.Close()
	gz, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer gz.Close()
	var ref nonceReference
	require.NoError(t, json.NewDecoder(gz).Decode(&ref))
	require.Greater(t, len(ref.Blocks), 30)
	first := ref.Blocks[0]
	epoch := first.Slot / ref.EpochLength
	cs := &ClientState{CurrentEpoch: epoch, CurrentEpochStartSlot: epoch * ref.EpochLength, CurrentEpochEndSlotExclusive: (epoch + 1) * ref.EpochLength,
		RandomnessStabilisationWindowSlots: ref.Window, SlotsPerKesPeriod: ref.KesPeriod, MaxKesEvolutions: ref.MaxKes,
		ActiveSlotCoefficientNumerator: ref.ActiveNumerator, ActiveSlotCoefficientDenominator: ref.ActiveDenominator,
		SystemStartUnixNs: 1_000_000_000, SlotLengthNs: 200_000_000}
	var contexts []*EpochContext
	for _, block := range ref.Blocks {
		e := block.Slot / ref.EpochLength
		if block.State == nil || epochContextByEpoch(contexts, e) != nil {
			continue
		}
		headerBytes, err := hex.DecodeString(block.Header)
		require.NoError(t, err)
		header, err := core.DecodeLedgerHeader(headerBytes)
		require.NoError(t, err)
		vrfHash := blake2b.Sum256(header.Body.VrfKey)
		contexts = append(contexts, &EpochContext{Epoch: e, EpochStartSlot: e * ref.EpochLength, EpochEndSlotExclusive: (e + 1) * ref.EpochLength,
			SlotsPerKesPeriod: ref.KesPeriod, EpochNonce: referenceNonceState(t, block.State).EpochNonce,
			StakeDistribution: []*StakeDistributionEntry{{PoolId: header.IssuerVkey().PoolId(), VrfKeyHash: vrfHash[:], Stake: 1, RelativeStakeNumerator: 1, RelativeStakeDenominator: 1}}})
	}
	cs.LatestCheckpointPoolRegistry = testPoolRegistry(epoch, contexts[0].StakeDistribution)
	cs.EpochContexts = contexts
	cs.EpochNonce = bytes.Clone(contexts[0].EpochNonce)
	cs.LatestCheckpointNonceState = referenceNonceState(t, first.State)
	trusted := &trustedBlockState{height: NewHeight(0, first.Height), slot: first.Slot, epoch: epoch, blockHash: first.Hash,
		timestamp: cs.SystemStartUnixNs + first.Slot*cs.SlotLengthNs, nonceState: clonePraosNonceState(cs.LatestCheckpointNonceState), poolRegistry: clonePoolRegistry(cs.LatestCheckpointPoolRegistry), operationalCertificateCounters: map[string]uint64{}}
	cs.LatestHeight = trusted.height
	cs.OperationalCertificateCounterHistoryStartHeight = trusted.height
	cs.setLatestCheckpoint(trusted.height, trusted.blockHash, trusted.epoch, trusted.slot, trusted.timestamp)
	return &ref, cs, contexts, trusted
}

func referenceProbabilisticBlock(t *testing.T, ref *nonceReference, cs *ClientState, index int, compact bool) *ProbabilisticBlock {
	t.Helper()
	b := ref.Blocks[index]
	timestamp, err := cs.DeriveTimestampFromSlot(b.Slot)
	require.NoError(t, err)
	block := &ProbabilisticBlock{Height: NewHeight(0, b.Height), Slot: b.Slot, Hash: b.Hash, Epoch: b.Slot / ref.EpochLength, Timestamp: timestamp}
	if compact {
		block.HeaderCbor, err = hex.DecodeString(b.Header)
	} else {
		block.BlockCbor, err = hex.DecodeString(b.Body)
	}
	require.NoError(t, err)
	return block
}

func TestPraosNonceMatchesReferenceNode(t *testing.T) {
	for _, compact := range []bool{false, true} {
		t.Run(fmt.Sprintf("compact=%v", compact), func(t *testing.T) {
			ref, cs, contexts, trusted := loadNonceReference(t)
			tracker, err := newNonceTracker(trusted)
			require.NoError(t, err)
			registry, err := newPoolRegistryTracker(trusted.poolRegistry, trusted.epoch, trusted.slot)
			require.NoError(t, err)
			for i := 1; i < len(ref.Blocks); i++ {
				block := referenceProbabilisticBlock(t, ref, cs, i, compact)
				_, err := cs.authenticateProbabilisticBlock(block, "reference", contexts, map[string]uint64{}, false, tracker, registry)
				require.NoError(t, err, "slot %d", block.Slot)
				if ref.Blocks[i].State != nil {
					require.Equal(t, referenceNonceState(t, ref.Blocks[i].State), tracker.state, "node state at slot %d", block.Slot)
				}
			}
		})
	}
}

func TestNonceBatchSizesSettlementAndRollbackMatchNode(t *testing.T) {
	for _, batchSize := range []int{1, 2, 7, 24} {
		t.Run(fmt.Sprintf("batch=%d", batchSize), func(t *testing.T) {
			ref, cs, contexts, trusted := loadNonceReference(t)
			_, store := newProbabilisticTestClientStore(t, "nonce-reference-batches")
			cdc := newProbabilisticTestCodec()
			baseline := clonePraosNonceState(trusted.nonceState)
			SetConsensusState(store, cdc, &ConsensusState{Timestamp: trusted.timestamp, AcceptedBlockHash: trusted.blockHash,
				AcceptedEpoch: trusted.epoch, NonceState: baseline, PoolRegistry: clonePoolRegistry(trusted.poolRegistry)}, trusted.height)
			for start := 1; start < len(ref.Blocks); {
				anchor := minInt(start+batchSize-1, len(ref.Blocks)-1)
				// Every stored anchor is compared with a node observation.
				for anchor < len(ref.Blocks)-1 && ref.Blocks[anchor].State == nil {
					anchor++
				}
				header := &ProbabilisticHeader{AnchorBlock: referenceProbabilisticBlock(t, ref, cs, anchor, false)}
				for i := start; i < anchor; i++ {
					header.BridgeBlocks = append(header.BridgeBlocks, referenceProbabilisticBlock(t, ref, cs, i, false))
				}
				for i := anchor + 1; i <= minInt(anchor+5, len(ref.Blocks)-1); i++ {
					header.DescendantBlocks = append(header.DescendantBlocks, referenceProbabilisticBlock(t, ref, cs, i, true))
				}
				before := clonePraosNonceState(trusted.nonceState)
				auth, err := cs.authenticateHeaderBlocksWithContexts(header, contexts, trusted.operationalCertificateCounters, trusted)
				require.NoError(t, err)
				require.Equal(t, before, trusted.nonceState)
				require.Equal(t, referenceNonceState(t, ref.Blocks[anchor].State), auth.anchorNonceState)
				require.NoError(t, cs.persistCheckpoint(store, cdc, contexts, auth))
				require.Equal(t, auth.anchorNonceState, cs.LatestCheckpointNonceState)
				require.True(t, poolRegistriesEqual(auth.anchorPoolRegistry, cs.LatestCheckpointPoolRegistry))
				trusted, err = cs.trustedBlockStateAtHeight(store, cdc, cs.LatestCheckpointHeight)
				require.NoError(t, err)
				start = anchor + 1
			}
			finalState := clonePraosNonceState(cs.LatestCheckpointNonceState)
			// Loading the historical point must restore its nonce state rather
			// than use the state of the current checkpoint.
			rollback, err := cs.trustedBlockStateAtHeight(store, cdc, NewHeight(0, ref.Blocks[0].Height))
			require.NoError(t, err)
			require.Equal(t, baseline, rollback.nonceState)
			tracker, err := newNonceTracker(rollback)
			require.NoError(t, err)
			registry, err := newPoolRegistryTracker(rollback.poolRegistry, rollback.epoch, rollback.slot)
			require.NoError(t, err)
			for i := 1; i < len(ref.Blocks); i++ {
				_, err := cs.authenticateProbabilisticBlock(referenceProbabilisticBlock(t, ref, cs, i, true), "rollback", contexts, map[string]uint64{}, false, tracker, registry)
				require.NoError(t, err)
			}
			require.Equal(t, finalState, tracker.state)
			require.True(t, poolRegistriesEqual(registry.state, cs.LatestCheckpointPoolRegistry))
		})
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func TestDerivedNonceRejectsSuppliedValueWithoutChangingCheckpoint(t *testing.T) {
	ref, cs, contexts, trusted := loadNonceReference(t)
	before := clonePraosNonceState(cs.LatestCheckpointNonceState)
	contexts[0].EpochNonce[0] ^= 1
	header := &ProbabilisticHeader{AnchorBlock: referenceProbabilisticBlock(t, ref, cs, 1, false)}
	_, err := cs.authenticateHeaderBlocksWithContexts(header, contexts, nil, trusted)
	require.ErrorContains(t, err, "supplied nonce disagrees")
	require.Equal(t, before, cs.LatestCheckpointNonceState)
	require.Equal(t, before, trusted.nonceState)
}

func TestFailedSettlementDescendantDoesNotAdvanceNonceCheckpoint(t *testing.T) {
	ref, cs, contexts, trusted := loadNonceReference(t)
	before := clonePraosNonceState(trusted.nonceState)
	descendant := referenceProbabilisticBlock(t, ref, cs, 2, true)
	decoded, err := core.DecodeLedgerHeader(descendant.HeaderCbor)
	require.NoError(t, err)
	descendant.Hash = decoded.Hash().String()
	// Relabel the signed slot after an otherwise valid anchor. This fails
	// authentication after the temporary tracker has already advanced.
	descendant.Slot++
	header := &ProbabilisticHeader{AnchorBlock: referenceProbabilisticBlock(t, ref, cs, 1, false), DescendantBlocks: []*ProbabilisticBlock{descendant}}
	_, err = cs.authenticateHeaderBlocksWithContexts(header, contexts, nil, trusted)
	require.ErrorContains(t, err, "slot mismatch")
	require.Equal(t, before, trusted.nonceState)
	require.Equal(t, before, cs.LatestCheckpointNonceState)
}
