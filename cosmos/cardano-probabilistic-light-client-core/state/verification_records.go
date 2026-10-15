package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger/common"
)

const StorageVersion uint32 = 2
const VerificationPolicyVersion uint32 = 1
const MaxClientBytes = 4096
const MaxConsensusBytes = 1024
const MaxOperationSignedBytes = 900000
const MaxOperationGas = uint64(36000000)
const MaxRetainedPoolIdentities = uint64(65536)

const (
	snapshotRegistry byte = iota + 1
	snapshotBindings
	snapshotStake
	snapshotCredit
	snapshotProduction
	snapshotCounters
	snapshotSettledHistory
)

type registryProjection struct {
	Root     SnapshotRoot
	Epoch    uint64
	Bindings bool
}
type verificationRegistry struct {
	Records         SnapshotRoot
	Epoch           uint64
	Mark, Effective registryProjection
}
type stakeSnapshot struct {
	Root         SnapshotRoot
	Epoch, Total uint64
}

// verificationCheckpoint is immutable. The public records only carry its hash.
// The generation belongs to the owning client, not to these shareable contents.
type verificationCheckpoint struct {
	Version                                      uint32
	Scope                                        [32]byte
	Height, Slot, Epoch, Timestamp               uint64
	BlockHash                                    [32]byte
	Nonce                                        *PraosNonceState
	Registry                                     verificationRegistry
	Stake                                        stakeSnapshot
	Credit, Production, Counters, SettledHistory SnapshotRoot
	PacketReference                              [32]byte
	HostRoot                                     [32]byte
	Parent                                       [32]byte
}

// Epoch tags permit read-time projection. An epoch tick rotates references and
// does not rewrite every registration or production record.
type storedRegistration struct {
	Epoch                         uint64
	FirstSlot                     uint64
	VRF                           [32]byte
	Registered                    bool
	PendingVRF                    []byte
	PendingEpoch, RetirementEpoch uint64
}

func poolKey(pool string) ([]byte, error) {
	key, err := common.NewPoolIdFromBech32(pool)
	if err != nil || key.String() != pool {
		return nil, fmt.Errorf("pool identifier must be canonical binary-compatible bech32")
	}
	return bytes.Clone(key[:]), nil
}
func poolName(key []byte) (string, error) {
	if len(key) != 28 {
		return "", fmt.Errorf("pool key must be 28 bytes")
	}
	return common.PoolId(key).String(), nil
}
func encodeRegistration(record storedRegistration) ([]byte, error) {
	if len(record.PendingVRF) != 0 && len(record.PendingVRF) != 32 {
		return nil, fmt.Errorf("registration pending key must be 32 bytes")
	}
	raw := binary.BigEndian.AppendUint64(nil, record.Epoch)
	raw = binary.BigEndian.AppendUint64(raw, record.FirstSlot)
	raw = append(raw, record.VRF[:]...)
	flags := byte(0)
	if record.Registered {
		flags |= 1
	}
	if len(record.PendingVRF) > 0 {
		flags |= 2
	}
	raw = append(raw, flags)
	raw = binary.BigEndian.AppendUint64(raw, record.PendingEpoch)
	raw = binary.BigEndian.AppendUint64(raw, record.RetirementEpoch)
	raw = append(raw, record.PendingVRF...)
	return raw, nil
}
func decodeRegistration(raw []byte) (storedRegistration, error) {
	var record storedRegistration
	if len(raw) != 65 && len(raw) != 97 {
		return record, fmt.Errorf("invalid registration record size")
	}
	record.Epoch = binary.BigEndian.Uint64(raw[:8])
	record.FirstSlot = binary.BigEndian.Uint64(raw[8:16])
	copy(record.VRF[:], raw[16:48])
	flags := raw[48]
	if flags > 3 || (flags&2 == 0) != (len(raw) == 65) {
		return record, fmt.Errorf("invalid registration flags")
	}
	record.Registered = flags&1 != 0
	record.PendingEpoch = binary.BigEndian.Uint64(raw[49:57])
	record.RetirementEpoch = binary.BigEndian.Uint64(raw[57:65])
	record.PendingVRF = bytes.Clone(raw[65:])
	if (len(record.PendingVRF) == 0) != (record.PendingEpoch == 0) {
		return record, fmt.Errorf("registration pending key and epoch disagree")
	}
	return record, nil
}
func projectRegistration(record storedRegistration, epoch uint64) (storedRegistration, error) {
	if epoch < record.Epoch {
		return record, fmt.Errorf("registration projection moves backwards")
	}
	if record.PendingEpoch != 0 && record.PendingEpoch <= epoch {
		copy(record.VRF[:], record.PendingVRF)
		record.PendingEpoch = 0
		record.PendingVRF = nil
	}
	if record.RetirementEpoch != 0 && record.RetirementEpoch <= epoch {
		record.Registered = false
		record.RetirementEpoch = 0
	}
	record.Epoch = epoch
	return record, nil
}
func lookupRegistration(store storetypes.KVStore, scope [32]byte, registry verificationRegistry, key []byte) (storedRegistration, bool, error) {
	raw, found, err := NewSnapshotMap(store, scope, snapshotRegistry).Lookup(registry.Records, key)
	if err != nil || !found {
		return storedRegistration{}, found, err
	}
	record, err := decodeRegistration(raw)
	if err != nil {
		return record, false, err
	}
	record, err = projectRegistration(record, registry.Epoch)
	return record, true, err
}
func lookupBinding(store storetypes.KVStore, scope [32]byte, view registryProjection, key []byte) (*PoolRegistrationBinding, bool, error) {
	name, err := poolName(key)
	if err != nil {
		return nil, false, err
	}
	if view.Bindings {
		raw, found, err := NewSnapshotMap(store, scope, snapshotBindings).Lookup(view.Root, key)
		if err != nil || !found {
			return nil, found, err
		}
		if len(raw) != 40 {
			return nil, false, fmt.Errorf("invalid pool binding record")
		}
		return &PoolRegistrationBinding{PoolId: name, VrfKeyHash: bytes.Clone(raw[:32]), FirstRegistrationSlot: binary.BigEndian.Uint64(raw[32:])}, true, nil
	}
	record, found, err := lookupRegistration(store, scope, verificationRegistry{Records: view.Root, Epoch: view.Epoch}, key)
	if err != nil || !found || !record.Registered {
		return nil, false, err
	}
	return &PoolRegistrationBinding{PoolId: name, VrfKeyHash: bytes.Clone(record.VRF[:]), FirstRegistrationSlot: record.FirstSlot}, true, nil
}
func tickVerificationRegistry(registry verificationRegistry, epoch uint64) (verificationRegistry, error) {
	if epoch < registry.Epoch || epoch-registry.Epoch > 1 {
		return registry, fmt.Errorf("registration tick requires the same or adjacent epoch")
	}
	if epoch != registry.Epoch {
		registry.Effective = registry.Mark
		registry.Mark = registryProjection{Root: registry.Records, Epoch: registry.Epoch}
		registry.Epoch = epoch
	}
	return registry, nil
}

func encodeCredit(value *big.Rat) ([]byte, error) {
	if value == nil || value.Sign() <= 0 || value.Cmp(big.NewRat(1, 1)) > 0 {
		return nil, fmt.Errorf("credit must be a positive share at most one")
	}
	n, d := value.Num().Bytes(), value.Denom().Bytes()
	if len(n) > maxSettlementCreditIntegerBytes || len(d) > maxSettlementCreditIntegerBytes {
		return nil, fmt.Errorf("credit integer exceeds its bound")
	}
	raw := []byte{byte(len(n)), byte(len(d))}
	raw = append(raw, n...)
	return append(raw, d...), nil
}
func decodeCredit(raw []byte) (*big.Rat, error) {
	if len(raw) < 4 {
		return nil, fmt.Errorf("invalid exact credit record")
	}
	n, d := int(raw[0]), int(raw[1])
	if n == 0 || d == 0 || n > maxSettlementCreditIntegerBytes || d > maxSettlementCreditIntegerBytes || len(raw) != 2+n+d || raw[2] == 0 || raw[2+n] == 0 {
		return nil, fmt.Errorf("credit is not canonical")
	}
	value := new(big.Rat).SetFrac(new(big.Int).SetBytes(raw[2:2+n]), new(big.Int).SetBytes(raw[2+n:]))
	canonical, err := encodeCredit(value)
	if err != nil || !bytes.Equal(raw, canonical) {
		return nil, fmt.Errorf("credit is not a reduced bounded share")
	}
	return value, nil
}
func lookupCredit(store storetypes.KVStore, scope [32]byte, root SnapshotRoot, key []byte) (*big.Rat, error) {
	raw, found, err := NewSnapshotMap(store, scope, snapshotCredit).Lookup(root, key)
	if err != nil {
		return nil, err
	}
	if !found {
		return new(big.Rat), nil
	}
	return decodeCredit(raw)
}
func encodeProduction(epoch uint64, record *PoolProductionRecord) []byte {
	raw := binary.BigEndian.AppendUint64(nil, epoch)
	flags := byte(record.CompletedEpochsBitmap)
	if record.ProducedCurrentEpoch {
		flags |= 32
	}
	return append(raw, flags)
}
func lookupProduction(store storetypes.KVStore, scope [32]byte, root SnapshotRoot, key []byte, epoch uint64) (*PoolProductionRecord, error) {
	name, err := poolName(key)
	if err != nil {
		return nil, err
	}
	record := &PoolProductionRecord{PoolId: name}
	raw, found, err := NewSnapshotMap(store, scope, snapshotProduction).Lookup(root, key)
	if err != nil || !found {
		return record, err
	}
	if len(raw) != 9 || raw[8] > 63 {
		return nil, fmt.Errorf("invalid production record")
	}
	observedEpoch := binary.BigEndian.Uint64(raw[:8])
	if observedEpoch > epoch {
		return nil, fmt.Errorf("production projection moves backwards")
	}
	distance := epoch - observedEpoch
	flags := uint32(raw[8])
	if distance == 0 {
		record.CompletedEpochsBitmap = flags & 31
		record.ProducedCurrentEpoch = flags&32 != 0
		return record, nil
	}
	if distance <= completedProductionEpochs {
		record.CompletedEpochsBitmap = ((flags & 31) << distance) & completedProductionMask
		if flags&32 != 0 {
			record.CompletedEpochsBitmap |= 1 << (distance - 1)
		}
	}
	return record, nil
}

func checkpointKey(scope, hash [32]byte) []byte {
	key := append([]byte("snapshots/v2/checkpoints/"), scope[:]...)
	return append(key, hash[:]...)
}
func checkpointDigest(scope [32]byte, raw []byte) [32]byte {
	return sha256.Sum256(append(append([]byte("cardano-ibc.checkpoint/v2\x00"), scope[:]...), raw...))
}
func saveVerificationCheckpoint(store storetypes.KVStore, checkpoint *verificationCheckpoint) ([32]byte, error) {
	var zero [32]byte
	if checkpoint.Version != VerificationPolicyVersion || checkpoint.Height == 0 || checkpoint.Timestamp == 0 {
		return zero, fmt.Errorf("invalid verification checkpoint")
	}
	if err := validatePraosNonceState(checkpoint.Nonce); err != nil {
		return zero, err
	}
	raw, err := cbor.Encode(checkpoint)
	if err != nil {
		return zero, err
	}
	if len(raw) > MaxClientBytes {
		return zero, fmt.Errorf("checkpoint exceeds its bounded metadata size")
	}
	hash := checkpointDigest(checkpoint.Scope, raw)
	key := checkpointKey(checkpoint.Scope, hash)
	previous := store.Get(key)
	if len(previous) > 0 && !bytes.Equal(previous, raw) {
		return zero, fmt.Errorf("immutable checkpoint collision")
	}
	if len(previous) == 0 {
		store.Set(key, raw)
	}
	if err := registerSnapshotObject(store, checkpoint.Scope, objectCheckpoint, hash, key); err != nil {
		return zero, err
	}
	return hash, nil
}
func loadVerificationCheckpoint(store storetypes.KVStore, scope [32]byte, hash []byte) (*verificationCheckpoint, error) {
	if len(hash) != 32 {
		return nil, fmt.Errorf("checkpoint reference must be 32 bytes")
	}
	id := [32]byte(hash)
	raw := store.Get(checkpointKey(scope, id))
	if len(raw) == 0 || len(raw) > MaxClientBytes || checkpointDigest(scope, raw) != id {
		return nil, fmt.Errorf("verification checkpoint is missing or its context hash disagrees")
	}
	var value verificationCheckpoint
	if _, err := cbor.Decode(raw, &value); err != nil {
		return nil, err
	}
	if value.Scope != scope || value.Version != VerificationPolicyVersion {
		return nil, fmt.Errorf("checkpoint context or version disagrees")
	}
	return &value, nil
}
func decodeBlockHash(hash string) ([32]byte, error) {
	var result [32]byte
	raw, err := hex.DecodeString(hash)
	if err != nil || len(raw) != 32 {
		return result, fmt.Errorf("block hash must be 32 bytes")
	}
	copy(result[:], raw)
	return result, nil
}
