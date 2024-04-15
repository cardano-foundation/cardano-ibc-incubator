package services_mock

import (
	"context"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/anypb"
)

type ChannelMsgServiceMock struct {
	mock.Mock
}

func (c *ChannelMsgServiceMock) Transfer(ctx context.Context, in *pbchannel.MsgTransfer, opts ...grpc.CallOption) (*pbchannel.MsgTransferResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgTransferResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ChannelMsgServiceMock) TimeoutRefresh(ctx context.Context, in *pbchannel.MsgTimeoutRefresh, opts ...grpc.CallOption) (*pbchannel.MsgTimeoutRefreshResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgTimeoutRefreshResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ChannelMsgServiceMock) ChannelOpenInit(ctx context.Context, in *pbchannel.MsgChannelOpenInit, opts ...grpc.CallOption) (*pbchannel.MsgChannelOpenInitResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgChannelOpenInitResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ChannelMsgServiceMock) ChannelOpenTry(ctx context.Context, in *pbchannel.MsgChannelOpenTry, opts ...grpc.CallOption) (*pbchannel.MsgChannelOpenTryResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelMsgServiceMock) ChannelOpenAck(ctx context.Context, in *pbchannel.MsgChannelOpenAck, opts ...grpc.CallOption) (*pbchannel.MsgChannelOpenAckResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgChannelOpenAckResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ChannelMsgServiceMock) ChannelOpenConfirm(ctx context.Context, in *pbchannel.MsgChannelOpenConfirm, opts ...grpc.CallOption) (*pbchannel.MsgChannelOpenConfirmResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelMsgServiceMock) ChannelCloseInit(ctx context.Context, in *pbchannel.MsgChannelCloseInit, opts ...grpc.CallOption) (*pbchannel.MsgChannelCloseInitResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelMsgServiceMock) ChannelCloseConfirm(ctx context.Context, in *pbchannel.MsgChannelCloseConfirm, opts ...grpc.CallOption) (*pbchannel.MsgChannelCloseConfirmResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelMsgServiceMock) RecvPacket(ctx context.Context, in *pbchannel.MsgRecvPacket, opts ...grpc.CallOption) (*pbchannel.MsgRecvPacketResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgRecvPacketResponse{
		UnsignedTx: &anypb.Any{
			TypeUrl: args.String(0),
			Value:   []byte(args.String(1)),
		},
	}, args.Error(2)
}

func (c *ChannelMsgServiceMock) Timeout(ctx context.Context, in *pbchannel.MsgTimeout, opts ...grpc.CallOption) (*pbchannel.MsgTimeoutResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgTimeoutResponse{
		Result: pbchannel.ResponseResultType(args.Int(0)),
	}, args.Error(1)
}

func (c *ChannelMsgServiceMock) TimeoutOnClose(ctx context.Context, in *pbchannel.MsgTimeoutOnClose, opts ...grpc.CallOption) (*pbchannel.MsgTimeoutOnCloseResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgTimeoutOnCloseResponse{
		Result: pbchannel.ResponseResultType(args.Int(0)),
	}, args.Error(1)
}

func (c *ChannelMsgServiceMock) Acknowledgement(ctx context.Context, in *pbchannel.MsgAcknowledgement, opts ...grpc.CallOption) (*pbchannel.MsgAcknowledgementResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.MsgAcknowledgementResponse{
		Result: pbchannel.ResponseResultType(args.Int(0)),
	}, args.Error(1)
}
