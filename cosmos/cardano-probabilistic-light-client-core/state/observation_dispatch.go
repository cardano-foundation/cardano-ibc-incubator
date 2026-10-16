package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

// The SDK executes VerifyClientMessage and UpdateState in the same transaction
// cache. Bounded operations do their work once in that cache. UpdateState only
// consumes the matching result. CheckTx never supplies DeliverTx's result.
type operationResult struct {
	Digest     [32]byte
	HostHeight int64
	HostTime   int64
	Heights    []*Height
}

var operationResultKey = []byte("boundedOperationResult")

func operationDigest(header *ProbabilisticHeader) ([32]byte, error) {
	raw, err := cbor.Encode(header.ObservationChunk)
	if err != nil {
		return [32]byte{}, err
	}
	if len(raw) > MaxOperationSignedBytes-20000 {
		return [32]byte{}, fmt.Errorf("bounded message exceeds the transport allowance")
	}
	return sha256.Sum256(raw), nil
}
func (cs *ClientState) verifyObservationOperation(ctx Context, cdc StateCodec, private storetypes.KVStore, header *ProbabilisticHeader) error {
	if header == nil || header.ObservationChunk == nil {
		return fmt.Errorf("clients require a bounded observation operation")
	}
	if err := header.ValidateBasic(); err != nil {
		return err
	}
	if cs.BootstrapPending && (header.ObservationChunk.Operation < ObservationBootstrapImport) {
		return fmt.Errorf("trusted bootstrap import has not completed")
	}
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return ErrIBCClientFrozen
	}
	digest, err := operationDigest(header)
	if err != nil {
		return err
	}
	shared, err := ctx.snapshotStore()
	if err != nil {
		return err
	}
	before := uint64(0)
	if ctx.GasConsumed != nil {
		before = ctx.GasConsumed()
	}
	chunk := header.ObservationChunk
	var heights []HeightValue
	if chunk.Operation >= ObservationBootstrapImport {
		if err := cs.continueBootstrap(ctx, cdc, private, shared, chunk, digest); err != nil {
			return err
		}
	} else if chunk.Operation == ObservationBegin {
		id, err := beginObservation(ctx, shared, private, cs, chunk)
		if err != nil {
			return err
		}
		ctx.emitEvent("probabilistic_observation_started", newEventAttribute("session_id", fmt.Sprintf("%x", id)))
	} else if chunk.Operation == ObservationCleanup {
		if err := cs.ContinueMaintenance(ctx, cdc, private, ObservationCleanup); err != nil {
			return err
		}
	} else {
		session, err := loadObservationSession(shared, cs, chunk.SessionId)
		if err != nil {
			return err
		}
		stepDigest := digest
		if chunk.Operation == ObservationAppendStake || chunk.Operation == ObservationAppendBlocks {
			stepDigest, err = observationSegmentCommitment(chunk, session.AnchorHeight)
			if err != nil {
				return err
			}
		}
		if chunk.Sequence == session.Sequence && stepDigest == session.LastStepDigest {
			// An exact retry is a no-op. It cannot renew an expiry or response deadline.
		} else {
			if session.Sequence == ^uint32(0) || chunk.Sequence != session.Sequence+1 || chunk.Sequence > MaxObservationSteps {
				return fmt.Errorf("observation chunk is reordered or does not match the last accepted step")
			}
			now := ctx.BlockTime().UnixNano()
			if now <= 0 || (chunk.Operation != ObservationDiscard && uint64(now) >= session.ExpiresAt) {
				return fmt.Errorf("observation session has expired")
			}
			if chunk.Operation == ObservationDiscard && uint64(now) < session.ExpiresAt {
				// Public sessions have no signer owner. Cancellation must not
				// erase another relayer's progress before the fixed expiry.
				return fmt.Errorf("a live observation cannot be discarded by another submitter")
			}
			if (chunk.Operation == ObservationAppendStake || chunk.Operation == ObservationAppendBlocks) && stepDigest != session.InputDigest {
				return fmt.Errorf("evidence segment does not match the committed transcript")
			}
			switch chunk.Operation {
			case ObservationAppendStake:
				err = appendObservationStake(shared, session, chunk.StakeRows)
				// A sealed table must not contradict a distribution Mithril
				// has certified, or no receipt can use it.
				if err == nil && session.TableMithrilRoot != "" {
					_, err = requireCertifiedStake(private, cs.VerificationGeneration, session.Table.Epoch, session.TableMithrilRoot)
				}
			case ObservationAdvanceCredit:
				err = advanceObservationCredit(shared, session)
			case ObservationAppendBlocks:
				err = appendObservationBlocks(ctx, shared, cs, session, chunk.Blocks)
			case ObservationContinueBody:
				err = continueObservationBody(ctx, shared, cs, session)
			case ObservationComplete:
				var receipt [32]byte
				receipt, err = completeObservation(ctx, shared, cs, session)
				if err == nil {
					ctx.emitEvent("probabilistic_observation_verified", newEventAttribute("session_id", fmt.Sprintf("%x", chunk.SessionId)), newEventAttribute("receipt_id", fmt.Sprintf("%x", receipt)))
				}
			case ObservationActivate:
				heights, err = activateVerifiedObservation(ctx, shared, private, cdc, cs, session)
			case ObservationDiscard:
				err = releaseObservationSession(shared, cs, chunk.SessionId, session)
				if err == nil {
					shared.Delete(observationSessionKey(cs.StorageNamespace, cs.VerificationGeneration, chunk.SessionId))
					shared.Delete(retentionKey(cs, 1, chunk.SessionId))
				}
			default:
				err = fmt.Errorf("invalid observation phase")
			}
			if err != nil {
				return err
			}
			if chunk.Operation == ObservationAppendStake || chunk.Operation == ObservationAppendBlocks {
				copy(session.InputDigest[:], chunk.EvidenceDigest)
			}
			if chunk.Operation != ObservationDiscard {
				session.Sequence = chunk.Sequence
				session.LastStepDigest = stepDigest
				if err = pinObservationSession(shared, cs, chunk.SessionId, session); err != nil {
					return err
				}
				if err = saveObservationSession(shared, cs, chunk.SessionId, session); err != nil {
					return err
				}
			}
		}
	}
	result := operationResult{Digest: digest, HostHeight: ctx.Height, HostTime: ctx.BlockTime().UnixNano()}
	for _, h := range heights {
		result.Heights = append(result.Heights, NewHeight(h.GetRevisionNumber(), h.GetRevisionHeight()))
	}
	raw, err := cbor.Encode(result)
	if err != nil {
		return err
	}
	private.Set(operationResultKey, raw)
	if ctx.GasConsumed != nil && ctx.GasConsumed()-before > MaxVerificationWorkGas {
		return fmt.Errorf("bounded verification operation exceeded its metered gas envelope")
	}
	return nil
}
func (cs *ClientState) consumeObservationResult(ctx Context, cdc StateCodec, private storetypes.KVStore, header *ProbabilisticHeader) []HeightValue {
	digest, err := operationDigest(header)
	if err != nil {
		panic(err)
	}
	raw := private.Get(operationResultKey)
	var result operationResult
	if len(raw) == 0 || len(raw) > 4096 {
		panic("bounded operation was not verified in this execution")
	}
	if _, err := cbor.Decode(raw, &result); err != nil {
		panic(err)
	}
	if result.Digest != digest || result.HostHeight != ctx.Height || result.HostTime != ctx.BlockTime().UnixNano() {
		panic("bounded operation result belongs to a different execution")
	}
	private.Delete(operationResultKey)
	fresh, found := GetClientState(private, cdc)
	if !found || fresh.StorageVersion != StorageVersion || !bytes.Equal(fresh.StorageNamespace, cs.StorageNamespace) {
		panic("bounded client disappeared during execution")
	}
	*cs = *fresh
	heights := make([]HeightValue, len(result.Heights))
	for i, h := range result.Heights {
		heights[i] = h
	}
	return heights
}
func pinObservationSession(store storetypes.KVStore, cs *ClientState, id []byte, session *observationSession) error {
	owner := namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 4, id)
	if err := pinVerificationCheckpoint(store, &session.Working, append(bytes.Clone(owner), 1)); err != nil {
		return err
	}
	if session.Anchor != nil {
		if err := pinVerificationCheckpoint(store, session.Anchor, append(bytes.Clone(owner), 2)); err != nil {
			return err
		}
	}
	for _, pin := range []struct {
		Kind, Role byte
		Root       SnapshotRoot
	}{{snapshotStake, 3, session.Table.Root}, {snapshotCredit, 4, session.NextCredit}, {snapshotQualified, 5, session.Qualified}} {
		if err := NewSnapshotMap(store, session.Working.Scope, pin.Kind).Pin(append(bytes.Clone(owner), pin.Role), pin.Root); err != nil {
			return err
		}
	}
	return pinSnapshotObject(store, session.Working.Scope, objectBody, optionalDigest(session.PendingBody), append(bytes.Clone(owner), 6))
}
func releaseObservationSession(store storetypes.KVStore, cs *ClientState, id []byte, session *observationSession) error {
	empty := verificationCheckpoint{Scope: session.Working.Scope}
	for _, owner := range [][]byte{namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 2, id), append(namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 4, id), 1), append(namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 4, id), 2)} {
		if err := pinVerificationCheckpoint(store, &empty, owner); err != nil {
			return err
		}
	}
	owner := namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 4, id)
	for _, pin := range []struct{ Kind, Role byte }{{snapshotStake, 3}, {snapshotCredit, 4}, {snapshotQualified, 5}} {
		if err := NewSnapshotMap(store, session.Working.Scope, pin.Kind).Pin(append(bytes.Clone(owner), pin.Role), SnapshotRoot{}); err != nil {
			return err
		}
	}
	return pinSnapshotObject(store, session.Working.Scope, objectBody, [32]byte{}, append(bytes.Clone(owner), 6))
}
func (cs *ClientState) verifiedReceiptConflict(ctx Context, clientStore storetypes.KVStore, msg *Misbehaviour) (bool, error) {
	if msg == nil || len(msg.VerifiedObservation_1) != 32 || len(msg.VerifiedObservation_2) != 32 || msg.ProbabilisticHeader1 != nil || msg.ProbabilisticHeader2 != nil {
		return false, fmt.Errorf("misbehaviour requires two verified receipt references")
	}
	shared, err := ctx.snapshotStore()
	if err != nil {
		return false, err
	}
	first, err := loadVerifiedObservation(shared, cs, msg.VerifiedObservation_1)
	if err != nil {
		return false, err
	}
	second, err := loadVerifiedObservation(shared, cs, msg.VerifiedObservation_2)
	if err != nil {
		return false, err
	}
	for _, receipt := range []*verifiedObservation{first, second} {
		if err := requireReceiptStake(clientStore, cs.VerificationGeneration, receipt); err != nil {
			return false, errorsmod.Wrap(ErrIBCInvalidMisbehaviour, err.Error())
		}
	}
	return verifiedObservationsConflict(shared, first, second)
}

func pinPacketContents(store storetypes.KVStore, scope, ref [32]byte, owner []byte) error {
	packet := &packetCheckpoint{}
	var err error
	if ref != [32]byte{} {
		packet, err = loadPacketCheckpoint(store, scope, ref)
		if err != nil {
			return err
		}
	}
	for _, pin := range []struct {
		Kind, Role byte
		Root       SnapshotRoot
	}{{snapshotPacketLanes, 20, packet.Lanes}, {snapshotPacketInputs, 21, packet.Inputs}, {snapshotPacketRoutes, 22, packet.Routes}} {
		if err := NewSnapshotMap(store, scope, pin.Kind).Pin(append(bytes.Clone(owner), pin.Role), pin.Root); err != nil {
			return err
		}
	}
	return nil
}
func encodeGeneration(value uint64) []byte { return binary.BigEndian.AppendUint64(nil, value) }

func optionalDigest(raw []byte) [32]byte {
	if len(raw) == 0 {
		return [32]byte{}
	}
	return [32]byte(raw)
}
