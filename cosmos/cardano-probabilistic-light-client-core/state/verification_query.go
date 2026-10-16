package state

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
)

type verificationMetadata struct {
	Reference                      []byte `json:"checkpoint_reference"`
	Generation                     uint64 `json:"verification_generation"`
	Height, Slot, Epoch, Timestamp uint64
	BlockHash                      string
	Nonce                          *PraosNonceState
	TotalStake, StakeRows          uint64
}
type verificationPage struct {
	Records    []any  `json:"records"`
	Next       []byte `json:"next"`
	Total      uint64 `json:"total"`
	Epoch      uint64 `json:"epoch"`
	TotalStake uint64 `json:"total_stake"`
}

// QueryVerification reads at most one metadata object or 128 ordered records.
// Off-chain callers can request full history in pages at one pinned host height.
func QueryVerification(ctx Context, cdc StateCodec, request *QueryVerificationRequest) ([]byte, error) {
	if len(request.Namespace) != 32 {
		return nil, fmt.Errorf("query requires a client namespace")
	}
	store, err := ctx.snapshotStore()
	if err != nil {
		return nil, err
	}
	raw := store.Get(namespaceKey(request.Namespace))
	if len(raw) == 0 || len(raw) > MaxClientBytes {
		return nil, fmt.Errorf("client namespace does not exist")
	}
	queryKind := QueryKind(request.Kind)
	client := cdc.DecodeClient(raw)
	if client.VerificationGeneration != request.Generation {
		return nil, fmt.Errorf("query references a discarded verification generation")
	}
	if queryKind == QuerySession {
		session, err := loadObservationSession(store, client, request.SessionId)
		if err != nil {
			return nil, err
		}
		return json.Marshal(session)
	}
	if queryKind == QueryReceipt {
		receipt, err := loadRetainedObservation(store, client, request.ReceiptId)
		if err != nil {
			return nil, err
		}
		return json.Marshal(receipt)
	}
	if queryKind == QueryEpochProposals {
		var epochs []*activatedEpochTable
		for _, deadline := range client.EpochContextChallenges {
			raw := store.Get(activatedEpochKey(client, deadline.Epoch))
			if len(raw) == 0 {
				continue
			}
			if len(raw) > MaxClientBytes {
				return nil, fmt.Errorf("oversized epoch proposal")
			}
			var epoch activatedEpochTable
			if err := decodeBoundedRecord(raw, &epoch); err != nil {
				return nil, err
			}
			epochs = append(epochs, &epoch)
		}
		return json.Marshal(epochs)
	}
	if queryKind == QueryReceipts {
		if request.Limit == 0 || request.Limit > 128 || len(request.After) > 32 {
			return nil, fmt.Errorf("receipt query exceeds its page bound")
		}
		scope, err := verificationScope(client)
		if err != nil {
			return nil, err
		}
		latest, err := loadVerificationCheckpoint(store, scope, client.CheckpointReference)
		if err != nil {
			return nil, err
		}
		prefix := retentionKey(client, RetainReceipt, nil)
		start := prefix
		if len(request.After) > 0 {
			start = append(append(bytes.Clone(prefix), request.After...), 0)
		}
		iterator := store.Iterator(start, storetypes.PrefixEndBytes(prefix))
		defer iterator.Close()
		page := verificationPage{Records: []any{}}
		for visited := uint32(0); iterator.Valid() && visited < request.Limit; iterator.Next() {
			id := iterator.Key()[len(prefix):]
			if len(id) != 32 {
				return nil, fmt.Errorf("invalid receipt retention key")
			}
			page.Next = bytes.Clone(id)
			visited++
			receipt, err := loadRetainedObservation(store, client, id)
			if err != nil {
				return nil, err
			}
			// The current settled ancestry authenticates accepted observations
			// after their ordinary checkpoint indexes have been pruned. It also
			// prevents unaccepted alternative forks from appearing as originals.
			hash, found, err := NewSnapshotMap(store, scope, snapshotSettledHistory).Lookup(latest.SettledHistory, binary.BigEndian.AppendUint64(nil, receipt.AnchorHeight))
			if err != nil {
				return nil, err
			}
			if found && bytes.Equal(hash, receipt.AnchorHash[:]) {
				page.Records = append(page.Records, struct {
					ID      []byte
					Receipt *verifiedObservation
				}{bytes.Clone(id), receipt})
			}
		}
		return json.Marshal(page)
	}
	if queryKind == QueryBootstrapProgress {
		raw := store.Get(bootstrapProgressKey(client))
		var progress bootstrapProgress
		if len(raw) == 0 || len(raw) > maxSessionBytes {
			return nil, fmt.Errorf("bootstrap continuation does not exist")
		}
		if err := decodeBoundedRecord(raw, &progress); err != nil {
			return nil, err
		}
		return json.Marshal(struct {
			Sequence  uint32
			Remaining uint64
		}{progress.Sequence, progress.Frontier.Rows})
	}
	ref := request.CheckpointReference
	if len(request.ReceiptId) != 0 {
		receipt, err := loadRetainedObservation(store, client, request.ReceiptId)
		if err != nil {
			return nil, err
		}
		if len(ref) != 0 && !bytes.Equal(ref, receipt.BaseReference) {
			return nil, fmt.Errorf("receipt only authorizes its exact historical base")
		}
		ref = receipt.BaseReference
	}
	if len(ref) == 0 {
		ref = client.CheckpointReference
	}
	scope, err := verificationScope(client)
	if err != nil {
		return nil, err
	}
	checkpoint, err := loadVerificationCheckpoint(store, scope, ref)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(ref, client.CheckpointReference) && len(request.ReceiptId) == 0 {
		owned := store.Get(retentionKey(client, RetainCheckpoint, binary.BigEndian.AppendUint64(nil, checkpoint.Height)))
		var retained retainedVerification
		if len(owned) == 0 {
			return nil, fmt.Errorf("historical checkpoint is not owned by this verification generation")
		}
		if err := decodeBoundedRecord(owned, &retained); err != nil {
			return nil, err
		}
		if !bytes.Equal(retained.Reference, ref) {
			return nil, fmt.Errorf("historical checkpoint reference is not authenticated by this generation")
		}
	}
	if queryKind == QueryCheckpoint {
		return json.Marshal(verificationMetadata{Reference: bytes.Clone(ref), Generation: client.VerificationGeneration, Height: checkpoint.Height, Slot: checkpoint.Slot, Epoch: checkpoint.Epoch, Timestamp: checkpoint.Timestamp, BlockHash: hex.EncodeToString(checkpoint.BlockHash[:]), Nonce: clonePraosNonceState(checkpoint.Nonce), TotalStake: checkpoint.Stake.Total, StakeRows: checkpoint.Stake.Root.Rows})
	}
	if request.Limit == 0 || request.Limit > maxObservationRowsPerStep || len(request.After) > SnapshotKeyBytes {
		return nil, fmt.Errorf("query page exceeds its record or cursor bound")
	}
	var kind byte
	var root SnapshotRoot
	switch queryKind {
	case QueryEffectiveBindings:
		kind = snapshotRegistry
		root = checkpoint.Registry.Effective.Root
		if checkpoint.Registry.Effective.Bindings {
			kind = snapshotBindings
		}
	case QueryStake:
		kind = snapshotStake
		root = checkpoint.Stake.Root
	case QuerySettlementCredit:
		kind = snapshotCredit
		root = checkpoint.Credit
	case QueryPoolProduction:
		kind = snapshotProduction
		root = checkpoint.Production
	case QueryRegistrations:
		kind = snapshotRegistry
		root = checkpoint.Registry.Records
	case QueryMarkBindings:
		kind = snapshotRegistry
		root = checkpoint.Registry.Mark.Root
		if checkpoint.Registry.Mark.Bindings {
			kind = snapshotBindings
		}
	case QueryCertificateCounters:
		kind = snapshotCounters
		root = checkpoint.Counters
	default:
		return nil, fmt.Errorf("unknown verification query kind")
	}
	page := verificationPage{Records: []any{}, Total: root.Rows, Epoch: checkpoint.Epoch, TotalStake: checkpoint.Stake.Total}
	_, err = NewSnapshotMap(store, scope, kind).Visit(root, request.After, int(request.Limit), func(key, value []byte) error {
		page.Next = bytes.Clone(key)
		switch queryKind {
		case QueryEffectiveBindings, QueryMarkBindings:
			projection := checkpoint.Registry.Effective
			if queryKind == QueryMarkBindings {
				projection = checkpoint.Registry.Mark
			}
			binding, found, err := lookupBinding(store, scope, projection, key)
			if err != nil {
				return err
			}
			if found {
				page.Records = append(page.Records, binding)
			}
		case QueryStake:
			if len(value) != 8 {
				return fmt.Errorf("invalid sealed stake record")
			}
			pool, err := poolName(key)
			if err != nil {
				return err
			}
			amount := binary.BigEndian.Uint64(value)
			page.Records = append(page.Records, &StakeDistributionEntry{PoolId: pool, Stake: amount, RelativeStakeNumerator: amount, RelativeStakeDenominator: checkpoint.Stake.Total})
		case QuerySettlementCredit:
			ratio, err := decodeCredit(value)
			if err != nil {
				return err
			}
			pool, err := poolName(key)
			if err != nil {
				return err
			}
			page.Records = append(page.Records, &PoolSettlementCredit{PoolId: pool, Numerator: ratio.Num().Bytes(), Denominator: ratio.Denom().Bytes()})
		case QueryPoolProduction:
			production, err := lookupProduction(store, scope, root, key, checkpoint.Epoch)
			if err != nil {
				return err
			}
			page.Records = append(page.Records, production)
		case QueryRegistrations:
			record, _, err := lookupRegistration(store, scope, checkpoint.Registry, key)
			if err != nil {
				return err
			}
			name, err := poolName(key)
			if err != nil {
				return err
			}
			page.Records = append(page.Records, &PoolRegistrationRecord{Registration: &PoolRegistrationBinding{PoolId: name, VrfKeyHash: bytes.Clone(record.VRF[:]), FirstRegistrationSlot: record.FirstSlot}, Registered: record.Registered, PendingVrfKeyHash: bytes.Clone(record.PendingVRF), PendingEffectiveEpoch: record.PendingEpoch, RetirementEpoch: record.RetirementEpoch})
		case QueryCertificateCounters:
			if len(value) != 8 {
				return fmt.Errorf("invalid sealed counter")
			}
			page.Records = append(page.Records, &OperationalCertificateCounter{PoolId: bytes.Clone(key), SequenceNumber: binary.BigEndian.Uint64(value)})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(page)
}
func decodeBoundedRecord(raw []byte, value any) error { _, err := cbor.Decode(raw, value); return err }
