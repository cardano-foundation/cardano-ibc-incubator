package services

import (
	"context"
	"fmt"
	"os"

	pb "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/tx-cardano"
	"github.com/joho/godotenv"
	"google.golang.org/grpc"
)

type TxCardanoService interface {
	NewTxCardanoService() error
	SubmitTx(ctx context.Context, txHexString string) (string, error)
	GetAddress(ctx context.Context) (string, error)
}

type TxCardano struct {
	TransactionClient pb.TransactionServiceClient
	KeyClient         pb.KeyServiceClient
	ConfigClient      pb.ConfigServiceClient
}

func NewTxCardanoService() (*TxCardano, error) {
	godotenv.Load()

	host := os.Getenv("TX_CARDANO_HOST")
	port := os.Getenv("TX_CARDANO_PORT")
	if host == "" || port == "" {
		return nil, fmt.Errorf("environment variables TX_CARDANO_HOST or TX_CARDANO_PORT not set")
	}

	address := host + ":" + port
	conn, err := grpc.Dial(address, grpc.WithInsecure())
	if err != nil {
		return nil, fmt.Errorf("failed to dial GRPC server: %v", err)
	}

	transactionClient := pb.NewTransactionServiceClient(conn)
	keyClient := pb.NewKeyServiceClient(conn)
	configClient := pb.NewConfigServiceClient(conn)

	return &TxCardano{
		TransactionClient: transactionClient,
		KeyClient:         keyClient,
		ConfigClient:      configClient,
	}, nil
}

func (txc *TxCardano) SignAndSubmitTx(ctx context.Context, chainId string, txHexString []byte) (string, error) {
	signTxReq := &pb.SignAndSubmitTxRequest{
		ChainId:              chainId,
		TransactionHexString: txHexString,
	}
	res, err := txc.TransactionClient.SignAndSubmitTx(ctx, signTxReq)
	if err != nil {
		return "", err
	}

	return res.TransactionId, nil
}

func (txc *TxCardano) AddKey(ctx context.Context, keyName string, chainName string) (string, error) {
	addKeyReq := &pb.AddKeyRequest{
		KeyName: keyName,
		ChainId: chainName,
	}

	res, err := txc.KeyClient.AddKey(ctx, addKeyReq)
	if err != nil {
		return "", err
	}

	return res.Address, nil
}

func (txc *TxCardano) ShowAddress(ctx context.Context, keyName string, chainId string) (string, error) {
	showAddressReq := &pb.ShowAddressRequest{
		KeyName: keyName,
		ChainId: chainId,
	}

	res, err := txc.KeyClient.ShowAddress(ctx, showAddressReq)
	if err != nil {
		return "", err
	}

	return res.Address, nil
}

func (txc *TxCardano) DeleteKey(ctx context.Context, keyName string, chainId string) (bool, error) {
	deleteKeyReq := &pb.DeleteKeyRequest{
		KeyName: keyName,
		ChainId: chainId,
	}

	_, err := txc.KeyClient.DeleteKey(ctx, deleteKeyReq)
	if err != nil {
		return false, err
	}

	return true, nil
}

func (txc *TxCardano) KeyExist(ctx context.Context, keyName string, chainId string) (bool, error) {
	keyExistReq := &pb.KeyExistRequest{
		KeyName: keyName,
		ChainId: chainId,
	}

	res, err := txc.KeyClient.KeyExist(ctx, keyExistReq)
	if err != nil {
		return false, err
	}

	return res.Exist, nil
}

func (txc *TxCardano) ListAddresses(ctx context.Context, chainId string) (map[string]string, error) {
	keyExistReq := &pb.ListAddressesRequest{
		ChainId: chainId,
	}
	res, err := txc.KeyClient.ListAddresses(ctx, keyExistReq)
	if err != nil {
		return nil, err
	}
	var keysInfo = map[string]string{}
	for _, address := range res.Addresses {
		keysInfo[address.KeyName] = address.Address
	}
	return keysInfo, nil
}

func (txc *TxCardano) KeyFromKeyOrAddress(ctx context.Context, keyOrAddress string, chainId string) (string, error) {
	req := &pb.KeyFromKeyOrAddressRequest{
		ChainId:      chainId,
		KeyOrAddress: keyOrAddress,
	}
	res, err := txc.KeyClient.KeyFromKeyOrAddress(ctx, req)
	if err != nil {
		return "", err
	}

	return res.KeyName, nil
}

func (txc *TxCardano) RestoreKey(ctx context.Context, keyName, chainId, mnemonic string) (string, error) {
	req := &pb.RestoreKeyRequest{
		KeyName:  keyName,
		ChainId:  chainId,
		Mnemonic: mnemonic,
	}
	res, err := txc.KeyClient.RestoreKey(ctx, req)
	if err != nil {
		return "", err
	}
	return res.Address, nil
}

func (txc *TxCardano) UpdateConfig(ctx context.Context, newPath string) error {
	req := &pb.UpdatePathConfigRequest{
		Path: newPath,
	}

	_, err := txc.ConfigClient.UpdatePathConfig(ctx, req)
	if err != nil {
		return err
	}
	return nil
}

func (txc *TxCardano) ShowConfig(ctx context.Context) (string, error) {
	req := &pb.ShowPathConfigRequest{}

	res, err := txc.ConfigClient.ShowPathConfig(ctx, req)
	if err != nil {
		return "", err
	}
	return res.Path, nil
}
