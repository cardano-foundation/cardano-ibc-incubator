package services_mock

import (
	"context"
	pbchannel "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/cosmos/cosmos-sdk/types/query"
	"github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type ChannelQueryService struct {
	mock.Mock
}

func (c *ChannelQueryService) ProofUnreceivedPackets(ctx context.Context, in *pbchannel.QueryProofUnreceivedPacketsRequest, opts ...grpc.CallOption) (*pbchannel.QueryProofUnreceivedPacketsResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.QueryProofUnreceivedPacketsResponse{
		Proof: []byte(args.String(0)),
		ProofHeight: &types.Height{
			RevisionNumber: uint64(args.Int(1)),
			RevisionHeight: uint64(args.Int(2)),
		},
	}, args.Error(3)
}

func (c *ChannelQueryService) Channel(ctx context.Context, in *pbchannel.QueryChannelRequest, opts ...grpc.CallOption) (*pbchannel.QueryChannelResponse, error) {
	args := c.Called(ctx, in, opts)
	outChannel := &pbchannel.Channel{
		State:    pbchannel.State(args.Int(0)),
		Ordering: pbchannel.Order(args.Int(1)),
		Counterparty: &pbchannel.Counterparty{
			PortId:    args.String(2),
			ChannelId: args.String(3),
		},
		ConnectionHops: []string{args.String(4)},
		Version:        args.String(5),
	}
	return &pbchannel.QueryChannelResponse{
		Channel: outChannel,
		Proof:   []byte(args.String(6)),
		ProofHeight: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(7)),
		},
	}, args.Error(8)
}

func (c *ChannelQueryService) Channels(ctx context.Context, in *pbchannel.QueryChannelsRequest, opts ...grpc.CallOption) (*pbchannel.QueryChannelsResponse, error) {
	args := c.Called(ctx, in, opts)
	outChannel := &pbchannel.IdentifiedChannel{
		State:    pbchannel.State(args.Int(0)),
		Ordering: pbchannel.Order(args.Int(1)),
		Counterparty: &pbchannel.Counterparty{
			PortId:    args.String(2),
			ChannelId: args.String(3),
		},
		ConnectionHops: []string{args.String(4)},
		Version:        args.String(5),
		PortId:         args.String(6),
		ChannelId:      args.String(7),
	}
	return &pbchannel.QueryChannelsResponse{
		Channels: []*pbchannel.IdentifiedChannel{outChannel},
		Pagination: &query.PageResponse{
			NextKey: []byte(args.String(8)),
			Total:   uint64(args.Int(9)),
		},
		Height: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(10)),
		},
	}, args.Error(11)
}

func (c *ChannelQueryService) ConnectionChannels(ctx context.Context, in *pbchannel.QueryConnectionChannelsRequest, opts ...grpc.CallOption) (*pbchannel.QueryConnectionChannelsResponse, error) {
	args := c.Called(ctx, in, opts)
	outChannel := &pbchannel.IdentifiedChannel{
		State:    pbchannel.State(args.Int(0)),
		Ordering: pbchannel.Order(args.Int(1)),
		Counterparty: &pbchannel.Counterparty{
			PortId:    args.String(2),
			ChannelId: args.String(3),
		},
		ConnectionHops: []string{args.String(4)},
		Version:        args.String(5),
		PortId:         args.String(6),
		ChannelId:      args.String(7),
	}
	return &pbchannel.QueryConnectionChannelsResponse{
		Channels: []*pbchannel.IdentifiedChannel{outChannel},
		Pagination: &query.PageResponse{
			NextKey: []byte(args.String(8)),
			Total:   uint64(args.Int(9)),
		},
		Height: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(10)),
		},
	}, args.Error(11)
}

func (c *ChannelQueryService) ChannelClientState(ctx context.Context, in *pbchannel.QueryChannelClientStateRequest, opts ...grpc.CallOption) (*pbchannel.QueryChannelClientStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelQueryService) ChannelConsensusState(ctx context.Context, in *pbchannel.QueryChannelConsensusStateRequest, opts ...grpc.CallOption) (*pbchannel.QueryChannelConsensusStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelQueryService) PacketCommitment(ctx context.Context, in *pbchannel.QueryPacketCommitmentRequest, opts ...grpc.CallOption) (*pbchannel.QueryPacketCommitmentResponse, error) {
	args := c.Called(ctx, in, opts)

	return &pbchannel.QueryPacketCommitmentResponse{
		Commitment: []byte(args.String(0)),
		Proof:      []byte(args.String(1)),
		ProofHeight: &types.Height{
			RevisionNumber: uint64(args.Int(2)),
			RevisionHeight: uint64(args.Int(3)),
		},
	}, args.Error(4)
}

func (c *ChannelQueryService) PacketCommitments(ctx context.Context, in *pbchannel.QueryPacketCommitmentsRequest, opts ...grpc.CallOption) (*pbchannel.QueryPacketCommitmentsResponse, error) {
	args := c.Called(ctx, in, opts)
	outPacketState := &pbchannel.PacketState{
		PortId:    args.String(0),
		ChannelId: args.String(1),
		Sequence:  uint64(args.Int(2)),
		Data:      []byte(args.String(3)),
	}
	return &pbchannel.QueryPacketCommitmentsResponse{
		Commitments: []*pbchannel.PacketState{outPacketState},
		Pagination: &query.PageResponse{
			NextKey: []byte(args.String(4)),
			Total:   uint64(args.Int(5)),
		},
		Height: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(6)),
		},
	}, args.Error(7)
}

func (c *ChannelQueryService) PacketReceipt(ctx context.Context, in *pbchannel.QueryPacketReceiptRequest, opts ...grpc.CallOption) (*pbchannel.QueryPacketReceiptResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ChannelQueryService) PacketAcknowledgement(ctx context.Context, in *pbchannel.QueryPacketAcknowledgementRequest, opts ...grpc.CallOption) (*pbchannel.QueryPacketAcknowledgementResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.QueryPacketAcknowledgementResponse{
		Acknowledgement: []byte(args.String(0)),
		Proof:           []byte(args.String(1)),
		ProofHeight: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(2)),
		},
	}, args.Error(3)
}

func (c *ChannelQueryService) PacketAcknowledgements(ctx context.Context, in *pbchannel.QueryPacketAcknowledgementsRequest, opts ...grpc.CallOption) (*pbchannel.QueryPacketAcknowledgementsResponse, error) {
	args := c.Called(ctx, in, opts)
	outPacketState := &pbchannel.PacketState{
		PortId:    args.String(0),
		ChannelId: args.String(1),
		Sequence:  uint64(args.Int(2)),
		Data:      []byte(args.String(3)),
	}
	return &pbchannel.QueryPacketAcknowledgementsResponse{
		Acknowledgements: []*pbchannel.PacketState{outPacketState},
		Pagination: &query.PageResponse{
			NextKey: []byte(args.String(4)),
			Total:   uint64(args.Int(5)),
		},
		Height: &types.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(6)),
		},
	}, args.Error(7)
}

func (c *ChannelQueryService) UnreceivedPackets(ctx context.Context, in *pbchannel.QueryUnreceivedPacketsRequest, opts ...grpc.CallOption) (*pbchannel.QueryUnreceivedPacketsResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.QueryUnreceivedPacketsResponse{
		Sequences: []uint64{},
		Height: &types.Height{
			RevisionNumber: uint64(args.Int(0)),
			RevisionHeight: uint64(args.Int(1)),
		},
	}, args.Error(2)
}

func (c *ChannelQueryService) UnreceivedAcks(ctx context.Context, in *pbchannel.QueryUnreceivedAcksRequest, opts ...grpc.CallOption) (*pbchannel.QueryUnreceivedAcksResponse, error) {
	args := c.Called(ctx, in, opts)
	return &pbchannel.QueryUnreceivedAcksResponse{
		Sequences: []uint64{uint64(args.Int(0))},
		Height: &types.Height{
			RevisionNumber: uint64(args.Int(1)),
			RevisionHeight: uint64(args.Int(2)),
		},
	}, args.Error(3)
}

func (c *ChannelQueryService) NextSequenceReceive(ctx context.Context, in *pbchannel.QueryNextSequenceReceiveRequest, opts ...grpc.CallOption) (*pbchannel.QueryNextSequenceReceiveResponse, error) {
	//TODO implement me
	panic("implement me")
}
