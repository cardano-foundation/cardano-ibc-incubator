package state

import (
	"bytes"
	"fmt"
	"math"
	"slices"
	"strings"

	errorsmod "cosmossdk.io/errors"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func clonePoolBinding(binding *PoolRegistrationBinding) *PoolRegistrationBinding {
	if binding == nil {
		return nil
	}
	return &PoolRegistrationBinding{PoolId: binding.PoolId, VrfKeyHash: bytes.Clone(binding.VrfKeyHash), FirstRegistrationSlot: binding.FirstRegistrationSlot}
}

func clonePoolBindings(bindings []*PoolRegistrationBinding) []*PoolRegistrationBinding {
	if bindings == nil {
		return nil
	}
	result := make([]*PoolRegistrationBinding, len(bindings))
	for i, binding := range bindings {
		result[i] = clonePoolBinding(binding)
	}
	return result
}

func clonePoolRegistry(registry *PoolRegistryState) *PoolRegistryState {
	if registry == nil {
		return nil
	}
	result := &PoolRegistryState{Epoch: registry.Epoch, Mark: clonePoolBindings(registry.Mark), Effective: clonePoolBindings(registry.Effective)}
	for _, record := range registry.Pools {
		if record == nil {
			result.Pools = append(result.Pools, nil)
			continue
		}
		result.Pools = append(result.Pools, &PoolRegistrationRecord{Registration: clonePoolBinding(record.Registration),
			Registered: record.Registered, PendingVrfKeyHash: bytes.Clone(record.PendingVrfKeyHash),
			PendingEffectiveEpoch: record.PendingEffectiveEpoch, RetirementEpoch: record.RetirementEpoch})
	}
	return result
}

func poolRegistriesEqual(left, right *PoolRegistryState) bool {
	if left == nil || right == nil {
		return left == right
	}
	if left.Epoch != right.Epoch || len(left.Pools) != len(right.Pools) {
		return false
	}
	bindingEqual := func(a, b *PoolRegistrationBinding) bool {
		return a != nil && b != nil && a.PoolId == b.PoolId && a.FirstRegistrationSlot == b.FirstRegistrationSlot && bytes.Equal(a.VrfKeyHash, b.VrfKeyHash)
	}
	records := make(map[string]*PoolRegistrationRecord, len(right.Pools))
	for _, record := range right.Pools {
		if record == nil || record.Registration == nil || records[record.Registration.PoolId] != nil {
			return false
		}
		records[record.Registration.PoolId] = record
	}
	for _, a := range left.Pools {
		if a == nil || a.Registration == nil {
			return false
		}
		b := records[a.Registration.PoolId]
		if b == nil || !bindingEqual(a.Registration, b.Registration) || a.Registered != b.Registered ||
			a.PendingEffectiveEpoch != b.PendingEffectiveEpoch || a.RetirementEpoch != b.RetirementEpoch || !bytes.Equal(a.PendingVrfKeyHash, b.PendingVrfKeyHash) {
			return false
		}
		delete(records, a.Registration.PoolId)
	}
	for _, pair := range [][2][]*PoolRegistrationBinding{{left.Mark, right.Mark}, {left.Effective, right.Effective}} {
		a, errA := poolBindingMap(pair[0])
		b, errB := poolBindingMap(pair[1])
		if errA != nil || errB != nil || len(a) != len(b) {
			return false
		}
		for id, binding := range a {
			if !bindingEqual(binding, b[id]) {
				return false
			}
		}
	}
	return true
}

func poolBindingMap(bindings []*PoolRegistrationBinding) (map[string]*PoolRegistrationBinding, error) {
	result := make(map[string]*PoolRegistrationBinding, len(bindings))
	for _, binding := range bindings {
		if binding == nil || binding.PoolId == "" || binding.PoolId != strings.ToLower(strings.TrimSpace(binding.PoolId)) || len(binding.VrfKeyHash) != 32 {
			return nil, fmt.Errorf("pool registry binding requires a canonical pool id and 32-byte VRF hash")
		}
		if result[binding.PoolId] != nil {
			return nil, fmt.Errorf("duplicate pool registry binding for %s", binding.PoolId)
		}
		result[binding.PoolId] = binding
	}
	return result, nil
}

func validatePoolRegistry(registry *PoolRegistryState, epoch, slot uint64) error {
	if registry == nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry is missing and requires authenticated or explicitly trusted bootstrap")
	}
	if registry.Epoch != epoch {
		return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry epoch differs from its checkpoint")
	}
	current := make(map[string]*PoolRegistrationBinding, len(registry.Pools))
	for _, record := range registry.Pools {
		if record == nil || record.Registration == nil {
			return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry record is missing")
		}
		binding := record.Registration
		if _, err := poolBindingMap([]*PoolRegistrationBinding{binding}); err != nil {
			return err
		}
		if current[binding.PoolId] != nil || binding.FirstRegistrationSlot > slot {
			return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry has duplicate identities or a future registration slot")
		}
		current[binding.PoolId] = binding
		if len(record.PendingVrfKeyHash) == 0 {
			if record.PendingEffectiveEpoch != 0 {
				return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry pending epoch has no VRF binding")
			}
		} else if !record.Registered || len(record.PendingVrfKeyHash) != 32 || epoch == math.MaxUint64 || record.PendingEffectiveEpoch != epoch+1 {
			return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry pending registration must activate at the next ledger epoch")
		}
		if record.RetirementEpoch != 0 && (!record.Registered || record.RetirementEpoch <= epoch) {
			return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry retirement must belong to a later epoch")
		}
	}
	for _, snapshot := range [][]*PoolRegistrationBinding{registry.Mark, registry.Effective} {
		bindings, err := poolBindingMap(snapshot)
		if err != nil {
			return err
		}
		for id, binding := range bindings {
			if known := current[id]; known == nil || known.FirstRegistrationSlot != binding.FirstRegistrationSlot {
				return errorsmod.Wrap(ErrIBCInvalidClient, "pool registry snapshot has no corresponding authenticated registration age")
			}
		}
	}
	return nil
}

func verifyStakeTablePoolBindings(context *EpochContext, registry *PoolRegistryState) error {
	if registry == nil || context == nil || registry.Epoch != context.Epoch {
		return errorsmod.Wrap(ErrInvalidCurrentEpoch, "pool registration snapshot is unavailable for this epoch")
	}
	bindings, err := poolBindingMap(registry.Effective)
	if err != nil {
		return err
	}
	for _, entry := range context.StakeDistribution {
		if entry == nil {
			return errorsmod.Wrap(ErrInvalidCurrentEpoch, "nil stake distribution entry")
		}
		binding := bindings[strings.ToLower(entry.PoolId)]
		if binding == nil {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "pool %s has no authenticated effective registration for epoch %d", entry.PoolId, context.Epoch)
		}
		if !bytes.Equal(binding.VrfKeyHash, entry.VrfKeyHash) || binding.FirstRegistrationSlot != entry.FirstRegistrationSlot {
			return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "pool %s VRF binding or registration age disagrees with authenticated epoch history", entry.PoolId)
		}
	}
	return nil
}

type poolRegistryTracker struct {
	state  *PoolRegistryState
	byPool map[string]*PoolRegistrationRecord
}

func newPoolRegistryTracker(registry *PoolRegistryState, epoch, slot uint64) (*poolRegistryTracker, error) {
	if err := validatePoolRegistry(registry, epoch, slot); err != nil {
		return nil, err
	}
	tracker := &poolRegistryTracker{state: clonePoolRegistry(registry), byPool: make(map[string]*PoolRegistrationRecord)}
	for _, record := range tracker.state.Pools {
		tracker.byPool[record.Registration.PoolId] = record
	}
	return tracker, nil
}

// tick follows SNAP before applying future pool parameters and POOLREAP.
// New registrations in epoch e first enter election authority in e+2.
// Re-registration changes become ledger-current in e+1, then enter the mark
// snapshot in e+2 and the effective set snapshot in e+3.
func (tracker *poolRegistryTracker) tick(epoch uint64) error {
	if epoch < tracker.state.Epoch {
		return errorsmod.Wrap(ErrInvalidCurrentEpoch, "pool registry epoch went backwards")
	}
	for tracker.state.Epoch < epoch {
		nextEpoch := tracker.state.Epoch + 1
		tracker.state.Effective = clonePoolBindings(tracker.state.Mark)
		tracker.state.Mark = nil
		for _, record := range tracker.state.Pools {
			if record.Registered {
				tracker.state.Mark = append(tracker.state.Mark, clonePoolBinding(record.Registration))
			}
		}
		for _, record := range tracker.state.Pools {
			if record.PendingEffectiveEpoch == nextEpoch {
				record.Registration.VrfKeyHash = bytes.Clone(record.PendingVrfKeyHash)
				record.PendingVrfKeyHash, record.PendingEffectiveEpoch = nil, 0
			}
			if record.RetirementEpoch == nextEpoch {
				record.Registered, record.RetirementEpoch = false, 0
			}
		}
		tracker.state.Epoch = nextEpoch
	}
	return nil
}

func (tracker *poolRegistryTracker) apply(slot uint64, certificates []core.PoolCertificate) error {
	for _, certificate := range certificates {
		record := tracker.byPool[certificate.PoolID]
		if certificate.Retirement {
			if record == nil || !record.Registered || certificate.RetirementEpoch <= tracker.state.Epoch {
				return errorsmod.Wrap(ErrInvalidAcceptedBlock, "pool retirement has no current registration or valid future epoch")
			}
			record.RetirementEpoch = certificate.RetirementEpoch
			continue
		}
		if len(certificate.VRFKeyHash) != 32 || certificate.PoolID == "" {
			return errorsmod.Wrap(ErrInvalidAcceptedBlock, "invalid pool registration certificate")
		}
		if record == nil {
			record = &PoolRegistrationRecord{Registration: &PoolRegistrationBinding{PoolId: certificate.PoolID, FirstRegistrationSlot: slot}}
			tracker.byPool[certificate.PoolID] = record
			tracker.state.Pools = append(tracker.state.Pools, record)
		}
		if !record.Registered {
			record.Registered = true
			record.Registration.VrfKeyHash = bytes.Clone(certificate.VRFKeyHash)
			record.PendingVrfKeyHash, record.PendingEffectiveEpoch = nil, 0
		} else {
			if tracker.state.Epoch == math.MaxUint64 {
				return errorsmod.Wrap(ErrInvalidCurrentEpoch, "pool registration activation epoch overflows")
			}
			record.PendingVrfKeyHash = bytes.Clone(certificate.VRFKeyHash)
			record.PendingEffectiveEpoch = tracker.state.Epoch + 1
		}
		// Re-registration cancels a scheduled retirement and preserves age.
		record.RetirementEpoch = 0
	}
	slices.SortFunc(tracker.state.Pools, func(a, b *PoolRegistrationRecord) int {
		return strings.Compare(a.Registration.PoolId, b.Registration.PoolId)
	})
	return nil
}
