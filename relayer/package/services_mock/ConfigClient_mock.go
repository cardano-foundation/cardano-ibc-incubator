package services_mock

import (
	"context"
	pb "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/tx-cardano"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type ConfigClient struct {
	mock.Mock
}

func (c ConfigClient) UpdatePathConfig(ctx context.Context, in *pb.UpdatePathConfigRequest, opts ...grpc.CallOption) (*pb.UpdatePathConfigResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pb.UpdatePathConfigResponse{}, args.Error(0)
}

func (c ConfigClient) ShowPathConfig(ctx context.Context, in *pb.ShowPathConfigRequest, opts ...grpc.CallOption) (*pb.ShowPathConfigResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pb.ShowPathConfigResponse{
		Path: args.String(0),
	}, args.Error(1)
}
