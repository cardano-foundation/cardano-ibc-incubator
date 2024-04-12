package services_mock

import (
	"context"
	pb "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/tx-cardano"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type TransactionClient struct {
	mock.Mock
}

func (t *TransactionClient) SignAndSubmitTx(ctx context.Context, in *pb.SignAndSubmitTxRequest, opts ...grpc.CallOption) (*pb.SignAndSubmitTxResponse, error) {
	args := t.Called(ctx, in, opts)
	return &pb.SignAndSubmitTxResponse{
		TransactionId: args.String(0),
	}, args.Error(1)
}
