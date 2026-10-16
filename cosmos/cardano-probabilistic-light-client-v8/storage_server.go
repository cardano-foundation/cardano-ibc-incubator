package probabilistic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// QueryKind names the numeric selectors accepted by Verification.
type QueryKind = state.QueryKind

const (
	QueryCheckpoint          = state.QueryCheckpoint
	QueryEffectiveBindings   = state.QueryEffectiveBindings
	QueryStake               = state.QueryStake
	QuerySettlementCredit    = state.QuerySettlementCredit
	QueryPoolProduction      = state.QueryPoolProduction
	QueryCertificateCounters = state.QueryCertificateCounters
	QueryRegistrations       = state.QueryRegistrations
	QueryMarkBindings        = state.QueryMarkBindings
	QuerySession             = state.QuerySession
	QueryReceipt             = state.QueryReceipt
	QueryEpochProposals      = state.QueryEpochProposals
	QueryBootstrapProgress   = state.QueryBootstrapProgress
	QueryReceipts            = state.QueryReceipts
	QueryEpochUsability      = state.QueryEpochUsability
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
	if QueryKind(request.Kind) == QueryEpochUsability {
		ctx := sdk.UnwrapSDKContext(goCtx)
		if request.ClientId == "" || len(request.Namespace) != 32 {
			return nil, fmt.Errorf("epoch usability requires a client id and namespace")
		}
		private := s.provider.ClientStore(ctx, request.ClientId)
		raw := private.Get([]byte("clientState"))
		if len(raw) == 0 || len(raw) > state.MaxClientBytes {
			return nil, fmt.Errorf("client does not exist or is oversized")
		}
		decoded, err := clienttypes.UnmarshalClientState(s.cdc, raw)
		if err != nil {
			return nil, err
		}
		client, ok := decoded.(*ClientState)
		if !ok {
			return nil, fmt.Errorf("client does not support epoch usability")
		}
		if !bytes.Equal(client.StorageNamespace, request.Namespace) || client.VerificationGeneration != request.Generation {
			return nil, fmt.Errorf("epoch usability references a different client or discarded generation")
		}
		readiness, err := toCoreClientState(client).EpochUsability(coreContext(ctx), private, coreCodec{s.cdc}, request.Epoch)
		if err != nil {
			return nil, err
		}
		data, err := json.Marshal(readiness)
		if err != nil {
			return nil, err
		}
		return &QueryVerificationResponse{Data: data}, nil
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
