package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

const objectCheckpoint byte = 1
const objectPacket byte = 2
const objectReceipt byte = 3
const objectBody byte = 4

type snapshotObjectInfo struct {
	Kind byte
	Key  []byte
}

func objectPrefix(name string, scope [32]byte, kind byte) []byte {
	return append(append([]byte("snapshots/v2/"+name+"/"), scope[:]...), kind)
}
func objectKey(name string, scope [32]byte, kind byte, id [32]byte) []byte {
	return append(objectPrefix(name, scope, kind), id[:]...)
}
func snapshotObjectOwner(scope [32]byte, kind byte, id [32]byte) []byte {
	return append(append(append([]byte("object/v2/"), scope[:]...), kind), id[:]...)
}
func adjustObjectReferences(store storetypes.KVStore, scope [32]byte, kind byte, id [32]byte, increase bool) error {
	key := objectKey("objectRefs", scope, kind, id)
	raw := store.Get(key)
	var count uint64
	if len(raw) > 0 {
		if len(raw) != 8 {
			return fmt.Errorf("invalid immutable object reference count")
		}
		count = binary.BigEndian.Uint64(raw)
	}
	if increase {
		if count == ^uint64(0) {
			return fmt.Errorf("object reference count overflow")
		}
		count++
	} else {
		if count == 0 {
			return fmt.Errorf("object reference count underflow")
		}
		count--
	}
	if count == 0 {
		store.Delete(key)
		store.Set(objectKey("objectGC", scope, kind, id), []byte{1})
	} else {
		store.Set(key, binary.BigEndian.AppendUint64(nil, count))
	}
	return nil
}
func registerSnapshotObject(store storetypes.KVStore, scope [32]byte, kind byte, id [32]byte, key []byte) error {
	meta := objectKey("objectMeta", scope, kind, id)
	info, err := cbor.Encode(snapshotObjectInfo{kind, bytes.Clone(key)})
	if err != nil {
		return err
	}
	old := store.Get(meta)
	if len(old) > 0 {
		if !bytes.Equal(old, info) {
			return fmt.Errorf("snapshot object metadata collision")
		}
		return nil
	}
	store.Set(meta, info)
	store.Set(objectKey("objectGC", scope, kind, id), []byte{1})
	owner := snapshotObjectOwner(scope, kind, id)
	switch kind {
	case objectCheckpoint:
		cp, err := loadVerificationCheckpoint(store, scope, id[:])
		if err != nil {
			return err
		}
		return pinCheckpointContents(store, cp, owner)
	case objectPacket:
		return pinPacketContents(store, scope, id, owner)
	case objectReceipt:
		var receipt verifiedObservation
		if _, err := cbor.Decode(store.Get(key), &receipt); err != nil {
			return err
		}
		if err := pinSnapshotObject(store, scope, objectCheckpoint, [32]byte(receipt.BaseReference), append(bytes.Clone(owner), receiptOwnerBase)); err != nil {
			return err
		}
		if err := pinSnapshotObject(store, scope, objectCheckpoint, receipt.AnchorReference, append(bytes.Clone(owner), receiptOwnerAnchor)); err != nil {
			return err
		}
		if len(receipt.OriginalReceipt) != 0 {
			if err := pinSnapshotObject(store, scope, objectReceipt, [32]byte(receipt.OriginalReceipt), append(bytes.Clone(owner), receiptOwnerOriginalReceipt)); err != nil {
				return err
			}
		}
		return NewSnapshotMap(store, scope, snapshotStake).Pin(append(bytes.Clone(owner), receiptOwnerStake), receipt.Table.Root)
	case objectBody:
		return nil
	default:
		return fmt.Errorf("unknown immutable object kind")
	}
}
func pinSnapshotObject(store storetypes.KVStore, scope [32]byte, kind byte, id [32]byte, owner []byte) error {
	ownerHash := sha256.Sum256(owner)
	key := append(objectPrefix("objectOwners", scope, kind), ownerHash[:]...)
	old := store.Get(key)
	if len(old) > 0 && len(old) != 32 {
		return fmt.Errorf("invalid immutable object owner")
	}
	if len(old) == 32 && bytes.Equal(old, id[:]) {
		return nil
	}
	if id != [32]byte{} {
		if !store.Has(objectKey("objectMeta", scope, kind, id)) {
			return fmt.Errorf("cannot pin an absent immutable object")
		}
		if err := adjustObjectReferences(store, scope, kind, id, true); err != nil {
			return err
		}
		store.Set(key, id[:])
	} else {
		store.Delete(key)
	}
	if len(old) > 0 {
		if err := adjustObjectReferences(store, scope, kind, [32]byte(old), false); err != nil {
			return err
		}
	}
	return nil
}
func collectSnapshotObjects(store storetypes.KVStore, scope [32]byte, kind byte, limit int) (int, error) {
	prefix := objectPrefix("objectGC", scope, kind)
	iterator := store.Iterator(prefix, storetypes.PrefixEndBytes(prefix))
	var ids [][32]byte
	for ; iterator.Valid() && len(ids) < limit; iterator.Next() {
		key := iterator.Key()
		if len(key) != len(prefix)+32 {
			iterator.Close()
			return 0, fmt.Errorf("invalid immutable object cleanup key")
		}
		ids = append(ids, [32]byte(key[len(prefix):]))
	}
	iterator.Close()
	for _, id := range ids {
		store.Delete(objectKey("objectGC", scope, kind, id))
		if store.Has(objectKey("objectRefs", scope, kind, id)) {
			continue
		}
		meta := objectKey("objectMeta", scope, kind, id)
		raw := store.Get(meta)
		if len(raw) == 0 {
			continue
		}
		var info snapshotObjectInfo
		if _, err := cbor.Decode(raw, &info); err != nil {
			return 0, err
		}
		owner := snapshotObjectOwner(scope, kind, id)
		switch kind {
		case objectCheckpoint:
			if err := pinCheckpointContents(store, &verificationCheckpoint{Scope: scope}, owner); err != nil {
				return 0, err
			}
		case objectPacket:
			if err := pinPacketContents(store, scope, [32]byte{}, owner); err != nil {
				return 0, err
			}
		case objectReceipt:
			if err := pinSnapshotObject(store, scope, objectReceipt, [32]byte{}, append(bytes.Clone(owner), receiptOwnerOriginalReceipt)); err != nil {
				return 0, err
			}
			for _, role := range []byte{receiptOwnerBase, receiptOwnerAnchor} {
				if err := pinSnapshotObject(store, scope, objectCheckpoint, [32]byte{}, append(bytes.Clone(owner), role)); err != nil {
					return 0, err
				}
			}
			if err := NewSnapshotMap(store, scope, snapshotStake).Pin(append(bytes.Clone(owner), receiptOwnerStake), SnapshotRoot{}); err != nil {
				return 0, err
			}
		}
		store.Delete(info.Key)
		store.Delete(meta)
	}
	return len(ids), nil
}
