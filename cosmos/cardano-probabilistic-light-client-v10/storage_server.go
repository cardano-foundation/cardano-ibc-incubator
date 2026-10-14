package probabilistic

import (
	"context"
	"fmt"

	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

type SnapshotStoreProvider interface {
	ClientStore(sdk.Context, string) storetypes.KVStore
}
type storageServer struct {
	cdc      codec.BinaryCodec
	provider SnapshotStoreProvider
}

func (s storageServer) Verification(goCtx context.Context, request *QueryVerificationRequest) (*QueryVerificationResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("missing verification query")
	}
	raw, err := state.QueryVerification(coreContext(sdk.UnwrapSDKContext(goCtx)), coreCodec{s.cdc}, toCoreQueryVerificationRequest(request))
	if err != nil {
		return nil, err
	}
	return &QueryVerificationResponse{Data: raw}, nil
}
func (message *MsgContinueClient) ValidateBasic() error {
	if _, err := sdk.AccAddressFromBech32(message.Signer); err != nil {
		return err
	}
	if message.ClientId == "" {
		return fmt.Errorf("missing client id")
	}
	if message.Operation != state.ObservationCleanup && message.Operation != state.ObservationContinueRecovery {
		return fmt.Errorf("operation is not permissionless maintenance")
	}
	return nil
}
func (message *MsgContinueClient) GetSigners() []sdk.AccAddress {
	address, err := sdk.AccAddressFromBech32(message.Signer)
	if err != nil {
		panic(err)
	}
	return []sdk.AccAddress{address}
}
func (s storageServer) ContinueClient(goCtx context.Context, request *MsgContinueClient) (*MsgContinueClientResponse, error) {
	if request == nil {
		return nil, fmt.Errorf("missing maintenance request")
	}
	if err := request.ValidateBasic(); err != nil {
		return nil, err
	}
	ctx := sdk.UnwrapSDKContext(goCtx)
	private := s.provider.ClientStore(ctx, request.ClientId)
	client, found := getClientState(private, s.cdc)
	if !found {
		return nil, fmt.Errorf("client does not exist")
	}
	if err := toCoreClientState(client).ContinueMaintenance(coreContext(ctx), coreCodec{s.cdc}, private, request.Operation); err != nil {
		return nil, err
	}
	return &MsgContinueClientResponse{}, nil
}
