package services_mock

import (
	"context"
	pbconnection "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/anypb"
)

type ConnectionMsgServiceMock struct {
	mock.Mock
}

func (c *ConnectionMsgServiceMock) ConnectionOpenInit(ctx context.Context, in *pbconnection.MsgConnectionOpenInit, opts ...grpc.CallOption) (*pbconnection.MsgConnectionOpenInitResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbconnection.MsgConnectionOpenInitResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ConnectionMsgServiceMock) ConnectionOpenTry(ctx context.Context, in *pbconnection.MsgConnectionOpenTry, opts ...grpc.CallOption) (*pbconnection.MsgConnectionOpenTryResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbconnection.MsgConnectionOpenTryResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ConnectionMsgServiceMock) ConnectionOpenAck(ctx context.Context, in *pbconnection.MsgConnectionOpenAck, opts ...grpc.CallOption) (*pbconnection.MsgConnectionOpenAckResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbconnection.MsgConnectionOpenAckResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ConnectionMsgServiceMock) ConnectionOpenConfirm(ctx context.Context, in *pbconnection.MsgConnectionOpenConfirm, opts ...grpc.CallOption) (*pbconnection.MsgConnectionOpenConfirmResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbconnection.MsgConnectionOpenConfirmResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}
