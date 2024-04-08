package services_mock

import (
	"context"
	"github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/anypb"
)

type ClientQueryService struct {
	mock.Mock
}

func (g *ClientQueryService) ClientState(ctx context.Context, in *types.QueryClientStateRequest, opts ...grpc.CallOption) (*types.QueryClientStateResponse, error) {
	args := g.Called(ctx, in, opts)
	return &types.QueryClientStateResponse{
		ClientState: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
		Proof: []byte(args.String(2)),
		ProofHeight: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(3)),
		},
	}, args.Error(4)
}

func (g *ClientQueryService) ClientStates(ctx context.Context, in *types.QueryClientStatesRequest, opts ...grpc.CallOption) (*types.QueryClientStatesResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) ConsensusState(ctx context.Context, in *types.QueryConsensusStateRequest, opts ...grpc.CallOption) (*types.QueryConsensusStateResponse, error) {
	args := g.Called(ctx, in, opts)
	return &types.QueryConsensusStateResponse{
		ConsensusState: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
		Proof: []byte(args.String(2)),
		ProofHeight: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(3)),
		},
	}, args.Error(4)
}

func (g *ClientQueryService) ConsensusStates(ctx context.Context, in *types.QueryConsensusStatesRequest, opts ...grpc.CallOption) (*types.QueryConsensusStatesResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) ConsensusStateHeights(ctx context.Context, in *types.QueryConsensusStateHeightsRequest, opts ...grpc.CallOption) (*types.QueryConsensusStateHeightsResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) ClientStatus(ctx context.Context, in *types.QueryClientStatusRequest, opts ...grpc.CallOption) (*types.QueryClientStatusResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) ClientParams(ctx context.Context, in *types.QueryClientParamsRequest, opts ...grpc.CallOption) (*types.QueryClientParamsResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) UpgradedClientState(ctx context.Context, in *types.QueryUpgradedClientStateRequest, opts ...grpc.CallOption) (*types.QueryUpgradedClientStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) UpgradedConsensusState(ctx context.Context, in *types.QueryUpgradedConsensusStateRequest, opts ...grpc.CallOption) (*types.QueryUpgradedConsensusStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (g *ClientQueryService) NewClient(ctx context.Context, in *types.QueryNewClientRequest, opts ...grpc.CallOption) (*types.QueryNewClientResponse, error) {
	args := g.Called(ctx, in, opts)
	return &types.QueryNewClientResponse{
		ClientState: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
		ConsensusState: &anypb.Any{
			TypeUrl: args.String(2),
			Value:   []byte(args.String(3)),
		},
	}, args.Error(4)
}

func (g *ClientQueryService) BlockData(ctx context.Context, in *types.QueryBlockDataRequest, opts ...grpc.CallOption) (*types.QueryBlockDataResponse, error) {
	args := g.Called(ctx, in, opts)
	return &types.QueryBlockDataResponse{
		BlockData: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (g *ClientQueryService) LatestHeight(ctx context.Context, in *types.QueryLatestHeightRequest, opts ...grpc.CallOption) (*types.QueryLatestHeightResponse, error) {
	args := g.Called(ctx, in, opts)
	return &types.QueryLatestHeightResponse{
		Height: uint64(args.Int(0)),
	}, args.Error(1)
}
