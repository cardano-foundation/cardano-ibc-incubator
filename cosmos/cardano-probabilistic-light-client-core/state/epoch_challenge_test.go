package state

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestRolloverChallengeRetainsRootlessTrustAndDoesNotReset(t *testing.T) {
	base := newTemporalVerifierEpochContext(7, 0, 1_000, 7)
	ctx, cdc, store, cs := initializeTemporalVerifierClient(t, "challenge-rollover", 969, base)
	ctx = ctx.WithBlockTime(time.Unix(0, int64(mustTestTimestampForSlot(t, cs, 1_024))))
	makeHeader := func(hash string, height, slot, epoch uint64) (*ProbabilisticHeader, headerAuthenticator) {
		header := newTemporalVerifierHeader(t, cs, hash, height, slot, epoch, true)
		header.TrustedHeight = cs.LatestCheckpointHeight
		full := makeTestProbabilisticBlock(t, height, slot, cs.LatestCheckpointBlockHash)
		header.AnchorBlock.BlockCbor = full.BlockCbor
		header.AnchorBlock.Hash = full.Hash
		hash = full.Hash
		authenticated := newTemporalVerifierAuthenticatedHeader(t, cs, cs.LatestCheckpointBlockHash, hash, height, slot, epoch)
		return header, func(_ *ProbabilisticHeader, contexts []*EpochContext, _ map[string]uint64, _ *trustedBlockState) (*authenticatedProbabilisticHeader, error) {
			authenticated.anchorNonceState = testNonceState(epochContextByEpoch(contexts, epoch).EpochNonce)
			authenticated.anchorPoolRegistry = testPoolRegistryAtEpoch(t, cs.LatestCheckpointPoolRegistry, epoch)
			return authenticated, nil
		}
	}
	// First advance to a rootless checkpoint in the old, already usable epoch.
	checkpoint, authenticate := makeHeader("rootless-11", 11, 970, 7)
	oldDeadline := cs.epochChallenge(7).UsableAfterUnixNs
	require.NoError(t, cs.verifyHeaderWithAuthenticator(ctx, store, cdc, checkpoint, authenticate))
	require.Empty(t, cs.updateStateWithAuthenticator(ctx, cdc, store, checkpoint, authenticate))
	require.Equal(t, oldDeadline, cs.epochChallenge(7).UsableAfterUnixNs)

	proposal, authenticateProposal := makeHeader("proposal-12", 12, 1_000, 8)
	proposal.NewEpochContext = newTemporalVerifierEpochContext(8, 1_000, 2_000, 8)
	// This seam supplies authenticated blocks, just as the pre-fix verifier
	// accepts blocks signed under a fabricated but structurally valid context.
	require.NoError(t, cs.verifyHeaderWithAuthenticator(ctx, store, cdc, proposal, authenticateProposal))
	require.Empty(t, cs.updateStateWithAuthenticator(ctx, cdc, store, proposal, authenticateProposal))
	deadline := cs.epochChallenge(8).UsableAfterUnixNs
	require.Equal(t, uint64(ctx.BlockTime().Add(3*time.Minute).UnixNano()), deadline)
	require.ErrorIs(t, cs.verifyEpochUsable(ctx, 8), ErrEpochContextPending)
	require.NoError(t, cs.verifyEpochUsable(ctx, 7)) // Previous roots stay usable.
	_, found := GetConsensusState(store, cdc, NewHeight(0, 12))
	require.False(t, found) // Rootless proposal still has no IBC root.

	next, authenticateNext := makeHeader("next-13", 13, 1_001, 8)
	next.NewEpochContext = cloneEpochContext(proposal.NewEpochContext)
	require.NoError(t, cs.verifyHeaderWithAuthenticator(ctx, store, cdc, next, authenticateNext))
	require.Empty(t, cs.updateStateWithAuthenticator(ctx.WithBlockTime(ctx.BlockTime().Add(time.Second)), cdc, store, next, authenticateNext))
	cs, _ = GetClientState(store, cdc)
	require.Equal(t, deadline, cs.epochChallenge(8).UsableAfterUnixNs)
	_, err := cs.trustedBlockStateAtHeight(store, cdc, proposal.TrustedHeight)
	require.Error(t, err) // Ordinary history no longer holds the rootless cursor.

	// Export/import must retain both the deadline and challenge checkpoint.
	_, restoredStore := newProbabilisticTestClientStore(t, "challenge-restored")
	for _, entry := range cs.ExportMetadata(store) {
		restoredStore.Set(entry.GetKey(), entry.GetValue())
	}
	trusted, contexts, err := cs.challengeTrustedBlock(restoredStore, cdc, proposal)
	require.NoError(t, err)
	require.Equal(t, checkpoint.AnchorBlock.Hash, trusted.blockHash)
	require.Equal(t, uint64(7), contexts[0].Epoch)
	require.Equal(t, testNonceState(base.EpochNonce), trusted.nonceState)
	require.True(t, settlementCreditsEqual(mustTestSettlementCredit(base), trusted.settlementCredit))
	require.Equal(t, uint64(8), cs.LatestCheckpointSettlementCredit.Epoch)

	// A second self-consistent context is evidence of disagreement. It must
	// remain verifiable against the pre-proposal checkpoint after advancement.
	honest := *proposal
	honest.NewEpochContext = cloneEpochContext(proposal.NewEpochContext)
	honest.NewEpochContext.StakeDistribution[0].Stake++
	for _, entry := range honest.NewEpochContext.StakeDistribution {
		entry.RelativeStakeNumerator, entry.RelativeStakeDenominator = entry.Stake, 5_001
	}
	evidence := &Misbehaviour{ProbabilisticHeader1: proposal, ProbabilisticHeader2: &honest}
	require.NoError(t, cs.verifyMisbehaviourWithAuthenticator(ctx, store, cdc, evidence, authenticateProposal))
	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, store, evidence))
	// The honest fork may still be in the previous epoch at the disputed
	// height; it must find the same saved cursor without claiming epoch 8.
	oldEpochWitness := newTemporalVerifierHeader(t, cs, "honest-old-epoch", 12, 971, 7, true)
	oldEpochWitness.TrustedHeight = proposal.TrustedHeight
	oldBlock := makeTestProbabilisticBlock(t, 12, 971, checkpoint.AnchorBlock.Hash)
	oldEpochWitness.AnchorBlock.BlockCbor = oldBlock.BlockCbor
	oldEpochWitness.AnchorBlock.Hash = oldBlock.Hash
	oldAuthenticated := newTemporalVerifierAuthenticatedHeader(t, cs, checkpoint.AnchorBlock.Hash, oldBlock.Hash, 12, 971, 7)
	mixedEvidence := &Misbehaviour{ProbabilisticHeader1: proposal, ProbabilisticHeader2: oldEpochWitness}
	require.NoError(t, cs.verifyMisbehaviourWithAuthenticator(ctx, store, cdc, mixedEvidence,
		func(header *ProbabilisticHeader, contexts []*EpochContext, counters map[string]uint64, _ *trustedBlockState) (*authenticatedProbabilisticHeader, error) {
			if header == oldEpochWitness {
				oldAuthenticated.anchorPoolRegistry = testPoolRegistry(7, base.StakeDistribution)
				return oldAuthenticated, nil
			}
			return authenticateProposal(header, contexts, counters, nil)
		}))
	cs.UpdateStateOnMisbehaviour(ctx, cdc, store, evidence)
	frozen, _ := GetClientState(store, cdc)
	require.Equal(t, Frozen, frozen.Status(ctx, store, cdc))
	require.ErrorIs(t, frozen.verifyEpochUsable(ctx.WithBlockTime(ctx.BlockTime().Add(time.Hour)), 8), ErrIBCClientFrozen)

	// Invalid raw evidence never passes the real block authenticator.
	require.Error(t, cs.VerifyClientMessage(ctx, cdc, store, evidence))
	require.Equal(t, deadline, cs.epochChallenge(8).UsableAfterUnixNs)
}

func TestPendingEpochCannotRollAgainToDiscardChallengeHistory(t *testing.T) {
	ctx, cdc, store, cs := initializeTemporalVerifierClient(t, "challenge-double-rollover", 999,
		newTemporalVerifierEpochContext(7, 0, 1_000, 7))
	ctx = ctx.WithBlockTime(time.Unix(0, int64(mustTestTimestampForSlot(t, cs, 1_024))))
	cs.epochChallenge(7).UsableAfterUnixNs = uint64(ctx.BlockTime().Add(time.Minute).UnixNano())
	header := newTemporalVerifierHeader(t, cs, "rollover", 11, 1_000, 8, true)
	header.NewEpochContext = newTemporalVerifierEpochContext(8, 1_000, 2_000, 8)
	authenticated := newTemporalVerifierAuthenticatedHeader(t, cs, "trusted-10", "rollover", 11, 1_000, 8)
	err := cs.verifyHeaderWithAuthenticator(ctx, store, cdc, header, func(*ProbabilisticHeader, []*EpochContext, map[string]uint64, *trustedBlockState) (*authenticatedProbabilisticHeader, error) {
		return authenticated, nil
	})
	require.ErrorIs(t, err, ErrEpochContextPending)
}
