package probabilistic

import (
	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
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
	return errorsmod.Wrap(
		clienttypes.ErrInvalidUpgradeClient,
		"MsgUpgradeClient is intentionally unsupported for the Cardano probabilistic light client: Cardano does not use Cosmos-style chain revisions or block-height resets across hard forks, and this client does not define an authenticated on-chain upgrade commitment authorizing client-state replacement",
	)
}
