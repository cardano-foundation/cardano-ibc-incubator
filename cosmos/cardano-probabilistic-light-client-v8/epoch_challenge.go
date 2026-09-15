package probabilistic

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"time"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// EpochContextChallengePeriod is an operational response window, not a proof
// of Cardano epoch authenticity or a bound on honest evidence availability.
const EpochContextChallengePeriod = 3 * time.Minute

var epochChallengeCheckpointPrefix = []byte("epochChallengeCheckpoint/")

func epochChallengeCheckpointKey(epoch uint64) []byte {
	return binary.BigEndian.AppendUint64(bytes.Clone(epochChallengeCheckpointPrefix), epoch)
}

func epochChallengeDeadline(ctx sdk.Context) (uint64, error) {
	// Keep deadlines within the SDK's signed Unix-nanosecond time range.
	now := ctx.BlockTime().UnixNano()
	if now <= 0 || now > math.MaxInt64-int64(EpochContextChallengePeriod) {
		return 0, errorsmod.Wrap(ErrInvalidTimestamp, "host time cannot represent epoch challenge deadline")
	}
	return uint64(now + int64(EpochContextChallengePeriod)), nil
}

func (cs ClientState) epochChallenge(epoch uint64) *EpochContextChallenge {
	for _, challenge := range cs.EpochContextChallenges {
		if challenge != nil && challenge.Epoch == epoch {
			return challenge
		}
	}
	return nil
}

func (cs ClientState) verifyEpochUsable(ctx sdk.Context, epoch uint64) error {
	if cs.FrozenHeight != nil && !cs.FrozenHeight.IsZero() {
		return errorsmod.Wrap(clienttypes.ErrClientFrozen, "epoch roots cannot be used after a challenge freeze")
	}
	challenge := cs.epochChallenge(epoch)
	if challenge == nil || challenge.UsableAfterUnixNs == 0 {
		return errorsmod.Wrapf(ErrEpochContextPending, "epoch %d has no host-assigned challenge deadline", epoch)
	}
	if ctx.BlockTime().UnixNano() < 0 || uint64(ctx.BlockTime().UnixNano()) < challenge.UsableAfterUnixNs {
		return errorsmod.Wrapf(ErrEpochContextPending, "epoch %d is pending until Unix nanoseconds %d", epoch, challenge.UsableAfterUnixNs)
	}
	return nil
}

// resetEpochChallenges is used at bootstrap and authority-controlled recovery.
// Caller-supplied deadlines must never make new client roots immediately usable.
func (cs *ClientState) resetEpochChallenges(ctx sdk.Context) error {
	deadline, err := epochChallengeDeadline(ctx)
	if err != nil {
		return err
	}
	cs.EpochContextChallenges = nil
	for _, epoch := range cs.EpochContexts {
		if epoch != nil && cs.epochChallenge(epoch.Epoch) == nil {
			cs.EpochContextChallenges = append(cs.EpochContextChallenges, &EpochContextChallenge{
				Epoch: epoch.Epoch, UsableAfterUnixNs: deadline,
			})
		}
	}
	return nil
}

// beginEpochChallenge runs only after header verification, before the update
// changes the trusted cursor. Subsequent headers can advance within this epoch,
// but all its roots share the original proof-use deadline.
func (cs *ClientState) beginEpochChallenge(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, epoch uint64, trusted *trustedBlockState) error {
	if cs.epochChallenge(epoch) != nil {
		return nil
	}
	deadline, err := epochChallengeDeadline(ctx)
	if err != nil {
		return err
	}
	if trusted == nil || trusted.height == nil {
		return errorsmod.Wrap(ErrInvalidHeaderHeight, "epoch proposal must have a trusted checkpoint")
	}
	// Use the existing protobuf codec for a private snapshot of just the cursor,
	// counters and epoch needed to verify competing rollover evidence. In
	// particular, rootless cursors otherwise disappear on the next update.
	trustedContext := epochContextByEpoch(cs.EpochContexts, trusted.epoch)
	if trustedContext == nil {
		return errorsmod.Wrap(ErrInvalidCurrentEpoch, "epoch proposal trusted context is missing")
	}
	snapshot := &ClientState{
		EpochContexts:                                  []*EpochContext{cloneEpochContext(trustedContext)},
		LatestCheckpointHeight:                         trusted.height,
		LatestCheckpointBlockHash:                      trusted.blockHash,
		LatestCheckpointEpoch:                          trusted.epoch,
		LatestCheckpointSlot:                           trusted.slot,
		LatestCheckpointTimestamp:                      trusted.timestamp,
		LatestCheckpointOperationalCertificateCounters: operationalCertificateCountersFromMap(trusted.operationalCertificateCounters),
	}
	clientStore.Set(epochChallengeCheckpointKey(epoch), cdc.MustMarshal(snapshot))
	cs.EpochContextChallenges = append(cs.EpochContextChallenges, &EpochContextChallenge{
		Epoch: epoch, UsableAfterUnixNs: deadline,
	})
	ctx.EventManager().EmitEvent(sdk.NewEvent("probabilistic_epoch_context_pending",
		sdk.NewAttribute("epoch", strconv.FormatUint(epoch, 10)),
		sdk.NewAttribute("usable_after_unix_ns", strconv.FormatUint(deadline, 10)),
		sdk.NewAttribute(AttributeKeyTrustedHeight, trusted.height.String()),
	))
	return nil
}

// challengeTrustedBlock supplies the pre-proposal cursor for misbehaviour
// verification only. Normal forward updates still use the latest checkpoint.
// Keep this evidence usable after the deadline too: a late freeze cannot undo
// earlier IBC operations, but can prevent further use of a conflicting client.
func (cs ClientState) challengeTrustedBlock(clientStore storetypes.KVStore, cdc codec.BinaryCodec, header *ProbabilisticHeader) (*trustedBlockState, []*EpochContext, error) {
	// Competing forks need not cross an epoch boundary at the same block
	// height. Select by the shared trusted height, not the claimed new epoch.
	var snapshot ClientState
	found := false
	for _, challenge := range cs.EpochContextChallenges {
		if challenge == nil {
			continue
		}
		encoded := clientStore.Get(epochChallengeCheckpointKey(challenge.Epoch))
		if len(encoded) == 0 {
			continue
		}
		snapshot = ClientState{}
		if err := cdc.Unmarshal(encoded, &snapshot); err != nil {
			return nil, nil, err
		}
		if snapshot.LatestCheckpointHeight == nil {
			return nil, nil, fmt.Errorf("epoch challenge checkpoint height is missing")
		}
		if snapshot.LatestCheckpointHeight.EQ(header.TrustedHeight) {
			found = true
			break
		}
	}
	if !found {
		return nil, nil, nil
	}
	counters, err := operationalCertificateCounterMap(snapshot.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return nil, nil, err
	}
	return &trustedBlockState{
		height:                         snapshot.LatestCheckpointHeight,
		blockHash:                      snapshot.LatestCheckpointBlockHash,
		epoch:                          snapshot.LatestCheckpointEpoch,
		slot:                           snapshot.LatestCheckpointSlot,
		timestamp:                      snapshot.LatestCheckpointTimestamp,
		operationalCertificateCounters: counters,
	}, snapshot.EpochContexts, nil
}

func (cs *ClientState) pruneEpochChallenges(clientStore storetypes.KVStore) {
	retained := make([]*EpochContextChallenge, 0, len(cs.EpochContextChallenges))
	for _, challenge := range cs.EpochContextChallenges {
		if challenge == nil {
			continue
		}
		if epochContextByEpoch(cs.EpochContexts, challenge.Epoch) == nil {
			clientStore.Delete(epochChallengeCheckpointKey(challenge.Epoch))
		} else {
			retained = append(retained, challenge)
		}
	}
	cs.EpochContextChallenges = retained
}
