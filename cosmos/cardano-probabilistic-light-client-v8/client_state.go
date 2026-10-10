package probabilistic

import (
	"fmt"
	"time"

	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)

func NewClientState(
	chainID string,
	latestHeight *Height,
	currentEpoch uint64,
	trustingPeriod time.Duration,
	maxClockDrift time.Duration,
	upgradePath []string,
) *ClientState {
	zeroHeight := ZeroHeight()
	return &ClientState{
		ChainId:        chainID,
		LatestHeight:   latestHeight,
		FrozenHeight:   zeroHeight,
		CurrentEpoch:   currentEpoch,
		TrustingPeriod: trustingPeriod,
		MaxClockDrift:  maxClockDrift,
		UpgradePath:    upgradePath,
	}
}

func (cs ClientState) GetChainID() string { return cs.ChainId }

func (ClientState) ClientType() string { return ModuleName }

func (cs ClientState) GetLatestHeight() exported.Height {
	if cs.LatestHeight == nil {
		return clienttypes.ZeroHeight()
	}
	return clienttypes.NewHeight(cs.LatestHeight.GetRevisionNumber(), cs.LatestHeight.GetRevisionHeight())
}

func (cs ClientState) VerifyMembership(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	delayTimePeriod uint64,
	delayBlockPeriod uint64,
	proof []byte,
	path exported.Path,
	value []byte,
) error {
	if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
		return err
	}
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	if err := cs.verifyEpochUsable(ctx, consState.AcceptedEpoch); err != nil {
		return err
	}
	key, err := ibcStateKeyFromPath(path)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	if isPacketStateKey(key) {
		return verifyPacketMembership(consState, height.GetRevisionHeight(), key, value, proof)
	}
	if err := VerifyIbcStateMembership(consState.IbcStateRoot, key, value, proof); err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

func (cs ClientState) VerifyNonMembership(
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdc codec.BinaryCodec,
	height exported.Height,
	delayTimePeriod uint64,
	delayBlockPeriod uint64,
	proof []byte,
	path exported.Path,
) error {
	if err := verifyDelayPeriodPassed(ctx, clientStore, height, delayTimePeriod, delayBlockPeriod); err != nil {
		return err
	}
	consState, found := GetConsensusState(clientStore, cdc, height)
	if !found {
		return errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", height)
	}
	if err := cs.verifyEpochUsable(ctx, consState.AcceptedEpoch); err != nil {
		return err
	}
	key, err := ibcStateKeyFromPath(path)
	if err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	if isPacketStateKey(key) {
		return verifyPacketNonMembership(consState, height.GetRevisionHeight(), key, proof)
	}
	if err := VerifyIbcStateNonMembership(consState.IbcStateRoot, key, proof); err != nil {
		return errorsmod.Wrap(clienttypes.ErrFailedMembershipVerification, err.Error())
	}
	return nil
}

func ibcStateKeyFromPath(path exported.Path) ([]byte, error) {
	mpath, ok := path.(commitmenttypes.MerklePath)
	if !ok {
		return nil, fmt.Errorf("path is not a MerklePath")
	}
	return state.IbcStateKeyFromPath(mpath.KeyPath)
}

func (cs ClientState) GetTimestampAtHeight(ctx sdk.Context, store storetypes.KVStore, cdc codec.BinaryCodec, height exported.Height) (uint64, error) {
	value, err := toCoreClientState(&cs).GetTimestampAtHeight(coreContext(ctx), store, coreCodec{cdc}, height)
	return value, adapterError(err)
}

func (cs ClientState) Status(ctx sdk.Context, store storetypes.KVStore, cdc codec.BinaryCodec) exported.Status {
	return exported.Status(toCoreClientState(&cs).Status(coreContext(ctx), store, coreCodec{cdc}))
}

func (cs ClientState) Validate() error { return adapterError(toCoreClientState(&cs).Validate()) }

func (cs ClientState) IsExpired(timestamp uint64, now time.Time) bool {
	return toCoreClientState(&cs).IsExpired(timestamp, now)
}

func (cs ClientState) ZeroCustomFields() exported.ClientState {
	return fromCoreClientState(toCoreClientState(&cs).ZeroCustomFields())
}

func (cs ClientState) DeriveTimestampFromSlot(slot uint64) (uint64, error) {
	return toCoreClientState(&cs).DeriveTimestampFromSlot(slot)
}

func (cs ClientState) DeriveSlotFromTimestamp(timestamp uint64) (uint64, error) {
	return toCoreClientState(&cs).DeriveSlotFromTimestamp(timestamp)
}

func (cs ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, consState exported.ConsensusState) error {
	consensus, ok := consState.(*ConsensusState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidConsensus, "invalid initial consensus state. expected type: %T, got: %T", &ConsensusState{}, consState)
	}
	return adapterError(toCoreClientState(&cs).Initialize(coreContext(ctx), coreCodec{cdc}, store, toCoreConsensusState(consensus)))
}

func (cs ClientState) ExportMetadata(store storetypes.KVStore) []exported.GenesisMetadata {
	return mapCoreSlice(toCoreClientState(&cs).ExportMetadata(store), func(m state.Metadata) exported.GenesisMetadata { return clienttypes.NewGenesisMetadata(m.Key, m.Value) })
}

func verifyDelayPeriodPassed(ctx sdk.Context, store storetypes.KVStore, height exported.Height, timeDelay, blockDelay uint64) error {
	return state.VerifyDelayPeriodPassed(coreContext(ctx), store, height, timeDelay, blockDelay)
}
