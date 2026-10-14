package state

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"

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
	if len(raw) == 0 || len(raw) > MaxCompactClientBytes {
		return nil, fmt.Errorf("client namespace does not exist")
	}
	client := cdc.DecodeClient(raw)
	if client.VerificationGeneration != request.Generation {
		return nil, fmt.Errorf("query references a discarded verification generation")
	}
	if request.Kind == 8 {
		session, err := loadObservationSession(store, client, request.SessionId)
		if err != nil {
			return nil, err
		}
		return json.Marshal(session)
	}
	if request.Kind == 9 {
		receipt, err := loadVerifiedObservation(store, client, request.ReceiptId)
		if err != nil {
			return nil, err
		}
		return json.Marshal(receipt)
	}
	if request.Kind == 10 {
		var epochs []*activatedEpochTable
		for _, deadline := range client.EpochContextChallenges {
			raw := store.Get(activatedEpochKey(client, deadline.Epoch))
			if len(raw) == 0 {
				continue
			}
			if len(raw) > MaxCompactClientBytes {
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
	if request.Kind == 11 {
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
	if request.Kind == 0 {
		return json.Marshal(verificationMetadata{Reference: bytes.Clone(ref), Generation: client.VerificationGeneration, Height: checkpoint.Height, Slot: checkpoint.Slot, Epoch: checkpoint.Epoch, Timestamp: checkpoint.Timestamp, BlockHash: hex.EncodeToString(checkpoint.BlockHash[:]), Nonce: clonePraosNonceState(checkpoint.Nonce), TotalStake: checkpoint.Stake.Total, StakeRows: checkpoint.Stake.Root.Rows})
	}
	if request.Limit == 0 || request.Limit > maxObservationRowsPerStep || len(request.After) > SnapshotKeyBytes {
		return nil, fmt.Errorf("query page exceeds its record or cursor bound")
	}
	var kind byte
	var root SnapshotRoot
	switch request.Kind {
	case 1:
		kind = snapshotRegistry
		root = checkpoint.Registry.Effective.Root
		if checkpoint.Registry.Effective.Bindings {
			kind = snapshotBindings
		}
	case 2:
		kind = snapshotStake
		root = checkpoint.Stake.Root
	case 3:
		kind = snapshotCredit
		root = checkpoint.Credit
	case 4:
		kind = snapshotProduction
		root = checkpoint.Production
	case 5:
		kind = snapshotCounters
		root = checkpoint.Counters
	default:
		return nil, fmt.Errorf("unknown verification query kind")
	}
	page := verificationPage{Records: []any{}, Total: root.Rows, Epoch: checkpoint.Epoch, TotalStake: checkpoint.Stake.Total}
	_, err = NewSnapshotMap(store, scope, kind).Visit(root, request.After, int(request.Limit), func(key, value []byte) error {
		page.Next = bytes.Clone(key)
		switch request.Kind {
		case 1:
			binding, found, err := lookupBinding(store, scope, checkpoint.Registry.Effective, key)
			if err != nil {
				return err
			}
			if found {
				page.Records = append(page.Records, binding)
			}
		case 2:
			if len(value) != 8 {
				return fmt.Errorf("invalid sealed stake record")
			}
			pool, err := poolName(key)
			if err != nil {
				return err
			}
			amount := binary.BigEndian.Uint64(value)
			page.Records = append(page.Records, &StakeDistributionEntry{PoolId: pool, Stake: amount, RelativeStakeNumerator: amount, RelativeStakeDenominator: checkpoint.Stake.Total})
		case 3:
			ratio, err := decodeCredit(value)
			if err != nil {
				return err
			}
			pool, err := poolName(key)
			if err != nil {
				return err
			}
			page.Records = append(page.Records, &PoolSettlementCredit{PoolId: pool, Numerator: ratio.Num().Bytes(), Denominator: ratio.Denom().Bytes()})
		case 4:
			production, err := lookupProduction(store, scope, root, key, checkpoint.Epoch)
			if err != nil {
				return err
			}
			page.Records = append(page.Records, production)
		case 5:
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
