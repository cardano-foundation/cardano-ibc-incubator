package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"

	storetypes "cosmossdk.io/store/types"
)

func (ctx Context) snapshotStore() (storetypes.KVStore, error) {
	if ctx.Snapshots == nil {
		return nil, fmt.Errorf("the application has not enabled authenticated shared snapshot storage")
	}
	return ctx.Snapshots()
}
func namespaceKey(namespace []byte) []byte {
	return append([]byte("snapshots/v2/clients/"), namespace...)
}
func namespaceOwner(namespace []byte, generation uint64, role OwnerKind, id []byte) []byte {
	raw := binary.BigEndian.AppendUint64(bytes.Clone(namespace), generation)
	raw = append(raw, byte(role))
	return append(raw, id...)
}
func generationKey() []byte { return []byte("verificationGeneration") }
func ownedCheckpointKey(generation, height uint64) []byte {
	return binary.BigEndian.AppendUint64(binary.BigEndian.AppendUint64([]byte("verifiedCheckpoints/"), generation), height)
}
func validateClientState(cs *ClientState) error {
	if cs.StorageVersion != StorageVersion || cs.VerificationGeneration == 0 || len(cs.CheckpointReference) != 32 || len(cs.StorageNamespace) != 32 {
		return fmt.Errorf("client requires a version, generation, namespace and checkpoint")
	}
	if len(cs.BootstrapObjects) > MaxOperationSignedBytes {
		return fmt.Errorf("bootstrap objects exceed the bounded transport envelope")
	}
	if err := cs.validateMithrilAnchor(); err != nil {
		return err
	}
	if len(cs.EpochStakeDistribution) > 0 || len(cs.EpochContexts) > 0 || cs.LatestCheckpointPoolRegistry != nil || cs.LatestCheckpointSettlementCredit != nil || cs.LatestCheckpointPoolProduction != nil || len(cs.LatestCheckpointOperationalCertificateCounters) > 0 {
		return fmt.Errorf("public client state cannot embed verification collections")
	}
	if cs.LatestHeight == nil || cs.LatestCheckpointHeight == nil || cs.LatestHeight.IsZero() || cs.LatestCheckpointHeight.IsZero() || cs.ChainId == "" || cs.TrustingPeriod <= 0 || cs.MaxClockDrift <= 0 {
		return fmt.Errorf("client configuration and cursors must be complete")
	}
	if len(cs.ChainId) > 50 || len(cs.HostStateNftPolicyId) != 28 || len(cs.PacketLanePolicyId) != 28 || len(cs.HostStateNftTokenName) == 0 || len(cs.HostStateNftTokenName) > 32 || cs.SlotLengthNs == 0 || cs.SystemStartUnixNs == 0 || cs.SlotsPerKesPeriod == 0 || cs.MaxKesEvolutions == 0 || cs.MaxKesEvolutions > maxSupportedKesEvolutions || cs.ActiveSlotCoefficientNumerator == 0 || cs.ActiveSlotCoefficientDenominator == 0 || cs.ActiveSlotCoefficientNumerator > cs.ActiveSlotCoefficientDenominator {
		return fmt.Errorf("client has invalid immutable network rules")
	}
	if cs.LatestHeight.RevisionNumber != 0 || cs.LatestCheckpointHeight.RevisionNumber != 0 || cs.LatestCheckpointHeight.LT(cs.LatestHeight) || cs.CurrentEpoch != cs.LatestCheckpointEpoch {
		return fmt.Errorf("client checkpoint position is invalid")
	}
	if _, err := decodeBlockHash(cs.LatestCheckpointBlockHash); err != nil {
		return err
	}
	derived, err := cs.DeriveTimestampFromSlot(cs.LatestCheckpointSlot)
	if err != nil || derived != cs.LatestCheckpointTimestamp {
		return fmt.Errorf("checkpoint timestamp is not derived from its slot")
	}
	if err := cs.validateNonceConfiguration(); err != nil {
		return err
	}
	if _, err := verificationScope(cs); err != nil {
		return err
	}
	return nil
}
func validateConsensusState(cs *ConsensusState) error {
	if cs.VerificationGeneration == 0 || len(cs.CheckpointReference) != 32 || len(cs.PacketStateReference) != 32 || cs.Timestamp == 0 || len(cs.IbcStateRoot) != 32 {
		return fmt.Errorf("consensus state requires bounded authenticated references")
	}
	if _, err := decodeBlockHash(cs.AcceptedBlockHash); err != nil {
		return err
	}
	if cs.PoolRegistry != nil || cs.SettlementCredit != nil || cs.PoolProduction != nil || cs.NonceState != nil || len(cs.PacketStateSnapshot) > 0 {
		return fmt.Errorf("consensus state cannot embed historical verification state")
	}
	return nil
}
func writeClientState(ctx Context, cdc StateCodec, private storetypes.KVStore, cs *ClientState) error {
	if err := validateClientState(cs); err != nil {
		return err
	}
	raw := cdc.EncodeClient(cs)
	if len(raw) > MaxClientBytes {
		return fmt.Errorf("public client record exceeds %d bytes", MaxClientBytes)
	}
	shared, err := ctx.snapshotStore()
	if err != nil {
		return err
	}
	private.Set([]byte("clientState"), raw)
	private.Set(generationKey(), binary.BigEndian.AppendUint64(nil, cs.VerificationGeneration))
	shared.Set(namespaceKey(cs.StorageNamespace), raw)
	for _, challenge := range cs.EpochContextChallenges {
		value := binary.BigEndian.AppendUint64(nil, challenge.UsableAfterUnixNs)
		key := proofEpochDeadlineKey(cs, challenge.Epoch)
		if existing := shared.Get(key); len(existing) > 0 && !bytes.Equal(existing, value) {
			return fmt.Errorf("an installed proof deadline is immutable within a generation")
		} else if len(existing) == 0 {
			shared.Set(key, value)
		}
	}
	return nil
}
func currentVerificationCheckpoint(ctx Context, cs *ClientState) (*verificationCheckpoint, storetypes.KVStore, error) {
	store, err := ctx.snapshotStore()
	if err != nil {
		return nil, nil, err
	}
	scope, err := verificationScope(cs)
	if err != nil {
		return nil, nil, err
	}
	checkpoint, err := loadVerificationCheckpoint(store, scope, cs.CheckpointReference)
	if err != nil {
		return nil, nil, err
	}
	if checkpoint.Height != cs.LatestCheckpointHeight.RevisionHeight || checkpoint.Epoch != cs.CurrentEpoch || checkpoint.Slot != cs.LatestCheckpointSlot || checkpoint.Timestamp != cs.LatestCheckpointTimestamp {
		return nil, nil, fmt.Errorf("public cursor disagrees with its immutable checkpoint")
	}
	if !praosNonceStatesEqual(checkpoint.Nonce, cs.LatestCheckpointNonceState) {
		return nil, nil, fmt.Errorf("public nonce disagrees with its immutable checkpoint")
	}
	return checkpoint, store, nil
}

// InitializeFromTrustedCheckpoint is called by the bootstrap builder with explicit trusted
// starting data. It never constructs missing nonce, registration or production
// history. Pages are destination objects and can be shared by other checkpoints.
// As at runtime, the stake table must match the Mithril certificate.
func InitializeFromTrustedCheckpoint(ctx Context, cdc StateCodec, private storetypes.KVStore, client *ClientState, consensus *ConsensusState, mithrilCertificate []byte) (*ClientState, *ConsensusState, error) {
	if err := client.requireBootstrapAnchor(); err != nil {
		return nil, nil, err
	}
	store, err := ctx.snapshotStore()
	if err != nil {
		return nil, nil, err
	}
	checkpoint, err := buildTrustedCheckpoint(store, client, consensus)
	if err != nil {
		return nil, nil, err
	}
	reference, err := saveVerificationCheckpoint(store, checkpoint)
	if err != nil {
		return nil, nil, err
	}
	sequenceRaw := store.Get([]byte("snapshots/v2/nextNamespace"))
	var sequence uint64
	if len(sequenceRaw) > 0 {
		if len(sequenceRaw) != 8 {
			return nil, nil, fmt.Errorf("invalid snapshot namespace sequence")
		}
		sequence = binary.BigEndian.Uint64(sequenceRaw)
	}
	if sequence == ^uint64(0) {
		return nil, nil, fmt.Errorf("snapshot namespace sequence overflow")
	}
	sequence++
	namespace := sha256.Sum256(binary.BigEndian.AppendUint64(append([]byte("cardano-ibc.namespace/v2\x00"), checkpoint.Scope[:]...), sequence))
	store.Set([]byte("snapshots/v2/nextNamespace"), binary.BigEndian.AppendUint64(nil, sequence))
	thin := referenceClientState(client, namespace[:], checkpoint, reference)
	if err := thin.certifyBootstrapStake(ctx, private, store, checkpoint.Scope, checkpoint.Stake.Root, mithrilCertificate); err != nil {
		return nil, nil, err
	}
	if err := pinVerificationCheckpoint(store, checkpoint, namespaceOwner(thin.StorageNamespace, thin.VerificationGeneration, OwnerCurrentCheckpoint, nil)); err != nil {
		return nil, nil, err
	}
	private.Set(ownedCheckpointKey(thin.VerificationGeneration, checkpoint.Height), reference[:])
	if err := retainCheckpoint(store, thin, checkpoint, reference[:]); err != nil {
		return nil, nil, err
	}
	if err := writeClientState(ctx, cdc, private, thin); err != nil {
		return nil, nil, err
	}
	compactConsensus := referenceConsensusState(consensus, checkpoint, reference, thin.VerificationGeneration)
	encoded := cdc.EncodeConsensus(compactConsensus)
	if len(encoded) > MaxConsensusBytes {
		return nil, nil, fmt.Errorf("public consensus record exceeds %d bytes", MaxConsensusBytes)
	}
	SetConsensusState(private, cdc, compactConsensus, client.LatestHeight)
	setConsensusMetadata(ctx, private, client.LatestHeight)
	return thin, compactConsensus, nil
}
func (cs *ClientState) resetEpochDeadline(ctx Context, epoch uint64) error {
	// Recovery adopts an already usable trusted substitute. It does not submit
	// an uncertified stake distribution or start a new stake response window.
	now := ctx.BlockTime().UnixNano()
	if now <= 0 {
		return fmt.Errorf("recovery needs a positive block time")
	}
	deadline := uint64(now)
	cs.EpochContextChallenges = []*EpochContextChallenge{{Epoch: epoch, UsableAfterUnixNs: deadline}}
	return nil
}

func proofEpochDeadlineKey(cs *ClientState, epoch uint64) []byte {
	return binary.BigEndian.AppendUint64(binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/proofDeadlines/"), cs.StorageNamespace...), cs.VerificationGeneration), epoch)
}
