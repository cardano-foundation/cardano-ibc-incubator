package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/big"
	"sort"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril"
)

const (
	ObservationBegin uint32 = iota + 1
	ObservationAppendStake
	ObservationAdvanceCredit
	ObservationAppendBlocks
	ObservationContinueBody
	ObservationComplete
	ObservationActivate
	ObservationDiscard
	ObservationCleanup
)
const maxObservationRowsPerStep = 128
const maxObservationBlocksPerStep = 4
const maxSessionBytes = 16 * 1024
const observationSessionLifetime = 24 * time.Hour

type observationSession struct {
	Version                                  uint32
	Namespace                                []byte
	Generation                               uint64
	BaseReference                            []byte
	OriginalReceipt                          []byte
	AnchorHeight                             uint64
	BlockCount                               uint32
	TableEpoch, TableTotal                   uint64
	TableRows                                uint32
	TableNonce                               []byte
	ExpectedDigest, ExpectedTableDigest      [32]byte
	InputDigest, TableDigest                 [32]byte
	Table                                    stakeSnapshot
	RowsRead                                 uint32
	TableMithril                             mithril.StakeRootBuilder
	TableMithrilRoot                         string
	CreditReady                              bool
	CreditCursor                             []byte
	CreditRows                               uint64
	NextCredit                               SnapshotRoot
	Working                                  verificationCheckpoint
	Anchor                                   *verificationCheckpoint
	ProcessedBlocks                          uint32
	PendingBody                              []byte
	PendingCertificate                       uint32
	PendingBlock                             *ProbabilisticBlock
	Qualified                                SnapshotRoot
	QualifiedCount                           uint64
	QualifiedNumerator, QualifiedDenominator []byte
	IsCheckpoint                             bool
	Isolated                                 bool
	HostTxHash                               string
	CreatedAt, ExpiresAt                     uint64
	Sequence                                 uint32
	LastStepDigest                           [32]byte
	Complete                                 bool
	Receipt                                  []byte
}

func (h ProbabilisticHeader) validateObservationChunk() error {
	chunk := h.ObservationChunk
	if chunk == nil || chunk.Operation < ObservationBegin || chunk.Operation > ObservationBootstrapComplete {
		return fmt.Errorf("unknown observation operation")
	}
	if h.AnchorBlock != nil || len(h.BridgeBlocks) > 0 || len(h.DescendantBlocks) > 0 || h.NewEpochContext != nil {
		return fmt.Errorf("bounded operations cannot carry logical observation fields")
	}
	if len(chunk.Blocks) > maxObservationBlocksPerStep || len(chunk.StakeRows) > maxObservationRowsPerStep*36 || len(chunk.Objects) > MaxOperationSignedBytes-20000 {
		return fmt.Errorf("observation chunk exceeds its operation bound")
	}
	if len(chunk.OtherReceipt) != 0 || (chunk.Operation != ObservationBegin &&
		(len(chunk.BaseCheckpointReference) != 0 || len(chunk.OriginalReceipt) != 0 || chunk.AnchorHeight != 0 || chunk.BlockCount != 0 || chunk.TableContext != nil || chunk.IsCheckpoint || chunk.Isolated || chunk.HostStateTxHash != "" || chunk.TableRows != 0 || chunk.TableTotal != 0 || len(chunk.TableDigest) != 0)) {
		return fmt.Errorf("observation operation contains fields for a different phase")
	}
	if (chunk.Operation != ObservationAppendStake && len(chunk.StakeRows) != 0) ||
		(chunk.Operation != ObservationAppendBlocks && len(chunk.Blocks) != 0) ||
		(chunk.Operation != ObservationBootstrapImport && len(chunk.Objects) != 0) {
		return fmt.Errorf("observation operation contains unexpected evidence")
	}
	if chunk.Operation == ObservationAppendStake || chunk.Operation == ObservationAppendBlocks || chunk.Operation == ObservationBootstrapImport || chunk.Operation == ObservationBootstrapComplete {
		if len(chunk.EvidenceDigest) != 32 {
			return fmt.Errorf("appended evidence requires its committed transcript suffix")
		}
	} else if chunk.Operation != ObservationBegin && len(chunk.EvidenceDigest) != 0 {
		return fmt.Errorf("observation operation contains an unexpected transcript suffix")
	}
	if chunk.Operation == ObservationBegin {
		if len(chunk.BaseCheckpointReference) != 32 || len(chunk.EvidenceDigest) != 32 || chunk.AnchorHeight == 0 || chunk.BlockCount == 0 || chunk.BlockCount > MaxHeaderBlocks || chunk.Sequence != 0 {
			return fmt.Errorf("begin observation requires a checkpoint, digest and bounded logical window")
		}
		if len(chunk.SessionId) != 0 || len(chunk.Blocks) > 0 || len(chunk.StakeRows) > 0 {
			return fmt.Errorf("begin cannot append evidence")
		}
	} else if chunk.Operation < ObservationBootstrapImport && chunk.Operation != ObservationCleanup && len(chunk.SessionId) != 32 {
		return fmt.Errorf("observation operation requires a 32-byte session id")
	}
	if chunk.Operation == ObservationBootstrapImport && len(chunk.Objects) > maxBootstrapPagesPerStep*(SnapshotPageBytes+64) {
		return fmt.Errorf("bootstrap object payload exceeds its page bound")
	}
	return nil
}
func observationSessionKey(namespace []byte, generation uint64, id []byte) []byte {
	return append(binary.BigEndian.AppendUint64(append([]byte("snapshots/v2/sessions/"), namespace...), generation), id...)
}
func observationSessionID(cs *ClientState, chunk *ObservationChunk) ([32]byte, error) {
	if len(chunk.BaseCheckpointReference) != 32 || len(chunk.EvidenceDigest) != 32 {
		return [32]byte{}, fmt.Errorf("missing observation commitment")
	}
	raw := append([]byte("cardano-ibc.session/v2\x00"), cs.StorageNamespace...)
	raw = binary.BigEndian.AppendUint64(raw, cs.VerificationGeneration)
	raw = append(raw, chunk.BaseCheckpointReference...)
	raw = binary.BigEndian.AppendUint32(raw, uint32(len(chunk.OriginalReceipt)))
	raw = append(raw, chunk.OriginalReceipt...)
	raw = binary.BigEndian.AppendUint64(raw, chunk.AnchorHeight)
	raw = binary.BigEndian.AppendUint32(raw, chunk.BlockCount)
	flags := byte(0)
	if chunk.IsCheckpoint {
		flags |= 1
	}
	if chunk.Isolated {
		flags |= 2
	}
	raw = append(raw, flags)
	host := [32]byte{}
	if chunk.HostStateTxHash != "" {
		var err error
		host, err = decodeBlockHash(chunk.HostStateTxHash)
		if err != nil {
			return [32]byte{}, err
		}
	}
	raw = append(raw, host[:]...)
	if chunk.TableContext == nil {
		raw = append(raw, 0)
	} else {
		raw = append(raw, 1)
		for _, value := range []uint64{chunk.TableContext.Epoch, uint64(chunk.TableRows), chunk.TableTotal, chunk.TableContext.SlotsPerKesPeriod, chunk.TableContext.EpochStartSlot, chunk.TableContext.EpochEndSlotExclusive} {
			raw = binary.BigEndian.AppendUint64(raw, value)
		}
		raw = append(raw, chunk.TableContext.EpochNonce...)
		raw = append(raw, chunk.TableDigest...)
	}
	raw = append(raw, chunk.EvidenceDigest...)
	return sha256.Sum256(raw), nil
}
func loadObservationSession(store storetypes.KVStore, cs *ClientState, id []byte) (*observationSession, error) {
	raw := store.Get(observationSessionKey(cs.StorageNamespace, cs.VerificationGeneration, id))
	if len(raw) == 0 || len(raw) > maxSessionBytes {
		return nil, fmt.Errorf("observation session is missing or oversized")
	}
	var session observationSession
	if _, err := cbor.Decode(raw, &session); err != nil {
		return nil, err
	}
	if session.Version != VerificationPolicyVersion || session.Generation != cs.VerificationGeneration || !bytes.Equal(session.Namespace, cs.StorageNamespace) {
		return nil, fmt.Errorf("observation session belongs to a discarded generation or different client")
	}
	return &session, nil
}
func saveObservationSession(store storetypes.KVStore, cs *ClientState, id []byte, session *observationSession) error {
	raw, err := cbor.Encode(session)
	if err != nil {
		return err
	}
	if len(raw) > maxSessionBytes {
		return fmt.Errorf("observation continuation exceeds its metadata bound")
	}
	store.Set(observationSessionKey(cs.StorageNamespace, cs.VerificationGeneration, id), raw)
	return nil
}

func beginObservation(ctx Context, store storetypes.KVStore, private storetypes.KVStore, cs *ClientState, chunk *ObservationChunk) ([32]byte, error) {
	var zero [32]byte
	scope, err := verificationScope(cs)
	if err != nil {
		return zero, err
	}
	base, err := loadVerificationCheckpoint(store, scope, chunk.BaseCheckpointReference)
	if err != nil {
		return zero, err
	}
	if len(chunk.OriginalReceipt) == 0 {
		if chunk.Isolated {
			if !bytes.Equal(private.Get(ownedCheckpointKey(cs.VerificationGeneration, base.Height)), chunk.BaseCheckpointReference) {
				return zero, fmt.Errorf("isolated observation requires an owned historical checkpoint")
			}
		} else {
			if !bytes.Equal(chunk.BaseCheckpointReference, cs.CheckpointReference) {
				return zero, fmt.Errorf("forward observation must start at the current checkpoint")
			}
			if cs.IsExpired(base.Timestamp, ctx.BlockTime()) {
				return zero, ErrTrustingPeriodExpired
			}
		}
	} else {
		original, err := loadVerifiedObservation(store, cs, chunk.OriginalReceipt)
		if err != nil {
			return zero, err
		}
		if !bytes.Equal(original.BaseReference, chunk.BaseCheckpointReference) {
			return zero, fmt.Errorf("alternative must use the original receipt's historical checkpoint")
		}
	}
	if chunk.AnchorHeight <= base.Height || chunk.AnchorHeight-base.Height > MaxBridgeBlocks+1 || uint64(chunk.BlockCount) < chunk.AnchorHeight-base.Height+DefaultThresholdDepth {
		return zero, fmt.Errorf("logical observation cannot reach the required anchor and descendants")
	}
	if ^uint64(0)-base.Height < uint64(chunk.BlockCount) {
		return zero, fmt.Errorf("observation height overflow")
	}
	// Complete bridge and anchor bodies authenticate the packet snapshot.
	// Gateway may omit a HostState transaction hint for unchanged roots.
	now := ctx.BlockTime().UnixNano()
	if now <= 0 || now > int64(^uint64(0)>>1)-int64(observationSessionLifetime) {
		return zero, fmt.Errorf("observation expiry cannot be represented")
	}
	id, err := observationSessionID(cs, chunk)
	if err != nil {
		return zero, err
	}
	if raw := store.Get(observationSessionKey(cs.StorageNamespace, cs.VerificationGeneration, id[:])); len(raw) > 0 {
		return id, nil
	}
	session := &observationSession{Version: VerificationPolicyVersion, Namespace: bytes.Clone(cs.StorageNamespace), Generation: cs.VerificationGeneration, BaseReference: bytes.Clone(chunk.BaseCheckpointReference), OriginalReceipt: bytes.Clone(chunk.OriginalReceipt), AnchorHeight: chunk.AnchorHeight, BlockCount: chunk.BlockCount, Working: *base, IsCheckpoint: chunk.IsCheckpoint, Isolated: chunk.Isolated, HostTxHash: chunk.HostStateTxHash, CreatedAt: uint64(now), ExpiresAt: uint64(now + int64(observationSessionLifetime)), QualifiedDenominator: []byte{1}}
	session.Working.Nonce = clonePraosNonceState(base.Nonce)
	copy(session.ExpectedDigest[:], chunk.EvidenceDigest)
	session.InputDigest = session.ExpectedDigest
	if chunk.TableContext != nil {
		if base.Epoch == ^uint64(0) || chunk.TableContext.Epoch != base.Epoch+1 || chunk.TableRows == 0 || chunk.TableRows > MaxStakeEntries || chunk.TableTotal == 0 || len(chunk.TableDigest) != 32 || len(chunk.TableContext.StakeDistribution) > 0 {
			return zero, fmt.Errorf("new table requires adjacent epoch and bounded complete-table commitments")
		}
		if err := cs.validateEpochContextParameters([]*EpochContext{chunk.TableContext}); err != nil {
			return zero, err
		}
		session.TableEpoch = chunk.TableContext.Epoch
		session.TableRows = chunk.TableRows
		session.TableTotal = chunk.TableTotal
		session.TableNonce = bytes.Clone(chunk.TableContext.EpochNonce)
		copy(session.ExpectedTableDigest[:], chunk.TableDigest)
		session.Table = stakeSnapshot{Epoch: session.TableEpoch}
		session.TableDigest = sha256.Sum256([]byte("cardano-ibc.stake-table/v2\x00"))
	} else {
		session.CreditReady = true
	}
	if err := pinVerificationCheckpoint(store, base, namespaceOwner(cs.StorageNamespace, cs.VerificationGeneration, 2, id[:])); err != nil {
		return zero, err
	}
	if err := retainVerification(store, cs, 1, id[:], nil, 0, session.ExpiresAt); err != nil {
		return zero, err
	}
	if err := saveObservationSession(store, cs, id[:], session); err != nil {
		return zero, err
	}
	return id, nil
}

func appendObservationStake(store storetypes.KVStore, session *observationSession, rows []byte) error {
	if session.TableRows == 0 || session.RowsRead >= session.TableRows || len(rows) == 0 || len(rows)%36 != 0 || session.ProcessedBlocks != 0 {
		return fmt.Errorf("stake rows are not expected in this session phase")
	}
	count := uint32(len(rows) / 36)
	// Table boundaries are fixed by the committed row count. Authentic prefixes
	// must not turn a 32-step table upload into 4,000 separate transactions.
	expected := session.TableRows - session.RowsRead
	if expected > maxObservationRowsPerStep {
		expected = maxObservationRowsPerStep
	}
	if count != expected {
		return fmt.Errorf("stake row batch must contain the next %d committed rows", expected)
	}
	var changes []SnapshotChange
	for cursor := 0; cursor < len(rows); cursor += 36 {
		key := rows[cursor : cursor+28]
		amount := binary.BigEndian.Uint64(rows[cursor+28 : cursor+36])
		if amount == 0 {
			return fmt.Errorf("stake rows require positive amounts")
		}
		// Rows follow Mithril's pool ID order, which also rules out repeats,
		// so sealing the table yields the root Mithril certifies for it.
		name, err := poolName(key)
		if err != nil {
			return err
		}
		if err := session.TableMithril.Append(name, amount); err != nil {
			return fmt.Errorf("stake rows must follow Mithril's pool ID order: %w", err)
		}
		_, found, err := lookupBinding(store, session.Working.Scope, session.Working.Registry.Mark, key)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("new table pool has no independently authenticated effective registration")
		}
		var ok bool
		session.Table.Total, ok = checkedAddStake(session.Table.Total, amount)
		if !ok {
			return fmt.Errorf("stake row total overflow")
		}
		changes = append(changes, SnapshotChange{bytes.Clone(key), bytes.Clone(rows[cursor+28 : cursor+36])})
		session.TableDigest = sha256.Sum256(append(session.TableDigest[:], rows[cursor:cursor+36]...))
	}
	sort.Slice(changes, func(i, j int) bool { return bytes.Compare(changes[i].Key, changes[j].Key) < 0 })
	root, err := NewSnapshotMap(store, session.Working.Scope, snapshotStake).PutBatch(session.Table.Root, changes)
	if err != nil {
		return err
	}
	session.Table.Root = root
	session.RowsRead += count
	if session.RowsRead == session.TableRows {
		if session.Table.Total != session.TableTotal || session.TableDigest != session.ExpectedTableDigest {
			return fmt.Errorf("sealed table total or digest disagrees with its complete uploaded contents")
		}
		if session.TableMithrilRoot, err = session.TableMithril.Root(); err != nil {
			return err
		}
		session.TableMithril = mithril.StakeRootBuilder{}
	}
	return nil
}

func advanceObservationCredit(store storetypes.KVStore, session *observationSession) error {
	if session.CreditReady || session.TableRows == 0 || session.RowsRead != session.TableRows || session.ProcessedBlocks != 0 {
		return fmt.Errorf("credit transition is not ready or already completed")
	}
	var changes []SnapshotChange
	n, err := NewSnapshotMap(store, session.Working.Scope, snapshotStake).Visit(session.Working.Stake.Root, session.CreditCursor, maxObservationRowsPerStep, func(key, value []byte) error {
		if len(value) != 8 {
			return fmt.Errorf("invalid sealed stake amount")
		}
		amount := binary.BigEndian.Uint64(value)
		old, err := lookupCredit(store, session.Working.Scope, session.Working.Credit, key)
		if err != nil {
			return err
		}
		cap := new(big.Rat).Add(old, big.NewRat(int64(DefaultAdditionalSettlementCreditBps), 10000))
		share := new(big.Rat).SetFrac(new(big.Int).SetUint64(amount), new(big.Int).SetUint64(session.Working.Stake.Total))
		if share.Cmp(cap) > 0 {
			share.Set(cap)
		}
		raw, err := encodeCredit(share)
		if err != nil {
			return err
		}
		changes = append(changes, SnapshotChange{key, raw})
		session.CreditCursor = bytes.Clone(key)
		return nil
	})
	if err != nil {
		return err
	}
	session.CreditRows += uint64(n)
	session.NextCredit, err = NewSnapshotMap(store, session.Working.Scope, snapshotCredit).PutBatch(session.NextCredit, changes)
	if err != nil {
		return err
	}
	if session.CreditRows == session.Working.Stake.Root.Rows {
		session.CreditReady = true
	} else if n == 0 {
		return fmt.Errorf("credit transition did not process every previous table row")
	}
	return nil
}
