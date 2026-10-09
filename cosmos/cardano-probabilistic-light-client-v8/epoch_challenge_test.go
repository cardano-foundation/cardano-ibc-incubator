package probabilistic

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"testing"
	"time"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestEpochChallengeBlocksValidProofsUntilHostDeadline(t *testing.T) {
	for _, membership := range []bool{true, false} {
		t.Run(map[bool]string{true: "membership", false: "non-membership"}[membership], func(t *testing.T) {
			ctx, store := newProbabilisticTestClientStore(t, "challenge-proof")
			cdc := newProbabilisticTestCodec()
			cs := newProbabilisticTestClientState()
			root, proof, key, value := challengeTestProof(t, membership)
			consensus := newProbabilisticTestConsensusState("bootstrap")
			consensus.IbcStateRoot = root
			// Bootstrap input cannot pre-age, omit or duplicate the host deadline.
			cs.EpochContextChallenges = []*EpochContextChallenge{
				{Epoch: cs.CurrentEpoch, UsableAfterUnixNs: 1},
				{Epoch: cs.CurrentEpoch, UsableAfterUnixNs: 2},
			}
			require.NoError(t, cs.Initialize(ctx, cdc, store, consensus))
			cs, _ = getClientState(store, cdc)
			require.Len(t, cs.EpochContextChallenges, 1)
			require.Equal(t, uint64(ctx.BlockTime().Add(3*time.Minute).UnixNano()), cs.epochChallenge(7).UsableAfterUnixNs)

			path := commitmenttypes.NewMerklePath("ibc", string(key))
			verify := func(offset time.Duration, blockHeight int64) error {
				host := ctx.WithBlockTime(ctx.BlockTime().Add(offset)).WithBlockHeight(blockHeight)
				if membership {
					return cs.VerifyMembership(host, store, cdc, cs.LatestHeight, 0, 0, proof, path, value)
				}
				return cs.VerifyNonMembership(host, store, cdc, cs.LatestHeight, 0, 0, proof, path)
			}
			require.ErrorIs(t, verify(0, 100), ErrEpochContextPending)
			require.ErrorIs(t, verify(3*time.Minute-time.Nanosecond, 1_000_000), ErrEpochContextPending)
			require.NoError(t, verify(3*time.Minute, 101))
			// The IBC delay is an additional requirement, not a replacement.
			host := ctx.WithBlockTime(ctx.BlockTime().Add(3 * time.Minute)).WithBlockHeight(101)
			if membership {
				require.ErrorIs(t, cs.VerifyMembership(host, store, cdc, cs.LatestHeight, uint64(4*time.Minute), 0, proof, path, value), ErrDelayPeriodNotPassed)
			} else {
				require.ErrorIs(t, cs.VerifyNonMembership(host, store, cdc, cs.LatestHeight, uint64(4*time.Minute), 0, proof, path), ErrDelayPeriodNotPassed)
			}
			cs.FrozenHeight = FrozenHeight
			require.ErrorIs(t, verify(time.Hour, 102), clienttypes.ErrClientFrozen)
			cs.FrozenHeight = ZeroHeight()
			cs.EpochContextChallenges = nil // Legacy state fails closed.
			require.ErrorIs(t, verify(time.Hour, 102), ErrEpochContextPending)
		})
	}
}

func TestRolloverChallengeRetainsRootlessTrustAndDoesNotReset(t *testing.T) {
	base := newTemporalVerifierEpochContext(7, 0, 1_000, 7)
	ctx, cdc, store, cs := initializeTemporalVerifierClient(t, "challenge-rollover", 969, base)
	ctx = ctx.WithBlockTime(time.Unix(0, int64(mustTestTimestampForSlot(t, cs, 1_024))))
	makeHeader := func(hash string, height, slot, epoch uint64) (*ProbabilisticHeader, headerAuthenticator) {
		header := newTemporalVerifierHeader(t, cs, hash, height, slot, epoch, true)
		header.TrustedHeight = cs.LatestCheckpointHeight
		authenticated := newTemporalVerifierAuthenticatedHeader(t, cs, cs.LatestCheckpointBlockHash, hash, height, slot, epoch)
		return header, func(*ProbabilisticHeader, []*EpochContext, map[string]uint64) (*authenticatedProbabilisticHeader, error) {
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
	cs, _ = getClientState(store, cdc)
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
	require.Equal(t, "rootless-11", trusted.blockHash)
	require.Equal(t, uint64(7), contexts[0].Epoch)

	// A second self-consistent context is evidence of disagreement. It must
	// remain verifiable against the pre-proposal checkpoint after advancement.
	honest := *proposal
	honest.NewEpochContext = cloneEpochContext(proposal.NewEpochContext)
	honest.NewEpochContext.EpochNonce = bytes.Repeat([]byte{0x99}, 32)
	evidence := &Misbehaviour{ProbabilisticHeader1: proposal, ProbabilisticHeader2: &honest}
	require.NoError(t, cs.verifyMisbehaviourWithAuthenticator(ctx, store, cdc, evidence, authenticateProposal))
	require.True(t, cs.CheckForMisbehaviour(ctx, cdc, store, evidence))
	// The honest fork may still be in the previous epoch at the disputed
	// height; it must find the same saved cursor without claiming epoch 8.
	oldEpochWitness := newTemporalVerifierHeader(t, cs, "honest-old-epoch", 12, 971, 7, true)
	oldEpochWitness.TrustedHeight = proposal.TrustedHeight
	oldAuthenticated := newTemporalVerifierAuthenticatedHeader(t, cs, "rootless-11", "honest-old-epoch", 12, 971, 7)
	mixedEvidence := &Misbehaviour{ProbabilisticHeader1: proposal, ProbabilisticHeader2: oldEpochWitness}
	require.NoError(t, cs.verifyMisbehaviourWithAuthenticator(ctx, store, cdc, mixedEvidence,
		func(header *ProbabilisticHeader, contexts []*EpochContext, counters map[string]uint64) (*authenticatedProbabilisticHeader, error) {
			if header == oldEpochWitness {
				return oldAuthenticated, nil
			}
			return authenticateProposal(header, contexts, counters)
		}))
	cs.UpdateStateOnMisbehaviour(ctx, cdc, store, evidence)
	frozen, _ := getClientState(store, cdc)
	require.Equal(t, exported.Frozen, frozen.Status(ctx, store, cdc))
	require.ErrorIs(t, frozen.verifyEpochUsable(ctx.WithBlockTime(ctx.BlockTime().Add(time.Hour)), 8), clienttypes.ErrClientFrozen)

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
	err := cs.verifyHeaderWithAuthenticator(ctx, store, cdc, header, func(*ProbabilisticHeader, []*EpochContext, map[string]uint64) (*authenticatedProbabilisticHeader, error) {
		return authenticated, nil
	})
	require.ErrorIs(t, err, ErrEpochContextPending)
}

func challengeTestProof(t *testing.T, membership bool) ([]byte, []byte, []byte, []byte) {
	t.Helper()
	key, value := []byte("commitments/test"), []byte("packet-commitment")
	if !membership {
		value = nil
	}
	hash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(hash[:8])
	path := make([]*ics23.InnerOp, 64)
	for depth := range path {
		if (index>>uint(depth))&1 == 0 {
			path[depth] = &ics23.InnerOp{Prefix: []byte{1}, Suffix: make([]byte, 32)}
		} else {
			path[depth] = &ics23.InnerOp{Prefix: append([]byte{1}, make([]byte, 32)...)}
		}
	}
	root, err := probabilisticcore.ComputeRootFromProofPath(key, value, path)
	require.NoError(t, err)
	existence := &ics23.ExistenceProof{Key: key, Value: value, Path: path}
	proof := &ics23.CommitmentProof{Proof: &ics23.CommitmentProof_Exist{Exist: existence}}
	if !membership {
		proof.Proof = &ics23.CommitmentProof_Nonexist{Nonexist: &ics23.NonExistenceProof{Key: key, Left: existence}}
	}
	encoded, err := (&commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{proof}}).Marshal()
	require.NoError(t, err)
	return root, encoded, key, value
}
