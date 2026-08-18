package mithril

import (
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	errorsmod "cosmossdk.io/errors"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

// VerifyUpgradeAndUpdateState returns an error because Mithril client upgrades
// are not supported yet.
func (cs ClientState) VerifyUpgradeAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	upgradedClient exported.ClientState, upgradedConsState exported.ConsensusState,
	proofUpgradeClient, proofUpgradeConsState []byte,
) error {
	return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "cannot upgrade mithril client")
}
