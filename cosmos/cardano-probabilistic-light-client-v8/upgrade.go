package probabilistic

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

func (ClientState) VerifyUpgradeAndUpdateState(
	sdk.Context,
	codec.BinaryCodec,
	storetypes.KVStore,
	exported.ClientState,
	exported.ConsensusState,
	[]byte,
	[]byte,
) error {
	return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "cannot upgrade probabilistic client")
}
