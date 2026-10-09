package probabilistic

import (
	"crypto/sha256"
	"encoding/binary"
	"testing"
	"time"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
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
			consensus := newProbabilisticTestConsensusState(testBlockHash("bootstrap"))
			consensus.IbcStateRoot = root
			setTestPacketSnapshot(t, consensus, cs.LatestHeight.RevisionHeight)
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
