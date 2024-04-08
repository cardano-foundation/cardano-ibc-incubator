package cardano

import (
	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"

	errorsmod "cosmossdk.io/errors"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

// VerifyUpgradeAndUpdateState checks if the upgraded client has been committed by the current client
// It will zero out all client-specific fields (e.g. TrustingPeriod) and verify all data
// in client state that must be the same across all valid Cardano clients for the new chain.
// VerifyUpgrade will return an error if:
// - the upgradedClient is not a Cardano ClientState
// - the latest height of the client state does not have the same revision number or has a greater
// height than the committed client.
//   - the height of upgraded client is not greater than that of current client
//   - the latest height of the new client does not match or is greater than the height in committed client
//   - any Cardano chain specified parameter in upgraded client such as ChainID, UnbondingPeriod,
//     and ProofSpecs do not match parameters set by committed client
func (cs ClientState) VerifyUpgradeAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore,
	upgradedClient exported.ClientState, upgradedConsState exported.ConsensusState,
	proofUpgradeClient, proofUpgradeConsState []byte,
) error {
	return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "VerifyUpgradeAndUpdateState: not implemented")
}

// construct MerklePath for the committed client from upgradePath
//func constructUpgradeClientMerklePath(upgradePath []string, lastHeight exported.Height) commitmenttypes.MerklePath {
//	// copy all elements from upgradePath except final element
//	clientPath := make([]string, len(upgradePath)-1)
//	copy(clientPath, upgradePath)
//
//	// append lastHeight and `upgradedClient` to last key of upgradePath and use as lastKey of clientPath
//	// this will create the IAVL key that is used to store client in upgrade store
//	lastKey := upgradePath[len(upgradePath)-1]
//	appendedKey := fmt.Sprintf("%s/%d/%s", lastKey, lastHeight.GetRevisionHeight(), upgradetypes.KeyUpgradedClient)
//
//	clientPath = append(clientPath, appendedKey)
//	return commitmenttypes.NewMerklePath(clientPath...)
//}

// construct MerklePath for the committed consensus state from upgradePath
//func constructUpgradeConsStateMerklePath(upgradePath []string, lastHeight exported.Height) commitmenttypes.MerklePath {
//	// copy all elements from upgradePath except final element
//	consPath := make([]string, len(upgradePath)-1)
//	copy(consPath, upgradePath)
//
//	// append lastHeight and `upgradedClient` to last key of upgradePath and use as lastKey of clientPath
//	// this will create the IAVL key that is used to store client in upgrade store
//	lastKey := upgradePath[len(upgradePath)-1]
//	appendedKey := fmt.Sprintf("%s/%d/%s", lastKey, lastHeight.GetRevisionHeight(), upgradetypes.KeyUpgradedConsState)
//
//	consPath = append(consPath, appendedKey)
//	return commitmenttypes.NewMerklePath(consPath...)
//}
