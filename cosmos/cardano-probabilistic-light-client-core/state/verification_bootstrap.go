package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/big"
	"sort"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func verificationScope(cs *ClientState) ([32]byte, error) {
	length := cs.CurrentEpochEndSlotExclusive - cs.CurrentEpochStartSlot
	if length == 0 {
		return [32]byte{}, fmt.Errorf("epoch schedule has no length")
	}
	offset := new(big.Int).Sub(new(big.Int).SetUint64(cs.CurrentEpochStartSlot), new(big.Int).Mul(new(big.Int).SetUint64(length), new(big.Int).SetUint64(cs.CurrentEpoch)))
	configuration := struct {
		Version                                                                                                      uint32
		Chain                                                                                                        string
		Start, SlotLength, EpochLength, KESPeriods, KESEvolutions, Stabilisation, ActiveNumerator, ActiveDenominator uint64
		EpochOffset                                                                                                  string
		HostPolicy, HostName, LanePolicy                                                                             []byte
		ClockDrift                                                                                                   int64
	}{VerificationPolicyVersion, cs.ChainId, cs.SystemStartUnixNs, cs.SlotLengthNs, length, cs.SlotsPerKesPeriod, cs.MaxKesEvolutions, cs.RandomnessStabilisationWindowSlots, cs.ActiveSlotCoefficientNumerator, cs.ActiveSlotCoefficientDenominator, offset.String(), cs.HostStateNftPolicyId, cs.HostStateNftTokenName, cs.PacketLanePolicyId, int64(cs.MaxClockDrift)}
	raw, err := cbor.Encode(configuration)
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(append([]byte("cardano-ibc.verification-context/v2\x00"), raw...)), nil
}
func orderedSnapshotChanges(changes []SnapshotChange) ([]SnapshotChange, error) {
	sort.Slice(changes, func(i, j int) bool { return bytes.Compare(changes[i].Key, changes[j].Key) < 0 })
	for i := 1; i < len(changes); i++ {
		if bytes.Equal(changes[i-1].Key, changes[i].Key) {
			return nil, fmt.Errorf("duplicate binary pool identifier")
		}
	}
	return changes, nil
}
func buildTrustedCheckpoint(store storetypes.KVStore, cs *ClientState, consensus *ConsensusState) (*verificationCheckpoint, error) {
	if err := validateBootstrapInput(*cs); err != nil {
		return nil, err
	}
	if err := validateBootstrapConsensus(*consensus); err != nil {
		return nil, err
	}
	if err := validateConsensusPacketSnapshot(consensus, cs.LatestHeight.RevisionHeight); err != nil {
		return nil, err
	}
	if consensus.AcceptedEpoch != cs.CurrentEpoch || consensus.Timestamp != cs.LatestCheckpointTimestamp || consensus.AcceptedBlockHash != cs.LatestCheckpointBlockHash ||
		!praosNonceStatesEqual(consensus.NonceState, cs.LatestCheckpointNonceState) || !poolRegistriesEqual(consensus.PoolRegistry, cs.LatestCheckpointPoolRegistry) ||
		!settlementCreditsEqual(consensus.SettlementCredit, cs.LatestCheckpointSettlementCredit) || !poolProductionsEqual(consensus.PoolProduction, cs.LatestCheckpointPoolProduction) {
		return nil, fmt.Errorf("trusted bootstrap client and consensus verification state disagree")
	}
	scope, err := verificationScope(cs)
	if err != nil {
		return nil, err
	}
	checkpoint := &verificationCheckpoint{Version: VerificationPolicyVersion, Scope: scope, Height: cs.LatestCheckpointHeight.RevisionHeight, Slot: cs.LatestCheckpointSlot, Epoch: cs.CurrentEpoch, Timestamp: cs.LatestCheckpointTimestamp, Nonce: clonePraosNonceState(cs.LatestCheckpointNonceState)}
	checkpoint.BlockHash, err = decodeBlockHash(cs.LatestCheckpointBlockHash)
	if err != nil {
		return nil, err
	}
	if checkpoint.Height != cs.LatestHeight.RevisionHeight {
		return nil, fmt.Errorf("new bootstrap requires a proof-bearing checkpoint")
	}
	build := func(kind byte, changes []SnapshotChange) (SnapshotRoot, error) {
		changes, err = orderedSnapshotChanges(changes)
		if err != nil {
			return SnapshotRoot{}, err
		}
		return NewSnapshotMap(store, scope, kind).PutBatch(SnapshotRoot{}, changes)
	}
	var changes []SnapshotChange
	for _, r := range cs.LatestCheckpointPoolRegistry.Pools {
		key, err := poolKey(r.Registration.PoolId)
		if err != nil {
			return nil, err
		}
		record := storedRegistration{Epoch: cs.CurrentEpoch, FirstSlot: r.Registration.FirstRegistrationSlot, Registered: r.Registered, PendingVRF: bytes.Clone(r.PendingVrfKeyHash), PendingEpoch: r.PendingEffectiveEpoch, RetirementEpoch: r.RetirementEpoch}
		copy(record.VRF[:], r.Registration.VrfKeyHash)
		value, err := encodeRegistration(record)
		if err != nil {
			return nil, err
		}
		changes = append(changes, SnapshotChange{key, value})
	}
	checkpoint.Registry.Records, err = build(snapshotRegistry, changes)
	if err != nil {
		return nil, err
	}
	checkpoint.Registry.Epoch = cs.CurrentEpoch
	bindings := func(entries []*PoolRegistrationBinding) (registryProjection, error) {
		changes := []SnapshotChange{}
		for _, r := range entries {
			key, err := poolKey(r.PoolId)
			if err != nil {
				return registryProjection{}, err
			}
			value := binary.BigEndian.AppendUint64(bytes.Clone(r.VrfKeyHash), r.FirstRegistrationSlot)
			changes = append(changes, SnapshotChange{key, value})
		}
		root, err := build(snapshotBindings, changes)
		return registryProjection{Root: root, Epoch: cs.CurrentEpoch, Bindings: true}, err
	}
	checkpoint.Registry.Mark, err = bindings(cs.LatestCheckpointPoolRegistry.Mark)
	if err != nil {
		return nil, err
	}
	checkpoint.Registry.Effective, err = bindings(cs.LatestCheckpointPoolRegistry.Effective)
	if err != nil {
		return nil, err
	}
	changes = nil
	for _, entry := range cs.EpochStakeDistribution {
		key, err := poolKey(entry.PoolId)
		if err != nil {
			return nil, err
		}
		if entry.Stake == 0 {
			return nil, fmt.Errorf("canonical stake rows require positive amounts")
		}
		var ok bool
		checkpoint.Stake.Total, ok = checkedAddStake(checkpoint.Stake.Total, entry.Stake)
		if !ok {
			return nil, fmt.Errorf("bootstrap stake total overflow")
		}
		changes = append(changes, SnapshotChange{key, binary.BigEndian.AppendUint64(nil, entry.Stake)})
	}
	checkpoint.Stake.Root, err = build(snapshotStake, changes)
	if err != nil {
		return nil, err
	}
	checkpoint.Stake.Epoch = cs.CurrentEpoch
	changes = nil
	for _, r := range cs.LatestCheckpointSettlementCredit.Reference {
		key, err := poolKey(r.PoolId)
		if err != nil {
			return nil, err
		}
		credit := new(big.Rat).SetFrac(new(big.Int).SetBytes(r.Numerator), new(big.Int).SetBytes(r.Denominator))
		value, err := encodeCredit(credit)
		if err != nil {
			return nil, err
		}
		changes = append(changes, SnapshotChange{key, value})
	}
	checkpoint.Credit, err = build(snapshotCredit, changes)
	if err != nil {
		return nil, err
	}
	changes = nil
	for _, r := range cs.LatestCheckpointPoolProduction.Pools {
		key, err := poolKey(r.PoolId)
		if err != nil {
			return nil, err
		}
		changes = append(changes, SnapshotChange{key, encodeProduction(cs.CurrentEpoch, r)})
	}
	checkpoint.Production, err = build(snapshotProduction, changes)
	if err != nil {
		return nil, err
	}
	changes = nil
	for _, r := range cs.LatestCheckpointOperationalCertificateCounters {
		changes = append(changes, SnapshotChange{bytes.Clone(r.PoolId), binary.BigEndian.AppendUint64(nil, r.SequenceNumber)})
	}
	checkpoint.Counters, err = build(snapshotCounters, changes)
	if err != nil {
		return nil, err
	}
	checkpoint.SettledHistory, err = build(snapshotSettledHistory, []SnapshotChange{{binary.BigEndian.AppendUint64(nil, checkpoint.Height), checkpoint.BlockHash[:]}})
	if err != nil {
		return nil, err
	}
	packet, err := core.DecodePacketStateSnapshot(consensus.PacketStateSnapshot)
	if err != nil {
		return nil, err
	}
	copy(checkpoint.HostRoot[:], packet.HostRoot)
	checkpoint.PacketReference, err = createPacketCheckpoint(store, scope, packet)
	if err != nil {
		return nil, err
	}
	return checkpoint, nil
}
func packetObjectKey(scope, hash [32]byte) []byte {
	return append(append([]byte("snapshots/v2/packets/"), scope[:]...), hash[:]...)
}
func savePacketObject(store storetypes.KVStore, scope [32]byte, raw []byte) ([32]byte, error) {
	if len(raw) == 0 || len(raw) > SnapshotPageBytes {
		return [32]byte{}, fmt.Errorf("packet snapshot requires bounded record storage")
	}
	hash := sha256.Sum256(append(append([]byte("cardano-ibc.packet-snapshot/v2\x00"), scope[:]...), raw...))
	key := packetObjectKey(scope, hash)
	old := store.Get(key)
	if len(old) > 0 && !bytes.Equal(old, raw) {
		return [32]byte{}, fmt.Errorf("immutable packet snapshot collision")
	}
	if len(old) == 0 {
		store.Set(key, raw)
	}
	if err := registerSnapshotObject(store, scope, objectPacket, hash, key); err != nil {
		return [32]byte{}, err
	}
	return hash, nil
}
func loadPacketObject(store storetypes.KVStore, scope, hash [32]byte) ([]byte, error) {
	raw := store.Get(packetObjectKey(scope, hash))
	expected := sha256.Sum256(append(append([]byte("cardano-ibc.packet-snapshot/v2\x00"), scope[:]...), raw...))
	if len(raw) == 0 || len(raw) > SnapshotPageBytes || expected != hash {
		return nil, fmt.Errorf("packet snapshot is missing or has an invalid context hash")
	}
	return raw, nil
}

func referenceClientState(cs *ClientState, namespace []byte, checkpoint *verificationCheckpoint, reference [32]byte) *ClientState {
	thin := *cs
	thin.StorageVersion = StorageVersion
	thin.VerificationGeneration = 1
	thin.StorageNamespace = bytes.Clone(namespace)
	thin.CheckpointReference = bytes.Clone(reference[:])
	thin.BootstrapObjects = nil
	thin.BootstrapPending = false
	thin.EpochStakeDistribution = nil
	thin.EpochContexts = nil
	thin.LatestCheckpointPoolRegistry = nil
	thin.LatestCheckpointSettlementCredit = nil
	thin.LatestCheckpointPoolProduction = nil
	thin.LatestCheckpointOperationalCertificateCounters = nil
	thin.LatestCheckpointNonceState = clonePraosNonceState(checkpoint.Nonce)
	return &thin
}
func referenceConsensusState(consensus *ConsensusState, checkpoint *verificationCheckpoint, reference [32]byte, generation uint64) *ConsensusState {
	thin := *consensus
	thin.VerificationGeneration = generation
	thin.CheckpointReference = bytes.Clone(reference[:])
	thin.PacketStateReference = bytes.Clone(checkpoint.PacketReference[:])
	thin.NonceState = nil
	thin.PoolRegistry = nil
	thin.SettlementCredit = nil
	thin.PoolProduction = nil
	thin.PacketStateSnapshot = nil
	return &thin
}

func pinCheckpointContents(store storetypes.KVStore, checkpoint *verificationCheckpoint, owner []byte) error {
	type pin struct {
		kind byte
		role byte
		root SnapshotRoot
	}
	markKind, effectiveKind := snapshotRegistry, snapshotRegistry
	if checkpoint.Registry.Mark.Bindings {
		markKind = snapshotBindings
	}
	if checkpoint.Registry.Effective.Bindings {
		effectiveKind = snapshotBindings
	}
	for _, entry := range []pin{{snapshotRegistry, 1, checkpoint.Registry.Records}, {snapshotRegistry, 2, SnapshotRoot{}}, {snapshotBindings, 2, SnapshotRoot{}}, {snapshotRegistry, 3, SnapshotRoot{}}, {snapshotBindings, 3, SnapshotRoot{}}, {snapshotStake, 4, checkpoint.Stake.Root}, {snapshotCredit, 5, checkpoint.Credit}, {snapshotProduction, 6, checkpoint.Production}, {snapshotCounters, 7, checkpoint.Counters}, {snapshotSettledHistory, 8, checkpoint.SettledHistory}} {
		if entry.role == 2 && entry.kind == markKind {
			entry.root = checkpoint.Registry.Mark.Root
		}
		if entry.role == 3 && entry.kind == effectiveKind {
			entry.root = checkpoint.Registry.Effective.Root
		}
		if err := NewSnapshotMap(store, checkpoint.Scope, entry.kind).Pin(append(bytes.Clone(owner), entry.role), entry.root); err != nil {
			return err
		}
	}
	return pinSnapshotObject(store, checkpoint.Scope, objectPacket, checkpoint.PacketReference, append(bytes.Clone(owner), 23))
}

func pinVerificationCheckpoint(store storetypes.KVStore, checkpoint *verificationCheckpoint, owner []byte) error {
	var hash [32]byte
	if checkpoint.Height > 0 {
		raw, err := cbor.Encode(checkpoint)
		if err != nil {
			return err
		}
		candidate := checkpointDigest(checkpoint.Scope, raw)
		if store.Has(objectKey("objectMeta", checkpoint.Scope, objectCheckpoint, candidate)) {
			hash = candidate
		}
	}
	if err := pinSnapshotObject(store, checkpoint.Scope, objectCheckpoint, hash, append(bytes.Clone(owner), 24)); err != nil {
		return err
	}
	if hash != [32]byte{} {
		return pinCheckpointContents(store, &verificationCheckpoint{Scope: checkpoint.Scope}, owner)
	}
	return pinCheckpointContents(store, checkpoint, owner)
}
