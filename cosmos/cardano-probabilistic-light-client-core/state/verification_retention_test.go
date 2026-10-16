package state

import (
	"bytes"
	"encoding/binary"
	"testing"

	storetypes "cosmossdk.io/store/types"
	"github.com/stretchr/testify/require"
)

func TestCleanupReclaimsDiscardedConsensusAcrossRecoveries(t *testing.T) {
	m := newMithrilRecovery(t)
	subject, private := m.client(t, m.network, 100)
	first, firstStore := m.client(t, m.network, 200)
	second, secondStore := m.client(t, m.network, 300)
	base := subject.LatestHeight.RevisionHeight
	keys := func(height *Height) [][]byte {
		return [][]byte{consensusStateKey(height), ProcessedTimeKey(height), ProcessedHeightKey(height), IterationKey(height)}
	}
	stored := func(height *Height) [][]byte {
		var values [][]byte
		for _, key := range keys(height) {
			value := private.Get(key)
			require.NotEmpty(t, value, "missing %s", key)
			values = append(values, bytes.Clone(value))
		}
		return values
	}
	// Populate retained historical proof heights without replaying unrelated
	// header verification. Each checkpoint uses the client's owned snapshot pages.
	retainProof := func(height *Height) {
		current, _, err := currentVerificationCheckpoint(m.ctx, subject)
		require.NoError(t, err)
		checkpoint := *current
		checkpoint.Height = height.RevisionHeight
		checkpoint.Slot -= current.Height - checkpoint.Height
		checkpoint.Timestamp, err = subject.DeriveTimestampFromSlot(checkpoint.Slot)
		require.NoError(t, err)
		reference, err := saveVerificationCheckpoint(m.shared, &checkpoint)
		require.NoError(t, err)
		require.NoError(t, retainCheckpoint(m.shared, subject, &checkpoint, reference[:]))
		private.Set(ownedCheckpointKey(subject.VerificationGeneration, checkpoint.Height), reference[:])
		consensus, found := GetConsensusState(private, m.cdc, subject.LatestHeight)
		require.True(t, found)
		consensus.Timestamp = checkpoint.Timestamp
		consensus.CheckpointReference = reference[:]
		SetConsensusState(private, m.cdc, consensus, height)
		setConsensusMetadata(m.ctx, private, height)
	}

	discarded := map[uint64][]*Height{1: {subject.LatestHeight}}
	for offset := uint64(18); offset > 0; offset-- {
		height := NewHeight(0, base-offset)
		retainProof(height)
		discarded[1] = append(discarded[1], height)
	}
	reused := NewHeight(0, base-1)
	var err error
	subject, err = m.recover(t, subject, private, first, firstStore)
	require.NoError(t, err)
	require.Equal(t, uint64(2), subject.VerificationGeneration)
	for _, height := range discarded[1] {
		stored(height)
		_, found := GetConsensusState(private, m.cdc, height)
		require.False(t, found, "recovery quarantines old proofs before cleanup")
	}
	// A newer generation can replace a record at a previously retained height.
	// Its consensus bytes and delay metadata must survive old-owner cleanup.
	retainProof(reused)
	discarded[2] = []*Height{subject.LatestHeight, reused}
	for offset := uint64(1); offset <= 9; offset++ {
		height := NewHeight(0, base+offset)
		retainProof(height)
		discarded[2] = append(discarded[2], height)
	}
	retained := stored(reused)
	require.NoError(t, subject.ContinueMaintenance(m.ctx, m.cdc, private, ObservationCleanup))
	require.Equal(t, retained, stored(reused))
	removed := 0
	for _, height := range discarded[1] {
		if !private.Has(consensusStateKey(height)) {
			removed++
		}
	}
	require.Positive(t, removed)
	require.LessOrEqual(t, removed, 8, "one maintenance call must stay bounded")
	require.Less(t, removed, len(discarded[1]))
	require.True(t, private.Has([]byte("verificationCleanupCursor")))

	// Recover again while cleanup is partway through the discarded generation.
	subject, err = m.recover(t, subject, private, second, secondStore)
	require.NoError(t, err)
	require.Equal(t, uint64(3), subject.VerificationGeneration)
	retainProof(reused)
	retained = stored(reused)
	latest := stored(subject.LatestHeight)
	for step := 0; step < 64; step++ {
		require.NoError(t, subject.ContinueMaintenance(m.ctx, m.cdc, private, ObservationCleanup))
		require.Equal(t, retained, stored(reused))
		require.Equal(t, latest, stored(subject.LatestHeight))
		if !private.Has([]byte("verificationCleanupCursor")) {
			break
		}
	}
	require.False(t, private.Has([]byte("verificationCleanupCursor")))
	for generation, heights := range discarded {
		for _, height := range heights {
			require.False(t, private.Has(ownedCheckpointKey(generation, height.RevisionHeight)))
			if height.EQ(reused) {
				continue
			}
			for _, key := range keys(height) {
				require.False(t, private.Has(key), "discarded generation %d left %s", generation, key)
			}
		}
	}
	prefix := retentionPrefix(subject.StorageNamespace)
	iterator := m.shared.Iterator(prefix, storetypes.PrefixEndBytes(prefix))
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		require.Equal(t, subject.VerificationGeneration, binary.BigEndian.Uint64(iterator.Key()[len(prefix):]))
	}
	consensus, found := GetConsensusState(private, m.cdc, reused)
	require.True(t, found)
	require.Equal(t, subject.VerificationGeneration, consensus.VerificationGeneration)
	require.Equal(t, Active, subject.Status(m.ctx, private, m.cdc))
}
