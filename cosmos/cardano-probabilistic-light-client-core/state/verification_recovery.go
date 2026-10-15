package state

import (
	"bytes"
	"encoding/binary"
	"fmt"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

const ObservationContinueRecovery uint32 = 12
const recoveryCounterRowsPerStep = 32

type recoveryPreparation struct {
	Generation      uint64
	Subject         *verificationCheckpoint
	Replacement     *ClientState
	Checkpoint      *verificationCheckpoint
	ProofCheckpoint *verificationCheckpoint
	Consensus       *ConsensusState
	Cursor          []byte
	Checked         uint64
	MithrilRoots    []certifiedStakeRoot
}

func recoveryPreparationKey(cs *ClientState) []byte {
	return append([]byte("snapshots/v2/recovery/"), cs.StorageNamespace...)
}
func (cs *ClientState) beginRecovery(ctx Context, cdc StateCodec, private, substitutePrivate storetypes.KVStore, substitute *ClientState) error {
	if cs.StorageVersion != StorageVersion || substitute.StorageVersion != StorageVersion || substitute.BootstrapPending || cs.BootstrapPending {
		return fmt.Errorf("recovery requires two completely initialized clients")
	}
	if !IsMatchingClientState(*cs, *substitute) {
		return ErrIBCInvalidSubstitute
	}
	if err := substitute.Validate(); err != nil {
		return err
	}
	if substitute.Status(ctx, substitutePrivate, cdc) != Active {
		return fmt.Errorf("substitute is not active")
	}
	subject, shared, err := currentVerificationCheckpoint(ctx, cs)
	if err != nil {
		return err
	}
	replacement, _, err := currentVerificationCheckpoint(ctx, substitute)
	if err != nil {
		return err
	}
	if subject.Scope != replacement.Scope || replacement.Height <= subject.Height || replacement.Slot <= subject.Slot || replacement.Timestamp <= subject.Timestamp {
		return fmt.Errorf("substitute must have compatible rules and a newer authenticated cursor")
	}
	if cs.VerificationGeneration == ^uint64(0) {
		return fmt.Errorf("verification generation overflow")
	}
	// This entry point is reached only through authorized client recovery. A
	// new approval replaces the old preparation, including its counter cursor.
	// Continuation alone can neither choose a replacement nor unfreeze a client.
	consensus, found := GetConsensusState(substitutePrivate, cdc, substitute.LatestHeight)
	if !found || consensus.VerificationGeneration != substitute.VerificationGeneration {
		return fmt.Errorf("substitute proof state is missing or quarantined")
	}
	if err := consensus.ValidateBasic(); err != nil {
		return err
	}
	proof, err := loadVerificationCheckpoint(shared, replacement.Scope, consensus.CheckpointReference)
	if err != nil {
		return err
	}
	if proof.Height != substitute.LatestHeight.RevisionHeight || proof.Timestamp != consensus.Timestamp || proof.BlockHash != mustBlockHash(consensus.AcceptedBlockHash) || !bytes.Equal(proof.HostRoot[:], consensus.IbcStateRoot) || !bytes.Equal(proof.PacketReference[:], consensus.PacketStateReference) {
		return fmt.Errorf("substitute consensus does not match its authenticated checkpoint")
	}
	for role, checkpoint := range []*verificationCheckpoint{replacement, proof} {
		if err := pinVerificationCheckpoint(shared, checkpoint, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 8, []byte{byte(role)})); err != nil {
			return err
		}
	}
	// Only this step can read the substitute's store, so its certified roots
	// are pinned here with its anchor and installed together at activation.
	mithrilRoots, err := recoveredMithrilRoots(cs, private, substitute, substitutePrivate, replacement.Epoch)
	if err != nil {
		return err
	}
	recovery := &recoveryPreparation{Generation: cs.VerificationGeneration, Subject: subject, Replacement: substitute, Checkpoint: replacement, ProofCheckpoint: proof, Consensus: consensus, MithrilRoots: mithrilRoots}
	raw, err := cbor.Encode(recovery)
	if err != nil {
		return err
	}
	if len(raw) > maxSessionBytes {
		return fmt.Errorf("recovery preparation exceeds its bounded metadata")
	}
	shared.Set(recoveryPreparationKey(cs), raw)
	cs.FrozenHeight = NewHeight(0, 1)
	if err := writeClientState(ctx, cdc, private, cs); err != nil {
		return err
	}
	if subject.Counters == replacement.Counters {
		recovery.Checked = subject.Counters.Rows
		return cs.activateRecovery(ctx, cdc, private, shared, recovery)
	}
	ctx.emitEvent("probabilistic_recovery_pending", newEventAttribute("generation", fmt.Sprint(cs.VerificationGeneration)))
	return nil
}
func (cs *ClientState) continueRecovery(ctx Context, cdc StateCodec, private, shared storetypes.KVStore) error {
	raw := shared.Get(recoveryPreparationKey(cs))
	var recovery recoveryPreparation
	if len(raw) == 0 || len(raw) > maxSessionBytes {
		return fmt.Errorf("no authorized recovery is awaiting continuation")
	}
	if _, err := cbor.Decode(raw, &recovery); err != nil {
		return err
	}
	if recovery.Generation != cs.VerificationGeneration || recovery.Subject.Scope != recovery.Checkpoint.Scope {
		return fmt.Errorf("recovery context changed")
	}
	counterMap := NewSnapshotMap(shared, recovery.Subject.Scope, snapshotCounters)
	n, err := counterMap.Visit(recovery.Subject.Counters, recovery.Cursor, recoveryCounterRowsPerStep, func(key, value []byte) error {
		if len(value) != 8 {
			return fmt.Errorf("invalid retained certificate counter")
		}
		next, found, err := counterMap.Lookup(recovery.Checkpoint.Counters, key)
		if err != nil {
			return err
		}
		if !found || len(next) != 8 || binary.BigEndian.Uint64(next) < binary.BigEndian.Uint64(value) {
			return fmt.Errorf("replacement rolls back an authenticated certificate counter")
		}
		recovery.Cursor = bytes.Clone(key)
		return nil
	})
	if err != nil {
		return err
	}
	recovery.Checked += uint64(n)
	if recovery.Checked == recovery.Subject.Counters.Rows {
		return cs.activateRecovery(ctx, cdc, private, shared, &recovery)
	}
	if n == 0 {
		return fmt.Errorf("recovery counter scan did not reach all retained rows")
	}
	raw, err = cbor.Encode(recovery)
	if err != nil {
		return err
	}
	shared.Set(recoveryPreparationKey(cs), raw)
	return nil
}
func (cs *ClientState) activateRecovery(ctx Context, cdc StateCodec, private, shared storetypes.KVStore, recovery *recoveryPreparation) error {
	if recovery.Checked != recovery.Subject.Counters.Rows || recovery.Generation != cs.VerificationGeneration {
		return fmt.Errorf("authorized recovery has unfinished checks")
	}
	// The pinned objects are immutable, but their source generation can be
	// invalidated while counter batches commit. Every freeze/recovery
	// updates this authenticated namespace record alongside the private client.
	// A newer checkpoint in the same healthy generation keeps the pin valid.
	raw := shared.Get(namespaceKey(recovery.Replacement.StorageNamespace))
	if len(raw) == 0 || len(raw) > MaxClientBytes {
		return fmt.Errorf("recovery substitute record is missing or oversized")
	}
	live := cdc.DecodeClient(raw)
	if live == nil || !bytes.Equal(live.StorageNamespace, recovery.Replacement.StorageNamespace) {
		return fmt.Errorf("recovery substitute namespace changed")
	}
	if live.VerificationGeneration != recovery.Replacement.VerificationGeneration {
		return fmt.Errorf("recovery substitute generation was invalidated")
	}
	if live.FrozenHeight != nil && !live.FrozenHeight.IsZero() {
		return fmt.Errorf("recovery substitute is frozen")
	}
	if err := live.Validate(); err != nil {
		return fmt.Errorf("recovery substitute is invalid: %w", err)
	}
	if live.BootstrapPending || !IsMatchingClientState(*recovery.Replacement, *live) {
		return fmt.Errorf("recovery substitute rules changed or bootstrap is incomplete")
	}
	if recovery.Replacement.IsExpired(recovery.Checkpoint.Timestamp, ctx.BlockTime()) {
		return ErrTrustingPeriodExpired
	}
	replacement := *recovery.Replacement
	replacement.StorageNamespace = bytes.Clone(cs.StorageNamespace)
	replacement.VerificationGeneration = cs.VerificationGeneration + 1
	replacement.FrozenHeight = ZeroHeight()
	replacement.BootstrapObjects = nil
	if err := replacement.resetEpochDeadline(ctx, replacement.CurrentEpoch); err != nil {
		return err
	}
	deadline := replacement.EpochContextChallenges[0].UsableAfterUnixNs
	if replacement.TrustingPeriod <= 0 || recovery.Checkpoint.Timestamp > ^uint64(0)-uint64(replacement.TrustingPeriod) || recovery.Checkpoint.Timestamp+uint64(replacement.TrustingPeriod) <= deadline {
		return fmt.Errorf("recovery must leave its entire response window inside the replacement's trusting period")
	}
	if recovery.Consensus.AcceptedEpoch != replacement.CurrentEpoch {
		replacement.EpochContextChallenges = append(replacement.EpochContextChallenges, &EpochContextChallenge{Epoch: recovery.Consensus.AcceptedEpoch, UsableAfterUnixNs: replacement.EpochContextChallenges[0].UsableAfterUnixNs})
	}
	if err := pinVerificationCheckpoint(shared, recovery.Checkpoint, namespaceOwner(replacement.StorageNamespace, replacement.VerificationGeneration, 1, nil)); err != nil {
		return err
	}
	for _, checkpoint := range []*verificationCheckpoint{recovery.Checkpoint, recovery.ProofCheckpoint} {
		ref, err := saveVerificationCheckpoint(shared, checkpoint)
		if err != nil {
			return err
		}
		private.Set(ownedCheckpointKey(replacement.VerificationGeneration, checkpoint.Height), ref[:])
		if err := retainCheckpoint(shared, &replacement, checkpoint, ref[:]); err != nil {
			return err
		}
	}
	for _, root := range recovery.MithrilRoots {
		private.Set(mithrilStakeRootKey(replacement.VerificationGeneration, root.Epoch), []byte(root.Root))
	}
	consensus := *recovery.Consensus
	consensus.VerificationGeneration = replacement.VerificationGeneration
	SetConsensusState(private, cdc, &consensus, replacement.LatestHeight)
	setConsensusMetadata(ctx, private, replacement.LatestHeight)
	if err := writeClientState(ctx, cdc, private, &replacement); err != nil {
		return err
	}
	for role := byte(0); role < 2; role++ {
		if err := pinVerificationCheckpoint(shared, &verificationCheckpoint{Scope: recovery.Checkpoint.Scope}, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 8, []byte{role})); err != nil {
			return err
		}
	}
	if err := pinVerificationCheckpoint(shared, &verificationCheckpoint{Scope: recovery.Checkpoint.Scope}, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 1, nil)); err != nil {
		return err
	}
	shared.Delete(recoveryPreparationKey(cs))
	*cs = replacement
	ctx.emitEvent("probabilistic_recovery_activated", newEventAttribute("generation", fmt.Sprint(cs.VerificationGeneration)))
	return nil
}

// Maintenance never creates authority. Recovery steps can only finish the exact
// replacement pinned by an authorized recovery. Cleanup can run while frozen.
func (cs *ClientState) ContinueMaintenance(ctx Context, cdc StateCodec, private storetypes.KVStore, operation uint32) error {
	if cs.StorageVersion != StorageVersion {
		return fmt.Errorf("maintenance requires snapshot storage")
	}
	shared, err := ctx.snapshotStore()
	if err != nil {
		return err
	}
	before := uint64(0)
	if ctx.GasConsumed != nil {
		before = ctx.GasConsumed()
	}
	switch operation {
	case ObservationContinueRecovery:
		err = cs.continueRecovery(ctx, cdc, private, shared)
	case ObservationCleanup:
		if err := cleanupRetainedVerification(ctx, shared, private, cs); err != nil {
			return err
		}
		scope, scopeErr := verificationScope(cs)
		if scopeErr != nil {
			return scopeErr
		}
		for _, kind := range []byte{objectCheckpoint, objectPacket, objectReceipt, objectBody} {
			if _, err := collectSnapshotObjects(shared, scope, kind, 8); err != nil {
				return err
			}
		}
		for _, kind := range []byte{snapshotRegistry, snapshotBindings, snapshotStake, snapshotCredit, snapshotProduction, snapshotCounters, snapshotSettledHistory, snapshotQualified, snapshotPacketLanes, snapshotPacketInputs, snapshotPacketRoutes, snapshotBootstrapFrontier} {
			if _, err = NewSnapshotMap(shared, scope, kind).Collect(8); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("unsupported maintenance operation")
	}
	if err != nil {
		return err
	}
	if ctx.GasConsumed != nil && ctx.GasConsumed()-before > MaxVerificationWorkGas {
		return fmt.Errorf("maintenance exceeded its bounded gas allowance")
	}
	return nil
}
