package state

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

type retainedVerification struct {
	Expires   uint64
	Reference []byte
	Height    uint64
}

func retentionPrefix(namespace []byte) []byte {
	return append([]byte("snapshots/v2/retention/"), namespace...)
}
func retentionKey(cs *ClientState, class byte, id []byte) []byte {
	return append(append(binary.BigEndian.AppendUint64(retentionPrefix(cs.StorageNamespace), cs.VerificationGeneration), class), id...)
}
func retainVerification(store storetypes.KVStore, cs *ClientState, class byte, id, reference []byte, height, expires uint64) error {
	key := retentionKey(cs, class, id)
	raw, err := cbor.Encode(retainedVerification{expires, bytes.Clone(reference), height})
	if err != nil {
		return err
	}
	old := store.Get(key)
	if len(old) > 0 {
		if !bytes.Equal(old, raw) {
			return fmt.Errorf("retained verification index is immutable")
		}
		return nil
	}
	store.Set(key, raw)
	return nil
}
func retentionDeadline(cs *ClientState, now uint64) uint64 {
	duration := uint64(cs.TrustingPeriod) + uint64(SharedSnapshotChallengePeriod)
	if math.MaxUint64-now < duration {
		return math.MaxUint64
	}
	return now + duration
}
func retainCheckpoint(store storetypes.KVStore, cs *ClientState, cp *verificationCheckpoint, reference []byte) error {
	id := binary.BigEndian.AppendUint64(nil, cp.Height)
	if err := pinVerificationCheckpoint(store, cp, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 5, id)); err != nil {
		return err
	}
	return retainVerification(store, cs, 3, id, reference, cp.Height, retentionDeadline(cs, cp.Timestamp))
}
func cleanupRetainedVerification(ctx Context, shared, private storetypes.KVStore, cs *ClientState) error {
	scope, err := verificationScope(cs)
	if err != nil {
		return err
	}
	prefix := retentionPrefix(cs.StorageNamespace)
	cursor := private.Get([]byte("verificationCleanupCursor"))
	start := prefix
	if len(cursor) > 0 {
		start = append(bytes.Clone(cursor), 0)
	}
	iterator := shared.Iterator(start, storetypes.PrefixEndBytes(prefix))
	type record struct{ Key, Value []byte }
	var records []record
	for ; iterator.Valid() && len(records) < 8; iterator.Next() {
		records = append(records, record{bytes.Clone(iterator.Key()), bytes.Clone(iterator.Value())})
	}
	more := iterator.Valid()
	iterator.Close()
	now := ctx.BlockTime().UnixNano()
	if now <= 0 {
		return fmt.Errorf("invalid cleanup host time")
	}
	for _, record := range records {
		if len(record.Key) < len(prefix)+9 {
			return fmt.Errorf("invalid retention index")
		}
		gen := binary.BigEndian.Uint64(record.Key[len(prefix):])
		class := record.Key[len(prefix)+8]
		id := record.Key[len(prefix)+9:]
		var retained retainedVerification
		if _, err := cbor.Decode(record.Value, &retained); err != nil {
			return err
		}
		discarded := gen < cs.VerificationGeneration
		if !discarded && (retained.Expires > uint64(now) || gen > cs.VerificationGeneration) {
			continue
		}
		old := *cs
		old.VerificationGeneration = gen
		switch class {
		case 1:
			session, err := loadObservationSession(shared, &old, id)
			if err != nil {
				return err
			}
			if err := releaseObservationSession(shared, &old, id, session); err != nil {
				return err
			}
			shared.Delete(observationSessionKey(old.StorageNamespace, gen, id))
		case 2:
			// Keep discovery and query authorization while another session,
			// proposal or completed alternative still needs this receipt.
			refs := shared.Get(objectKey("objectRefs", scope, objectReceipt, [32]byte(id)))
			if !discarded && len(refs) == 8 && binary.BigEndian.Uint64(refs) > 1 {
				continue
			}
			if err := pinSnapshotObject(shared, scope, objectReceipt, [32]byte{}, namespaceOwner(old.StorageNamespace, gen, 9, id)); err != nil {
				return err
			}
			if err := pinVerificationCheckpoint(shared, &verificationCheckpoint{Scope: scope}, namespaceOwner(old.StorageNamespace, gen, 3, id)); err != nil {
				return err
			}
		case 3:
			if !discarded && (retained.Height == cs.LatestCheckpointHeight.RevisionHeight || retained.Height == cs.LatestHeight.RevisionHeight) {
				continue
			}
			if err := pinVerificationCheckpoint(shared, &verificationCheckpoint{Scope: scope}, namespaceOwner(old.StorageNamespace, gen, 5, id)); err != nil {
				return err
			}
			private.Delete(ownedCheckpointKey(gen, retained.Height))
			if !discarded {
				height := NewHeight(0, retained.Height)
				private.Delete(consensusStateKey(height))
				private.Delete(ProcessedTimeKey(height))
				private.Delete(ProcessedHeightKey(height))
				private.Delete(IterationKey(height))
			}
		case 4:
			epoch := binary.BigEndian.Uint64(id)
			if !discarded && epoch > cs.CurrentEpoch {
				continue
			}
			if err := pinSnapshotObject(shared, scope, objectReceipt, [32]byte{}, namespaceOwner(old.StorageNamespace, gen, 6, id)); err != nil {
				return err
			}
			shared.Delete(activatedEpochKey(&old, epoch))
		default:
			return fmt.Errorf("unknown retention record kind")
		}
		shared.Delete(record.Key)
	}
	if more && len(records) > 0 {
		private.Set([]byte("verificationCleanupCursor"), records[len(records)-1].Key)
	} else {
		private.Delete([]byte("verificationCleanupCursor"))
	}
	return nil
}
