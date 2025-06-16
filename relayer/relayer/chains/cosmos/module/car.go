package module

import (
	"time"

	errorsmod "cosmossdk.io/errors"
	"github.com/cosmos/cosmos-sdk/codec"
	storetypes "github.com/cosmos/cosmos-sdk/store/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v7/modules/core/exported"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)
var _ exported.ConsensusState = (*ConsensusState)(nil)

func (ClientState) ClientType() string {
	return "099-cardano"
}

// GetLatestHeight returns latest block height.
func (cs ClientState) GetLatestHeight() exported.Height {
	return cs.LatestHeight
}
func (ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore storetypes.KVStore, msg exported.ClientMessage) bool {
	return true
}
func (cs ClientState) CheckSubstituteAndUpdateState(
	ctx sdk.Context, cdc codec.BinaryCodec, subjectClientStore,
	substituteClientStore storetypes.KVStore, substituteClient exported.ClientState,
) error {
	return nil
}

func (ConsensusState) ClientType() string {
	return ModuleName
}

// GetTimestamp returns block time in nanoseconds of the header that created consensus state
func (cs ConsensusState) GetTimestamp() uint64 {
	return uint64(cs.Timestamp * uint64(time.Second))
}

// GetTimestamp returns block time in nanoseconds of the header that created consensus state
func (cs ConsensusState) GetTime() time.Time {
	return time.Unix(int64(cs.Timestamp), 0)
}

func (cs ConsensusState) ValidateBasic() error {
	if cs.Slot == 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "slot cannot be zero")
	}

	if cs.Timestamp <= 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "timestamp must be a positive Unix time")
	}

	return nil
}

// Validate performs a basic validation of the client state fields.
func (cs ClientState) Validate() error {
	return nil
}

func (cs ClientState) Status(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec) ibcexported.Status {
	return ""
}

func (cs ClientState) ExportMetadata(clientStore sdk.KVStore) []ibcexported.GenesisMetadata {
	return nil
}

func (cs ClientState) ZeroCustomFields() ibcexported.ClientState {
	return nil
}

func (cs ClientState) GetTimestampAtHeight(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height ibcexported.Height) (uint64, error) {
	return 0, nil
}

func (cs ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, consensusState ibcexported.ConsensusState) error {
	return nil
}

func (cs ClientState) VerifyMembership(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height ibcexported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path ibcexported.Path, value []byte) error {
	return nil
}

func (cs ClientState) VerifyNonMembership(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height ibcexported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path ibcexported.Path) error {
	return nil
}

func (cs ClientState) VerifyClientMessage(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg ibcexported.ClientMessage) error {
	return nil
}

func (cs ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg ibcexported.ClientMessage) {

}

func (cs ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg ibcexported.ClientMessage) []ibcexported.Height {
	return nil
}

func (cs ClientState) VerifyUpgradeAndUpdateState(ctx sdk.Context, cdc codec.BinaryCodec, store sdk.KVStore, newClient ibcexported.ClientState, newConsState ibcexported.ConsensusState, proofUpgradeClient, proofUpgradeConsState []byte) error {
	return nil
}
