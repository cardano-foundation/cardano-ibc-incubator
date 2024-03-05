package services

import (
	"context"
	"fmt"
	"strings"

	pbclient "git02.smartosc.com/cardano/ibc-sidechain/relayer/proto/cardano/gateway/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/cosmos/cosmos-sdk/codec/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	any1 "github.com/golang/protobuf/ptypes/any"
	"google.golang.org/grpc"
)

type GatewayService interface {
}

type Gateway struct {
	QueryProvider pbclient.QueryClient
	MsgProvider   pbclient.MsgClient
}

func (gw *Gateway) NewGateWayService(address string) error {
	if strings.HasPrefix(address, "http://") {
		address = strings.TrimPrefix(address, "http://")
	}
	conn, err := grpc.Dial(address, grpc.WithInsecure())
	if err != nil {
		return err
	}

	queryService := pbclient.NewQueryClient(conn)
	msgService := pbclient.NewMsgClient(conn)
	gw.QueryProvider = queryService
	gw.MsgProvider = msgService

	return nil
}

func (gw *Gateway) GetLastHeight() (uint64, error) {
	//res, err := gw.QueryProvider.QueryLastestHeight(context.Background(), &pb.MsgGetLastHeightRequest{})
	res, err := gw.QueryProvider.LatestHeight(context.Background(), &pbclient.QueryLatestHeightRequest{})
	if err != nil {
		return 0, err
	}
	return res.Height, nil
}

func (gw *Gateway) QueryClientState(height uint64) (*pbclient.QueryClientStateResponse, error) {
	req := &pbclient.QueryClientStateRequest{
		Height: height,
	}
	res, err := gw.QueryProvider.ClientState(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryConsensusState(height uint64) (*pbclient.QueryConsensusStateResponse, error) {
	req := &pbclient.QueryConsensusStateRequest{
		Height: height,
	}
	res, err := gw.QueryProvider.ConsensusState(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) CreateClient(ctx context.Context, clientState *types.Any, consensusState *types.Any) (*pbclient.MsgCreateClientResponse, error) {

	req := &pbclient.MsgCreateClient{

		ClientState: &any1.Any{
			TypeUrl: clientState.TypeUrl,
			Value:   clientState.Value,
		},
		ConsensusState: &any1.Any{
			TypeUrl: consensusState.TypeUrl,
			Value:   consensusState.Value,
		},
		Signer: "",
	}

	res, err := gw.MsgProvider.CreateClient(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryCardanoState(height uint64) (*pbclient.QueryNewClientResponse, error) {
	req := &pbclient.QueryNewClientRequest{
		Height: height,
	}
	res, err := gw.QueryProvider.NewClient(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryBlockData(ctx context.Context, height uint64) (*pbclient.QueryBlockDataResponse, error) {
	req := &pbclient.QueryBlockDataRequest{
		Height: height,
	}
	res, err := gw.QueryProvider.BlockData(ctx, req)
	fmt.Println("Query Block Data : ", height, res)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) UpdateClient(ctx context.Context, msg clienttypes.MsgUpdateClient) (*pbclient.MsgUpdateClientResponse, error) {

	req := &pbclient.MsgUpdateClient{
		ClientId: msg.ClientId,
		ClientMessage: &any1.Any{
			TypeUrl: msg.ClientMessage.TypeUrl,
			Value:   msg.ClientMessage.Value,
		},
		Signer: msg.Signer,
	}
	res, err := gw.MsgProvider.UpdateClient(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}
