package services_mock

import (
	"context"
	pb "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/tx-cardano"
	"github.com/stretchr/testify/mock"
	"google.golang.org/grpc"
)

type KeyClient struct {
	mock.Mock
}

func (k *KeyClient) AddKey(ctx context.Context, in *pb.AddKeyRequest, opts ...grpc.CallOption) (*pb.AddKeyResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.AddKeyResponse{
		Address:  args.String(0),
		Mnemonic: args.String(1),
	}, args.Error(2)
}

func (k *KeyClient) ShowAddress(ctx context.Context, in *pb.ShowAddressRequest, opts ...grpc.CallOption) (*pb.ShowAddressResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.ShowAddressResponse{
		Address: args.String(0),
	}, args.Error(1)
}

func (k *KeyClient) DeleteKey(ctx context.Context, in *pb.DeleteKeyRequest, opts ...grpc.CallOption) (*pb.DeleteKeyResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.DeleteKeyResponse{}, args.Error(0)
}

func (k *KeyClient) KeyExist(ctx context.Context, in *pb.KeyExistRequest, opts ...grpc.CallOption) (*pb.KeyExistResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.KeyExistResponse{
		Exist: args.Bool(0),
	}, args.Error(1)
}

func (k *KeyClient) ListAddresses(ctx context.Context, in *pb.ListAddressesRequest, opts ...grpc.CallOption) (*pb.ListAddressesResponse, error) {
	args := k.Called(ctx, in, opts)
	outAddressInfo := &pb.AddressInfo{
		KeyName: args.String(0),
		Address: args.String(1),
	}
	return &pb.ListAddressesResponse{
		Addresses: []*pb.AddressInfo{outAddressInfo},
	}, args.Error(2)
}

func (k *KeyClient) KeyFromKeyOrAddress(ctx context.Context, in *pb.KeyFromKeyOrAddressRequest, opts ...grpc.CallOption) (*pb.KeyFromKeyOrAddressResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.KeyFromKeyOrAddressResponse{
		KeyName: args.String(0),
	}, args.Error(1)
}

func (k *KeyClient) RestoreKey(ctx context.Context, in *pb.RestoreKeyRequest, opts ...grpc.CallOption) (*pb.RestoreKeyResponse, error) {
	args := k.Called(ctx, in, opts)
	return &pb.RestoreKeyResponse{
		Address: args.String(0),
	}, args.Error(1)
}
