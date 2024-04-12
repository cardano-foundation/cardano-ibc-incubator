package services_mock

import (
	"context"
	pbclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/anypb"
)

type ClientMsgService struct {
	mock.Mock
}

func (c *ClientMsgService) CreateClient(ctx context.Context, in *pbclient.MsgCreateClient, opts ...grpc.CallOption) (*pbclient.MsgCreateClientResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbclient.MsgCreateClientResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
		ClientId: args.String(2),
	}, args.Error(3)
}

func (c *ClientMsgService) UpdateClient(ctx context.Context, in *pbclient.MsgUpdateClient, opts ...grpc.CallOption) (*pbclient.MsgUpdateClientResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbclient.MsgUpdateClientResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ClientMsgService) UpgradeClient(ctx context.Context, in *pbclient.MsgUpgradeClient, opts ...grpc.CallOption) (*pbclient.MsgUpgradeClientResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ClientMsgService) SubmitMisbehaviour(ctx context.Context, in *pbclient.MsgSubmitMisbehaviour, opts ...grpc.CallOption) (*pbclient.MsgSubmitMisbehaviourResponse, error) {
	//TODO implement me
	panic("implement me")
}
