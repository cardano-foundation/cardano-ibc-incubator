package services_mock

import (
	"context"
	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	client_type "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type TypeProvider struct {
	mock.Mock
}

func (t *TypeProvider) BlockResults(ctx context.Context, in *ibcclient.QueryBlockResultsRequest, opts ...grpc.CallOption) (*ibcclient.QueryBlockResultsResponse, error) {
	args := t.Called(ctx, in, opts)
	outEventAttribute := &ibcclient.EventAttribute{
		Key:   args.String(0),
		Value: args.String(1),
		Index: args.Bool(2),
	}
	outEvent := &ibcclient.Event{
		Type:           args.String(3),
		EventAttribute: []*ibcclient.EventAttribute{outEventAttribute},
	}
	outTx := &ibcclient.ResponseDeliverTx{
		Code:   uint32(args.Int(4)),
		Events: []*ibcclient.Event{outEvent},
	}
	outBlockResult := &ibcclient.ResultBlockResults{
		Height: &client_type.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(args.Int(5)),
		},
		TxsResults: []*ibcclient.ResponseDeliverTx{outTx},
	}
	return &ibcclient.QueryBlockResultsResponse{
		BlockResults: outBlockResult,
	}, args.Error(6)
}

func (t *TypeProvider) BlockSearch(ctx context.Context, in *ibcclient.QueryBlockSearchRequest, opts ...grpc.CallOption) (*ibcclient.QueryBlockSearchResponse, error) {
	args := t.Called(ctx, in, opts)
	return &ibcclient.QueryBlockSearchResponse{
		Blocks: []*ibcclient.ResultBlockSearch{{
			BlockId: uint64(args.Int(0)),
			Block: &ibcclient.BlockInfo{
				Height: int64(args.Int(1)),
			},
		}},
		TotalCount: uint64(args.Int(2)),
	}, args.Error(3)
}

func (t *TypeProvider) TransactionByHash(ctx context.Context, in *ibcclient.QueryTransactionByHashRequest, opts ...grpc.CallOption) (*ibcclient.QueryTransactionByHashResponse, error) {
	args := t.Called(ctx, in, opts)
	return &ibcclient.QueryTransactionByHashResponse{
		Hash:   args.String(0),
		Height: uint64(args.Int(1)),
		GasFee: uint64(args.Int(2)),
		TxSize: uint64(args.Int(3)),
	}, args.Error(4)
}
