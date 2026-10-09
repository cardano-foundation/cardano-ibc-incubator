package probabilistic

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func coreMessage(msg exported.ClientMessage) any {
	switch msg := msg.(type) {
	case *ProbabilisticHeader:
		return toCoreProbabilisticHeader(msg)
	case *Misbehaviour:
		return toCoreMisbehaviour(msg)
	default:
		return msg
	}
}

func (cs *ClientState) VerifyClientMessage(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, msg exported.ClientMessage) error {
	return adapterError(toCoreClientState(cs).VerifyClientMessage(coreContext(ctx), coreCodec{cdc}, store, coreMessage(msg)))
}

func (cs ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, msg exported.ClientMessage) bool {
	return toCoreClientState(&cs).CheckForMisbehaviour(coreContext(ctx), coreCodec{cdc}, store, coreMessage(msg))
}

func (cs *ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, msg exported.ClientMessage) []exported.Height {
	shared := toCoreClientState(cs)
	heights := shared.UpdateState(coreContext(ctx), coreCodec{cdc}, store, coreMessage(msg))
	*cs = *fromCoreClientState(shared)
	return mapCoreSlice(heights, func(h state.HeightValue) exported.Height {
		return NewHeight(h.GetRevisionNumber(), h.GetRevisionHeight())
	})
}

func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, msg exported.ClientMessage) {
	toCoreClientState(&cs).UpdateStateOnMisbehaviour(coreContext(ctx), coreCodec{cdc}, store, coreMessage(msg))
}

func (cs ClientState) CheckSubstituteAndUpdateState(ctx sdk.Context, cdc codec.BinaryCodec, subjectStore, substituteStore storetypes.KVStore, substitute exported.ClientState) error {
	candidate, ok := substitute.(*ClientState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "expected type %T, got %T", &ClientState{}, substitute)
	}
	return adapterError(toCoreClientState(&cs).CheckSubstituteAndUpdateState(coreContext(ctx), coreCodec{cdc}, subjectStore, substituteStore, toCoreClientState(candidate)))
}

func IsMatchingClientState(subject, substitute ClientState) bool {
	return state.IsMatchingClientState(*toCoreClientState(&subject), *toCoreClientState(&substitute))
}
