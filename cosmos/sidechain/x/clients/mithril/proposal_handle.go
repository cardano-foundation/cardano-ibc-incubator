package mithril

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"

	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// CheckSubstituteAndUpdateState is used to recover an expired or frozen client by updating with a substitute client.
// It verifies that the substitute may be used to update the subject client.
func (cs ClientState) CheckSubstituteAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, subjectClientStore,
	substituteClientStore storetypes.KVStore, substituteClient exported.ClientState,
) error {
	return errorsmod.Wrap(clienttypes.ErrUpdateClientFailed, "CheckSubstituteAndUpdateState: not implemented")
}
