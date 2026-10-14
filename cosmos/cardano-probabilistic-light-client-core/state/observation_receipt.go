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
)

type verifiedObservation struct {
	Version                           uint32
	Namespace                         []byte
	Generation                        uint64
	Scope                             [32]byte
	BaseReference                     []byte
	AnchorReference                   [32]byte
	AnchorHeight                      uint64
	AnchorHash                        [32]byte
	SettledHistory                    SnapshotRoot
	Table                             stakeSnapshot
	TableNonce                        []byte
	InputDigest                       [32]byte
	Blocks, Descendants               uint32
	QualifiedPools, QualifiedStakeBps uint64
	IsCheckpoint                      bool
	VerifiedAt, ActivatedAt, Deadline uint64
}

func verifiedObservationKey(namespace []byte, generation uint64, id []byte) []byte {
	return append(binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/receipts/"), namespace...), generation), id...)
}
func receiptDigest(raw []byte) [32]byte {
	return sha256.Sum256(append([]byte("cardano-ibc.verified-observation/v2\x00"), raw...))
}
func loadVerifiedObservation(store storetypes.KVStore, cs *ClientState, id []byte) (*verifiedObservation, error) {
	if len(id) != 32 {
		return nil, fmt.Errorf("verified observation id must be 32 bytes")
	}
	raw := store.Get(verifiedObservationKey(cs.StorageNamespace, cs.VerificationGeneration, id))
	if len(raw) == 0 || len(raw) > MaxCompactClientBytes || receiptDigest(raw) != [32]byte(id) {
		return nil, fmt.Errorf("verified observation is missing or has an invalid digest")
	}
	var receipt verifiedObservation
	if _, err := cbor.Decode(raw, &receipt); err != nil {
		return nil, err
	}
	scope, err := verificationScope(cs)
	if err != nil {
		return nil, err
	}
	if receipt.Version != VerificationPolicyVersion || receipt.Generation != cs.VerificationGeneration || !bytes.Equal(receipt.Namespace, cs.StorageNamespace) || receipt.Scope != scope || receipt.VerifiedAt == 0 {
		return nil, fmt.Errorf("receipt cannot be reused under a different client, generation or policy")
	}
	return &receipt, nil
}
func saveVerifiedObservation(store storetypes.KVStore, receipt *verifiedObservation) ([32]byte, error) {
	raw, err := cbor.Encode(receipt)
	if err != nil {
		return [32]byte{}, err
	}
	if len(raw) > MaxCompactClientBytes {
		return [32]byte{}, fmt.Errorf("receipt exceeds its metadata bound")
	}
	id := receiptDigest(raw)
	key := verifiedObservationKey(receipt.Namespace, receipt.Generation, id[:])
	old := store.Get(key)
	if len(old) > 0 && !bytes.Equal(old, raw) {
		return [32]byte{}, fmt.Errorf("immutable receipt collision")
	}
	if len(old) == 0 {
		store.Set(key, raw)
	}
	if err := registerSnapshotObject(store, receipt.Scope, objectReceipt, id, key); err != nil {
		return [32]byte{}, err
	}
	return id, nil
}

func completeObservation(ctx Context, store storetypes.KVStore, cs *ClientState, session *observationSession) ([32]byte, error) {
	if session.Complete {
		return [32]byte(session.Receipt), nil
	}
	if session.PendingBlock != nil || session.ProcessedBlocks != session.BlockCount || session.Anchor == nil || !session.CreditReady || session.RowsRead != session.TableRows || session.InputDigest != session.ExpectedDigest {
		return [32]byte{}, fmt.Errorf("observation has not completely verified the committed evidence")
	}
	if session.TableRows > 0 && session.Working.Epoch != session.TableEpoch {
		return [32]byte{}, fmt.Errorf("next epoch context requires verified evidence in that epoch")
	}
	descendants := uint64(session.Working.Height - session.Anchor.Height)
	if descendants < DefaultThresholdDepth || session.QualifiedCount < DefaultThresholdUniquePools {
		return [32]byte{}, fmt.Errorf("observation lacks sufficient qualified settlement descendants")
	}
	credit := new(big.Rat).SetFrac(new(big.Int).SetBytes(session.QualifiedNumerator), new(big.Int).SetBytes(session.QualifiedDenominator))
	bps := settlementCreditBps(credit)
	if bps < DefaultThresholdUniqueStakeBps {
		return [32]byte{}, fmt.Errorf("observation lacks sufficient capped qualified settlement stake")
	}
	anchorRef, err := saveVerificationCheckpoint(store, session.Anchor)
	if err != nil {
		return [32]byte{}, err
	}
	if session.TableRows != 0 && !bytes.Equal(session.TableNonce, session.Working.Nonce.EpochNonce) && session.Working.Epoch == session.TableEpoch {
		return [32]byte{}, fmt.Errorf("supplied next-epoch nonce disagrees with verified header evolution")
	}
	now := ctx.BlockTime().UnixNano()
	if now <= 0 {
		return [32]byte{}, fmt.Errorf("invalid receipt completion time")
	}
	receipt := &verifiedObservation{Version: VerificationPolicyVersion, Namespace: bytes.Clone(cs.StorageNamespace), Generation: cs.VerificationGeneration, Scope: session.Anchor.Scope, BaseReference: bytes.Clone(session.BaseReference), AnchorReference: anchorRef, AnchorHeight: session.Anchor.Height, AnchorHash: session.Anchor.BlockHash, SettledHistory: session.Anchor.SettledHistory, Table: session.Table, TableNonce: bytes.Clone(session.TableNonce), InputDigest: session.InputDigest, Blocks: session.BlockCount, Descendants: uint32(descendants), QualifiedPools: session.QualifiedCount, QualifiedStakeBps: bps, IsCheckpoint: session.IsCheckpoint, VerifiedAt: uint64(now)}
	id, err := saveVerifiedObservation(store, receipt)
	if err != nil {
		return [32]byte{}, err
	}
	if err := pinVerificationCheckpoint(store, session.Anchor, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 3, id[:])); err != nil {
		return [32]byte{}, err
	}
	if err := pinSnapshotObject(store, session.Anchor.Scope, objectReceipt, id, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 9, id[:])); err != nil {
		return [32]byte{}, err
	}
	if err := retainVerification(store, cs, 2, id[:], nil, receipt.AnchorHeight, retentionDeadline(cs, receipt.VerifiedAt)); err != nil {
		return [32]byte{}, err
	}
	session.Complete = true
	session.Receipt = bytes.Clone(id[:])
	return id, nil
}

// Only settled ancestry is compared. The receipt's map stops at its anchor.
// Temporary descendants and different unsigned allocations cannot freeze it.
func verifiedObservationsConflict(store storetypes.KVStore, a, b *verifiedObservation) (bool, error) {
	if a.Generation != b.Generation || a.Scope != b.Scope || a.Version != b.Version || !bytes.Equal(a.Namespace, b.Namespace) {
		return false, fmt.Errorf("receipt contexts cannot be compared")
	}
	if a.AnchorHeight == b.AnchorHeight {
		return a.AnchorHash != b.AnchorHash, nil
	}
	earlier, later := a, b
	if earlier.AnchorHeight > later.AnchorHeight {
		earlier, later = later, earlier
	}
	raw, found, err := NewSnapshotMap(store, later.Scope, snapshotSettledHistory).Lookup(later.SettledHistory, binary.BigEndian.AppendUint64(nil, earlier.AnchorHeight))
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}
	if len(raw) != 32 {
		return false, fmt.Errorf("invalid settled ancestry hash")
	}
	return !bytes.Equal(raw, earlier.AnchorHash[:]), nil
}

type activatedEpochTable struct {
	Table         stakeSnapshot
	Nonce         []byte
	Deadline      uint64
	Receipt       []byte
	BaseReference []byte
}

func activatedEpochKey(cs *ClientState, epoch uint64) []byte {
	return binary.BigEndian.AppendUint64(binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/epochs/"), cs.StorageNamespace...), cs.VerificationGeneration), epoch)
}
func activateVerifiedObservation(ctx Context, store, private storetypes.KVStore, cdc StateCodec, cs *ClientState, session *observationSession) ([]HeightValue, error) {
	if !session.Complete || session.Isolated || len(session.OriginalReceipt) != 0 {
		return nil, fmt.Errorf("only a completed forward observation can activate")
	}
	if err := cs.verifyEpochUsable(ctx, cs.CurrentEpoch); err != nil {
		return nil, err
	}
	if !bytes.Equal(session.BaseReference, cs.CheckpointReference) {
		return nil, fmt.Errorf("forward observation base became stale during staging")
	}
	receipt, err := loadVerifiedObservation(store, cs, session.Receipt)
	if err != nil {
		return nil, err
	}
	anchor, err := loadVerificationCheckpoint(store, receipt.Scope, receipt.AnchorReference[:])
	if err != nil {
		return nil, err
	}
	if receipt.Table.Root.Rows > 0 {
		key := activatedEpochKey(cs, receipt.Table.Epoch)
		raw := store.Get(key)
		if len(raw) == 0 {
			deadline, err := sharedSnapshotChallengeDeadline(ctx)
			if err != nil {
				return nil, err
			}
			receipt.ActivatedAt = uint64(ctx.BlockTime().UnixNano())
			receipt.Deadline = deadline
			accepted, err := saveVerifiedObservation(store, receipt)
			if err != nil {
				return nil, err
			}
			if err := pinSnapshotObject(store, receipt.Scope, objectReceipt, accepted, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 6, binary.BigEndian.AppendUint64(nil, receipt.Table.Epoch))); err != nil {
				return nil, err
			}
			proposal := activatedEpochTable{receipt.Table, bytes.Clone(receipt.TableNonce), deadline, bytes.Clone(accepted[:]), bytes.Clone(receipt.BaseReference)}
			raw, err = cbor.Encode(proposal)
			if err != nil {
				return nil, err
			}
			store.Set(key, raw)
			if err := retainVerification(store, cs, 4, binary.BigEndian.AppendUint64(nil, receipt.Table.Epoch), accepted[:], 0, retentionDeadline(cs, receipt.ActivatedAt)); err != nil {
				return nil, err
			}
			cs.EpochContextChallenges = append(cs.EpochContextChallenges, &EpochContextChallenge{Epoch: receipt.Table.Epoch, UsableAfterUnixNs: deadline})
			ctx.emitEvent("probabilistic_epoch_context_pending", newEventAttribute("epoch", fmt.Sprint(receipt.Table.Epoch)), newEventAttribute("usable_after_unix_ns", fmt.Sprint(deadline)), newEventAttribute("trusted_height", fmt.Sprintf("0-%d", session.Working.Height-uint64(session.BlockCount))), newEventAttribute("receipt_id", hex.EncodeToString(accepted[:])))
			if err := writeThinClient(ctx, cdc, private, cs); err != nil {
				return nil, err
			}
			// A proposal does not publish the root or advance the base checkpoint.
			return nil, nil
		}
		var proposal activatedEpochTable
		if _, err := cbor.Decode(raw, &proposal); err != nil {
			return nil, err
		}
		if proposal.Table != receipt.Table {
			return nil, fmt.Errorf("forward observation cannot replace an installed epoch allocation")
		}
		if uint64(ctx.BlockTime().UnixNano()) < proposal.Deadline {
			return nil, fmt.Errorf("epoch allocation is still inside its response window")
		}
	}
	if err := pinVerificationCheckpoint(store, anchor, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 1, nil)); err != nil {
		return nil, err
	}
	private.Set(ownedCheckpointKey(cs.VerificationGeneration, anchor.Height), receipt.AnchorReference[:])
	if err := retainCheckpoint(store, cs, anchor, receipt.AnchorReference[:]); err != nil {
		return nil, err
	}
	start, end, err := cs.epochSlotBounds(anchor.Epoch)
	if err != nil {
		return nil, err
	}
	// Historical deadlines remain in small indexed records. The public client
	// retains only its current and pending epoch deadlines.
	var deadlines []*EpochContextChallenge
	for _, deadline := range cs.EpochContextChallenges {
		if deadline.Epoch >= anchor.Epoch {
			deadlines = append(deadlines, deadline)
		}
	}
	cs.EpochContextChallenges = deadlines
	cs.CheckpointReference = bytes.Clone(receipt.AnchorReference[:])
	cs.CurrentEpoch = anchor.Epoch
	cs.LatestCheckpointNonceState = clonePraosNonceState(anchor.Nonce)
	cs.EpochNonce = bytes.Clone(anchor.Nonce.EpochNonce)
	cs.CurrentEpochStartSlot = start
	cs.CurrentEpochEndSlotExclusive = end
	cs.setLatestCheckpoint(NewHeight(0, anchor.Height), hex.EncodeToString(anchor.BlockHash[:]), anchor.Epoch, anchor.Slot, anchor.Timestamp)
	var heights []HeightValue
	if !receipt.IsCheckpoint {
		cs.LatestHeight = NewHeight(0, anchor.Height)
		consensus := &ConsensusState{Timestamp: anchor.Timestamp, IbcStateRoot: bytes.Clone(anchor.HostRoot[:]), AcceptedBlockHash: hex.EncodeToString(anchor.BlockHash[:]), AcceptedEpoch: anchor.Epoch, UniquePoolsCount: receipt.QualifiedPools, UniqueStakeBps: receipt.QualifiedStakeBps, SecurityScoreBps: cs.computeSecurityScore(uint64(receipt.Descendants), receipt.QualifiedPools, receipt.QualifiedStakeBps), VerificationGeneration: cs.VerificationGeneration, CheckpointReference: bytes.Clone(receipt.AnchorReference[:]), PacketStateReference: bytes.Clone(anchor.PacketReference[:])}
		if len(cdc.EncodeConsensus(consensus)) > MaxCompactConsensusBytes {
			return nil, fmt.Errorf("compact consensus exceeds its bounded record size")
		}
		SetConsensusState(private, cdc, consensus, cs.LatestHeight)
		setConsensusMetadata(ctx, private, cs.LatestHeight)
		heights = []HeightValue{NewHeight(0, anchor.Height)}
	}
	if err := writeThinClient(ctx, cdc, private, cs); err != nil {
		return nil, err
	}
	ctx.emitEvent("probabilistic_observation_activated", newEventAttribute("receipt_id", hex.EncodeToString(session.Receipt)), newEventAttribute("anchor_height", fmt.Sprint(anchor.Height)))
	return heights, nil
}
