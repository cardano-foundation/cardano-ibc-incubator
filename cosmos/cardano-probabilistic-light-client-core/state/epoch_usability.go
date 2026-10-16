package state

import (
	"errors"
	"fmt"

	storetypes "cosmossdk.io/store/types"
)

type EpochUsabilityStatus string

const (
	EpochUsable      EpochUsabilityStatus = "usable"
	EpochPending     EpochUsabilityStatus = "pending"
	EpochUnproposed  EpochUsabilityStatus = "unproposed"
	EpochFrozen      EpochUsabilityStatus = "frozen"
	EpochExpired     EpochUsabilityStatus = "expired"
	EpochUnsupported EpochUsabilityStatus = "unsupported"
)

// EpochUsability reports the verifier's decision at one destination height.
// Unproposed permits submitting a following-epoch table, never committing state
// that depends on that table before a subsequent Usable response.
type EpochUsability struct {
	Status     EpochUsabilityStatus `json:"status"`
	Epoch      uint64               `json:"epoch"`
	Generation uint64               `json:"generation"`
	Revision   uint64               `json:"revision"`
	Height     uint64               `json:"height"`
	Timestamp  uint64               `json:"timestamp"`
	Reason     string               `json:"reason,omitempty"`
}

func (cs ClientState) EpochUsability(ctx Context, private storetypes.KVStore, cdc StateCodec, epoch uint64) (*EpochUsability, error) {
	if ctx.Height <= 0 || ctx.BlockTime().UnixNano() <= 0 {
		return nil, fmt.Errorf("epoch usability requires a committed host height and time")
	}
	result := &EpochUsability{Status: EpochUnsupported, Epoch: epoch, Generation: cs.VerificationGeneration,
		Revision: ctx.SelfHeight.RevisionNumber, Height: uint64(ctx.Height), Timestamp: uint64(ctx.BlockTime().UnixNano())}
	if cs.StorageVersion != StorageVersion {
		result.Reason = "unsupported client storage format"
		return result, nil
	}
	switch cs.Status(ctx, private, cdc) {
	case Frozen:
		result.Status = EpochFrozen
		return result, nil
	case Expired:
		result.Status = EpochExpired
		return result, nil
	}
	if err := cs.verifyEpochUsable(ctx, epoch); err != nil {
		if !errors.Is(err, ErrEpochContextPending) {
			return nil, err
		}
		result.Status, result.Reason = EpochPending, err.Error()
		// Only the next epoch can be proposed. Missing historical context must
		// never let a proof or an activation skip the verifier's gate.
		if !cs.BootstrapPending && epoch > cs.CurrentEpoch && epoch-cs.CurrentEpoch == 1 && cs.epochChallenge(epoch) == nil {
			shared, err := ctx.snapshotStore()
			if err != nil {
				return nil, err
			}
			if !shared.Has(proofEpochDeadlineKey(&cs, epoch)) {
				result.Status = EpochUnproposed
			}
		}
		return result, nil
	}
	result.Status = EpochUsable
	return result, nil
}
