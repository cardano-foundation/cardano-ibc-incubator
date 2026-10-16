package state

import (
	"bytes"
	"encoding/binary"
	"sort"
	"testing"
	"time"

	"cosmossdk.io/store/dbadapter"
	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/mithriltest"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
)

func recoveryRetryClient(t *testing.T, ctx Context, cdc StateCodec, heightOffset uint64, counter uint64, lastCounter uint64, prepare ...func(*ClientState)) (*ClientState, storetypes.KVStore) {
	t.Helper()
	return recoveryRetryClientWith(t, ctx, cdc, testMithril(t), heightOffset, counter, lastCounter, prepare...)
}

// recoveryRetryClientWith bootstraps the client with network's certificate.
func recoveryRetryClientWith(t *testing.T, ctx Context, cdc StateCodec, network *mithriltest.Network, heightOffset uint64, counter uint64, lastCounter uint64, prepare ...func(*ClientState)) (*ClientState, storetypes.KVStore) {
	t.Helper()
	client, consensus := compactTrustedFixture(t, 65)
	client.TrustingPeriod = 96 * time.Hour
	height := NewHeight(0, client.LatestHeight.RevisionHeight+heightOffset)
	client.LatestHeight = height
	setTestCheckpoint(t, client, height, testBlockHash("recovery-retry-"+height.String()), client.CurrentEpoch, client.LatestCheckpointSlot+heightOffset)
	consensus.Timestamp = client.LatestCheckpointTimestamp
	consensus.AcceptedBlockHash = client.LatestCheckpointBlockHash
	setTestPacketSnapshot(t, consensus, height.RevisionHeight)
	var keys [][]byte
	for _, row := range client.EpochStakeDistribution {
		key, err := poolKey(row.PoolId)
		require.NoError(t, err)
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return bytes.Compare(keys[i], keys[j]) < 0 })
	client.LatestCheckpointOperationalCertificateCounters = nil
	for i, key := range keys {
		value := counter
		if i == len(keys)-1 {
			value = lastCounter
		}
		client.LatestCheckpointOperationalCertificateCounters = append(client.LatestCheckpointOperationalCertificateCounters,
			&OperationalCertificateCounter{PoolId: key, SequenceNumber: value})
	}
	for _, apply := range prepare {
		apply(client)
	}
	private := dbadapter.Store{DB: dbm.NewMemDB()}
	compact, _, err := InitializeFromTrustedCheckpoint(ctx, cdc, private, client, consensus, certifyBootstrap(t, client, network))
	require.NoError(t, err)
	return compact, private
}

func pendingRecovery(t *testing.T, shared storetypes.KVStore, client *ClientState) recoveryPreparation {
	t.Helper()
	var pending recoveryPreparation
	_, err := cbor.Decode(shared.Get(recoveryPreparationKey(client)), &pending)
	require.NoError(t, err)
	return pending
}

func TestFailedSnapshotRecoveryCanBeReplacedByAuthorizedRetry(t *testing.T) {
	_, consensus := compactTrustedFixture(t, 65)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{HostProgress: testHostProgress, Time: time.Unix(0, int64(consensus.Timestamp)).Add(time.Hour), Height: 100, SelfHeight: NewHostHeight(0, 100), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	subject, private := recoveryRetryClient(t, ctx, cdc, 0, 10, 10)
	bad, badStore := recoveryRetryClient(t, ctx, cdc, 10, 11, 9)
	good, goodStore := recoveryRetryClient(t, ctx, cdc, 20, 12, 12)
	ctx.Time = ctx.Time.Add(2 * time.Nanosecond)
	subject.UpdateStateOnMisbehaviour(ctx, cdc, private, nil)
	subject, _ = GetClientState(private, cdc)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, badStore, bad))
	subject, _ = GetClientState(private, cdc)
	// Earlier counter batches commit successfully. The rollback is deliberately
	// in the last row, beyond the first two bounded continuations.
	for i := 0; i < 2; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
	}
	before := bytes.Clone(shared.Get(recoveryPreparationKey(subject)))
	require.ErrorContains(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery), "rolls back")
	require.Equal(t, before, shared.Get(recoveryPreparationKey(subject)))
	require.Equal(t, uint64(1), subject.VerificationGeneration)
	require.Equal(t, Frozen, subject.Status(ctx, private, cdc))
	// Only a new authorized recovery can change the pinned substitute. A fresh
	// preparation resets every checked row and releases the previous pin owners.
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, goodStore, good))
	subject, _ = GetClientState(private, cdc)
	pending := pendingRecovery(t, shared, subject)
	require.Zero(t, pending.Checked)
	require.Empty(t, pending.Cursor)
	require.Equal(t, good.CheckpointReference, pending.Replacement.CheckpointReference)
	for i := 0; i < 3; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
		subject, _ = GetClientState(private, cdc)
	}
	require.Equal(t, Active, subject.Status(ctx, private, cdc))
	require.Equal(t, uint64(2), subject.VerificationGeneration)
	require.Equal(t, good.CheckpointReference, subject.CheckpointReference)
	require.False(t, shared.Has(recoveryPreparationKey(subject)))
	checkpoint, _, err := currentVerificationCheckpoint(ctx, subject)
	require.NoError(t, err)
	_, err = NewSnapshotMap(shared, checkpoint.Scope, snapshotCounters).Visit(checkpoint.Counters, nil, 128, func(_ []byte, value []byte) error {
		require.Equal(t, uint64(12), binary.BigEndian.Uint64(value))
		return nil
	})
	require.NoError(t, err)
}

func TestSnapshotRecoveryRechecksExpiryAndAllowsFreshAuthorization(t *testing.T) {
	_, consensus := compactTrustedFixture(t, 65)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{HostProgress: testHostProgress, Time: time.Unix(0, int64(consensus.Timestamp)).Add(time.Hour), Height: 100, SelfHeight: NewHostHeight(0, 100), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	subject, private := recoveryRetryClient(t, ctx, cdc, 0, 10, 10)
	old, oldStore := recoveryRetryClient(t, ctx, cdc, 10, 11, 11)
	ctx.Time = ctx.Time.Add(2 * time.Nanosecond)
	subject.UpdateStateOnMisbehaviour(ctx, cdc, private, nil)
	subject, _ = GetClientState(private, cdc)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, oldStore, old))
	subject, _ = GetClientState(private, cdc)
	for i := 0; i < 2; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
	}
	ctx.Time = time.Unix(0, int64(old.LatestCheckpointTimestamp)).Add(old.TrustingPeriod)
	require.ErrorIs(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery), ErrTrustingPeriodExpired)
	require.Equal(t, Frozen, subject.Status(ctx, private, cdc))
	require.Equal(t, uint64(1), subject.VerificationGeneration)
	// A new trusted substitute has sufficient remaining lifetime at retry.
	fresh, freshStore := recoveryRetryClient(t, ctx, cdc, uint64((98*time.Hour)/time.Duration(old.SlotLengthNs)), 12, 12)
	ctx.Time = ctx.Time.Add(2 * time.Nanosecond)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, freshStore, fresh))
	subject, _ = GetClientState(private, cdc)
	for i := 0; i < 3; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
		subject, _ = GetClientState(private, cdc)
	}
	require.Equal(t, Active, subject.Status(ctx, private, cdc))
	require.Equal(t, uint64(2), subject.VerificationGeneration)
}

func TestSnapshotRecoveryRejectsSubstituteGenerationChange(t *testing.T) {
	_, consensus := compactTrustedFixture(t, 65)
	shared := dbadapter.Store{DB: dbm.NewMemDB()}
	ctx := Context{HostProgress: testHostProgress, Time: time.Unix(0, int64(consensus.Timestamp)).Add(time.Hour), Height: 100, SelfHeight: NewHostHeight(0, 100), Snapshots: func() (storetypes.KVStore, error) { return shared, nil }}
	cdc := jsonTestCodec{}
	subject, private := recoveryRetryClient(t, ctx, cdc, 0, 10, 10)
	substitute, substitutePrivate := recoveryRetryClient(t, ctx, cdc, 10, 11, 11)
	fresh, freshPrivate := recoveryRetryClient(t, ctx, cdc, 20, 12, 12)
	ctx.Time = ctx.Time.Add(2 * time.Nanosecond)
	subject.UpdateStateOnMisbehaviour(ctx, cdc, private, nil)
	subject, _ = GetClientState(private, cdc)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, substitutePrivate, substitute))
	subject, _ = GetClientState(private, cdc)
	for i := 0; i < 2; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
	}
	pending := pendingRecovery(t, shared, subject)
	require.Equal(t, uint64(64), pending.Checked)
	require.Equal(t, uint64(1), pending.Replacement.VerificationGeneration)
	require.False(t, pending.Replacement.IsExpired(pending.Checkpoint.Timestamp, ctx.BlockTime()))

	// B is invalidated and then legitimately recovered from C. Its active new
	// generation does not rehabilitate the old snapshot pinned for A.
	substitute.UpdateStateOnMisbehaviour(ctx, cdc, substitutePrivate, nil)
	substitute, _ = GetClientState(substitutePrivate, cdc)
	require.NoError(t, substitute.CheckSubstituteAndUpdateState(ctx, cdc, substitutePrivate, freshPrivate, fresh))
	substitute, _ = GetClientState(substitutePrivate, cdc)
	for i := 0; i < 3; i++ {
		require.NoError(t, substitute.ContinueMaintenance(ctx, cdc, substitutePrivate, ObservationContinueRecovery))
		substitute, _ = GetClientState(substitutePrivate, cdc)
	}
	require.Equal(t, Active, substitute.Status(ctx, substitutePrivate, cdc))
	require.Equal(t, uint64(2), substitute.VerificationGeneration)
	before := bytes.Clone(shared.Get(recoveryPreparationKey(subject)))
	require.ErrorContains(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery), "substitute generation")
	require.Equal(t, before, shared.Get(recoveryPreparationKey(subject)))
	subject, _ = GetClientState(private, cdc)
	require.Equal(t, Frozen, subject.Status(ctx, private, cdc))
	require.Equal(t, uint64(1), subject.VerificationGeneration)
	// The authority can choose the new generation explicitly in a new request.
	ctx.Time = ctx.Time.Add(2 * time.Nanosecond)
	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, private, substitutePrivate, substitute))
	subject, _ = GetClientState(private, cdc)
	for i := 0; i < 3; i++ {
		require.NoError(t, subject.ContinueMaintenance(ctx, cdc, private, ObservationContinueRecovery))
		subject, _ = GetClientState(private, cdc)
	}
	require.Equal(t, Active, subject.Status(ctx, private, cdc))
	require.Equal(t, substitute.CheckpointReference, subject.CheckpointReference)
}
