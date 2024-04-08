package services_mock

import (
	"context"
	pbconnection "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	"github.com/cosmos/cosmos-sdk/types/query"
	client_type "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type ConnectionQueryService struct {
	mock.Mock
}

func (c *ConnectionQueryService) Connection(ctx context.Context, in *pbconnection.QueryConnectionRequest, opts ...grpc.CallOption) (*pbconnection.QueryConnectionResponse, error) {
	args := c.Called(ctx, in, opts)
	outVersion := &pbconnection.Version{
		Identifier: args.String(0),
		Features:   []string{args.String(1)},
	}
	outConnection := &pbconnection.ConnectionEnd{
		ClientId: args.String(2),
		Versions: []*pbconnection.Version{outVersion},
		State:    pbconnection.State(args.Int(3)),
		Counterparty: &pbconnection.Counterparty{
			ClientId:     args.String(4),
			ConnectionId: args.String(5),
			Prefix: &types.MerklePrefix{
				KeyPrefix: []byte(args.String(6)),
			},
		},
		DelayPeriod: uint64(args.Int(7)),
	}
	return &pbconnection.QueryConnectionResponse{
		Connection: outConnection,
		Proof:      []byte(args.String(8)),
		ProofHeight: &client_type.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(9)),
		},
	}, args.Error(10)
}

func (c *ConnectionQueryService) Connections(ctx context.Context, in *pbconnection.QueryConnectionsRequest, opts ...grpc.CallOption) (*pbconnection.QueryConnectionsResponse, error) {
	args := c.Called(ctx, in, opts)
	outVersion := &pbconnection.Version{
		Identifier: args.String(0),
		Features:   []string{args.String(1)},
	}
	outConnection := &pbconnection.IdentifiedConnection{
		Id:       args.String(2),
		ClientId: args.String(3),
		Versions: []*pbconnection.Version{outVersion},
		State:    pbconnection.State(args.Int(4)),
		Counterparty: &pbconnection.Counterparty{
			ClientId:     args.String(5),
			ConnectionId: args.String(6),
			Prefix: &types.MerklePrefix{
				KeyPrefix: []byte(args.String(7)),
			},
		},
		DelayPeriod: uint64(args.Int(8)),
	}
	return &pbconnection.QueryConnectionsResponse{
		Connections: []*pbconnection.IdentifiedConnection{outConnection},
		Pagination: &query.PageResponse{
			NextKey: []byte(args.String(9)),
			Total:   uint64(args.Int(10)),
		},
		Height: &client_type.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(11)),
		},
	}, args.Error(12)
}

func (c *ConnectionQueryService) ClientConnections(ctx context.Context, in *pbconnection.QueryClientConnectionsRequest, opts ...grpc.CallOption) (*pbconnection.QueryClientConnectionsResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ConnectionQueryService) ConnectionClientState(ctx context.Context, in *pbconnection.QueryConnectionClientStateRequest, opts ...grpc.CallOption) (*pbconnection.QueryConnectionClientStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ConnectionQueryService) ConnectionConsensusState(ctx context.Context, in *pbconnection.QueryConnectionConsensusStateRequest, opts ...grpc.CallOption) (*pbconnection.QueryConnectionConsensusStateResponse, error) {
	//TODO implement me
	panic("implement me")
}

func (c *ConnectionQueryService) ConnectionParams(ctx context.Context, in *pbconnection.QueryConnectionParamsRequest, opts ...grpc.CallOption) (*pbconnection.QueryConnectionParamsResponse, error) {
	//TODO implement me
	panic("implement me")
}
