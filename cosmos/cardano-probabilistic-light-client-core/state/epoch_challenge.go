package state

import (
	"encoding/binary"
	"fmt"

	errorsmod "cosmossdk.io/errors"
)

func (cs ClientState) epochChallenge(epoch uint64) *EpochContextChallenge {
	for _, challenge := range cs.EpochContextChallenges {
		if challenge != nil && challenge.Epoch == epoch {
			return challenge
		}
	}
	return nil
}

func (cs ClientState) verifyEpochUsable(ctx Context, epoch uint64) error {
	if cs.StorageVersion != StorageVersion {
		return fmt.Errorf("unsupported client storage format %d", cs.StorageVersion)
	}
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return errorsmod.Wrap(ErrIBCClientFrozen, "epoch roots cannot be used after a challenge freeze")
	}
	if cs.BootstrapPending {
		return errorsmod.Wrap(ErrEpochContextPending, "trusted bootstrap has not completed")
	}
	challenge := cs.epochChallenge(epoch)
	if challenge == nil {
		shared, err := ctx.snapshotStore()
		if err != nil {
			return err
		}
		raw := shared.Get(proofEpochDeadlineKey(&cs, epoch))
		if len(raw) == 8 {
			challenge = &EpochContextChallenge{Epoch: epoch, UsableAfterUnixNs: binary.BigEndian.Uint64(raw)}
		}
	}
	if challenge == nil || challenge.UsableAfterUnixNs == 0 {
		return errorsmod.Wrapf(ErrEpochContextPending, "epoch %d has no host-assigned challenge deadline", epoch)
	}
	if ctx.BlockTime().UnixNano() < 0 || uint64(ctx.BlockTime().UnixNano()) <= challenge.UsableAfterUnixNs {
		return errorsmod.Wrapf(ErrEpochContextPending, "epoch %d is pending until Unix nanoseconds %d", epoch, challenge.UsableAfterUnixNs)
	}
	ctx.RequiredResponseWindow = SharedSnapshotChallengePeriod
	if ctx.VerifyHostUsability == nil {
		return errorsmod.Wrap(ErrEpochContextPending, "host continuity tracking is missing")
	}
	return ctx.VerifyHostUsability(ctx, challenge.UsableAfterUnixNs)
}

func (cs ClientState) VerifyEpochUsable(ctx Context, epoch uint64) error {
	return cs.verifyEpochUsable(ctx, epoch)
}
