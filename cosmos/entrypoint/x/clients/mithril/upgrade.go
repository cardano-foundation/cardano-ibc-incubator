package mithril

import (
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	errorsmod "cosmossdk.io/errors"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// VerifyUpgradeAndUpdateState verifies an upgraded ClientState and ConsensusState with their respective proofs,
// then updates the client state accordingly. Used to upgrade clients given an upgraded ClientState and ConsensusState.
func (cs ClientState) VerifyUpgradeAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	upgradedClient exported.ClientState, upgradedConsState exported.ConsensusState,
	proofUpgradeClient, proofUpgradeConsState []byte,
) error {
	return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "VerifyUpgradeAndUpdateState: not implemented")
}
