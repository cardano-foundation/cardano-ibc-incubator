package state

import (
	"math"

	errorsmod "cosmossdk.io/errors"
)

// Babbage and Conway use the network's fixed Shelley epoch length. The trusted
// current epoch supplies that length and an absolute-slot anchor, so no Byron
// epoch length or slot-zero assumption is needed. Supporting an era that changes
// this schedule requires an authenticated schedule transition, not new bounds
// supplied in an epoch context.
func (cs ClientState) epochLength() (uint64, error) {
	if cs.CurrentEpochEndSlotExclusive <= cs.CurrentEpochStartSlot {
		return 0, errorsmod.Wrap(ErrInvalidCurrentEpoch, "stored current epoch slot bounds must be increasing")
	}
	return cs.CurrentEpochEndSlotExclusive - cs.CurrentEpochStartSlot, nil
}

func (cs ClientState) epochSlotBounds(epoch uint64) (start, end uint64, err error) {
	length, err := cs.epochLength()
	if err != nil {
		return 0, 0, err
	}
	if epoch >= cs.CurrentEpoch {
		delta := epoch - cs.CurrentEpoch
		// Reserve room for the exclusive end as well as the start.
		if delta > (math.MaxUint64-cs.CurrentEpochEndSlotExclusive)/length {
			return 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "derived slot bounds overflow for epoch %d", epoch)
		}
		offset := delta * length
		return cs.CurrentEpochStartSlot + offset, cs.CurrentEpochEndSlotExclusive + offset, nil
	}
	delta := cs.CurrentEpoch - epoch
	if delta > cs.CurrentEpochStartSlot/length {
		return 0, 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "epoch %d is before the stored epoch schedule", epoch)
	}
	offset := delta * length
	return cs.CurrentEpochStartSlot - offset, cs.CurrentEpochEndSlotExclusive - offset, nil
}

func (cs ClientState) epochForSlot(slot uint64) (uint64, error) {
	length, err := cs.epochLength()
	if err != nil {
		return 0, err
	}
	var epoch uint64
	if slot >= cs.CurrentEpochStartSlot {
		delta := (slot - cs.CurrentEpochStartSlot) / length
		if delta > math.MaxUint64-cs.CurrentEpoch {
			return 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "derived epoch overflows for slot %d", slot)
		}
		epoch = cs.CurrentEpoch + delta
	} else {
		// Round up without overflowing at the largest possible slot distance.
		delta := (cs.CurrentEpochStartSlot-slot-1)/length + 1
		if delta > cs.CurrentEpoch {
			return 0, errorsmod.Wrapf(ErrInvalidCurrentEpoch, "slot %d is before the stored epoch schedule", slot)
		}
		epoch = cs.CurrentEpoch - delta
	}
	// Reject even a partially representable epoch. Both of its boundaries must
	// fit in the protobuf's uint64 fields.
	if _, _, err := cs.epochSlotBounds(epoch); err != nil {
		return 0, err
	}
	return epoch, nil
}
