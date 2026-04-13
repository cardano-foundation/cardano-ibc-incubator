package stability

import (
	errorsmod "cosmossdk.io/errors"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.LightClientModule = (*LightClientModule)(nil)

type LightClientModule struct {
	cdc           codec.BinaryCodec
	storeProvider clienttypes.StoreProvider
}

func NewLightClientModule(cdc codec.BinaryCodec, storeProvider clienttypes.StoreProvider) LightClientModule {
	return LightClientModule{cdc: cdc, storeProvider: storeProvider}
}

func (l LightClientModule) Initialize(ctx sdk.Context, clientID string, clientStateBz, consensusStateBz []byte) error {
	var clientState ClientState
	if err := l.cdc.Unmarshal(clientStateBz, &clientState); err != nil {
		return err
	}
	if err := clientState.Validate(); err != nil {
		return err
	}
	var consensusState ConsensusState
	if err := l.cdc.Unmarshal(consensusStateBz, &consensusState); err != nil {
		return err
	}
	if err := consensusState.ValidateBasic(); err != nil {
		return err
	}
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	return clientState.Initialize(ctx, l.cdc, clientStore, &consensusState)
}

func (l LightClientModule) VerifyClientMessage(ctx sdk.Context, clientID string, clientMsg exported.ClientMessage) error {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID)
	}
	err := clientState.VerifyClientMessage(ctx, l.cdc, clientStore, clientMsg)
	if err != nil {
		if header, ok := clientMsg.(*StabilityHeader); ok {
			emitStabilityHeaderRejectedEvent(ctx, clientID, header, err)
		}
	}
	return err
}

func (l LightClientModule) CheckForMisbehaviour(ctx sdk.Context, clientID string, clientMsg exported.ClientMessage) bool {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		panic(errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID))
	}
	return clientState.CheckForMisbehaviour(ctx, l.cdc, clientStore, clientMsg)
}

func (l LightClientModule) UpdateStateOnMisbehaviour(ctx sdk.Context, clientID string, _ exported.ClientMessage) {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		panic(errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID))
	}
	frozenHeight := FrozenHeight
	clientState.FrozenHeight = frozenHeight
	setClientState(clientStore, l.cdc, clientState)
	emitStabilityClientFrozenEvent(ctx, clientID, frozenHeight)
}

func (l LightClientModule) UpdateState(ctx sdk.Context, clientID string, clientMsg exported.ClientMessage) []exported.Height {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		panic(errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID))
	}
	previousEpoch := clientState.CurrentEpoch
	updatedHeights := clientState.UpdateState(ctx, l.cdc, clientStore, clientMsg)

	header, ok := clientMsg.(*StabilityHeader)
	if !ok || len(updatedHeights) == 0 {
		return updatedHeights
	}

	consensusState, found := GetConsensusState(clientStore, l.cdc, updatedHeights[0])
	if !found {
		panic(errorsmod.Wrapf(clienttypes.ErrConsensusStateNotFound, "height (%s)", updatedHeights[0]))
	}

	emitStabilityHeaderAcceptedEvent(ctx, clientID, header, clientState, consensusState, previousEpoch)
	return updatedHeights
}

func (l LightClientModule) VerifyMembership(ctx sdk.Context, clientID string, height exported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path exported.Path, value []byte) error {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID)
	}
	return clientState.VerifyMembership(ctx, clientStore, l.cdc, height, delayTimePeriod, delayBlockPeriod, proof, path, value)
}

func (l LightClientModule) VerifyNonMembership(ctx sdk.Context, clientID string, height exported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path exported.Path) error {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID)
	}
	return clientState.VerifyNonMembership(ctx, clientStore, l.cdc, height, delayTimePeriod, delayBlockPeriod, proof, path)
}

func (l LightClientModule) Status(ctx sdk.Context, clientID string) exported.Status {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return exported.Unknown
	}
	return clientState.Status(ctx, clientStore, l.cdc)
}

func (l LightClientModule) LatestHeight(ctx sdk.Context, clientID string) exported.Height {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return clienttypes.ZeroHeight()
	}
	return clientState.GetLatestHeight()
}

func (l LightClientModule) TimestampAtHeight(ctx sdk.Context, clientID string, height exported.Height) (uint64, error) {
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return 0, errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID)
	}
	return clientState.GetTimestampAtHeight(ctx, clientStore, l.cdc, height)
}

func (l LightClientModule) RecoverClient(ctx sdk.Context, clientID, substituteClientID string) error {
	substituteClientType, _, err := clienttypes.ParseClientIdentifier(substituteClientID)
	if err != nil {
		return err
	}
	if substituteClientType != ModuleName {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClientType, "expected: %s, got: %s", ModuleName, substituteClientType)
	}
	clientStore := l.storeProvider.ClientStore(ctx, clientID)
	clientState, found := getClientState(clientStore, l.cdc)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrClientNotFound, clientID)
	}
	substituteClientStore := l.storeProvider.ClientStore(ctx, substituteClientID)
	substituteClient, found := getClientState(substituteClientStore, l.cdc)
	if !found {
		return errorsmod.Wrap(clienttypes.ErrClientNotFound, substituteClientID)
	}
	return clientState.CheckSubstituteAndUpdateState(ctx, l.cdc, clientStore, substituteClientStore, substituteClient)
}

func (l LightClientModule) VerifyUpgradeAndUpdateState(
	ctx sdk.Context,
	clientID string,
	newClient []byte,
	newConsState []byte,
	upgradeClientProof []byte,
	upgradeConsensusStateProof []byte,
) error {
	return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "cannot upgrade stability-scored client")
}
