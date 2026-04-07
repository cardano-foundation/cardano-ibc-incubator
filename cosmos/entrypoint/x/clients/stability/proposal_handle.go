package stability

import (
	"reflect"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (cs ClientState) CheckSubstituteAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, subjectClientStore,
	substituteClientStore storetypes.KVStore, substituteClient exported.ClientState,
) error {
	substituteClientState, ok := substituteClient.(*ClientState)
	if !ok {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClient, "expected type %T, got %T", &ClientState{}, substituteClient)
	}
	if err := substituteClientState.Validate(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidSubstitute, err.Error())
	}
	if !IsMatchingClientState(cs, *substituteClientState) {
		return errorsmod.Wrap(clienttypes.ErrInvalidSubstitute, "subject client state does not match substitute client state")
	}
	if substituteClientState.LatestHeight == nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidSubstitute, "substitute client latest height cannot be nil")
	}
	height := substituteClientState.LatestHeight
	consensusState, found := GetConsensusState(substituteClientStore, cdc, height)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrConsensusStateNotFound, "unable to retrieve latest consensus state for substitute client")
	}
	if err := consensusState.ValidateBasic(); err != nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidSubstitute, err.Error())
	}
	processedHeight, found := GetProcessedHeight(substituteClientStore, height)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrUpdateClientFailed, "unable to retrieve processed height for substitute client latest height")
	}
	processedTime, found := GetProcessedTime(substituteClientStore, height)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrUpdateClientFailed, "unable to retrieve processed time for substitute client latest height")
	}
	if cs.Status(ctx, subjectClientStore, cdc) == exported.Frozen || cs.FrozenHeight == nil {
		zeroHeight := ZeroHeight()
		cs.FrozenHeight = &zeroHeight
	}
	setConsensusState(subjectClientStore, cdc, consensusState, height)
	setConsensusMetadataWithValues(subjectClientStore, height, processedHeight, processedTime)
	cs.LatestHeight = substituteClientState.LatestHeight
	cs.CurrentEpoch = substituteClientState.CurrentEpoch
	cs.ChainId = substituteClientState.ChainId
	cs.TrustingPeriod = substituteClientState.TrustingPeriod
	setClientState(subjectClientStore, cdc, &cs)
	return nil
}

func IsMatchingClientState(subject, substitute ClientState) bool {
	zeroHeightSubject := ZeroHeight()
	zeroHeightSubstitute := ZeroHeight()
	subject.LatestHeight = &zeroHeightSubject
	subject.FrozenHeight = &zeroHeightSubject
	subject.CurrentEpoch = 0
	subject.TrustingPeriod = 0
	subject.ChainId = ""
	substitute.LatestHeight = &zeroHeightSubstitute
	substitute.FrozenHeight = &zeroHeightSubstitute
	substitute.CurrentEpoch = 0
	substitute.TrustingPeriod = 0
	substitute.ChainId = ""
	return reflect.DeepEqual(subject, substitute)
}
