package services

import (
	"context"
	"fmt"
	"git02.smartosc.com/cardano/ibc-sidechain/relayer/proto/cardano/tx-cardano/pb"
	"github.com/joho/godotenv"
	"os"

	// "github.com/joho/godotenv"
	"google.golang.org/grpc"
	// "os"
)

type TxCardanoService interface {
	NewTxCardanoService() error
	SubmitTx(ctx context.Context, txHexString string) (string, error)
	GetAddress(ctx context.Context) (string, error)
}

type TxCardano struct {
	TransactionClient pb.TransactionServiceClient
	KeyClient         pb.KeyServiceClient
}

func (txc *TxCardano) NewTxCardanoService() error {
	err := godotenv.Load()
	if err != nil {
		return err
	}

	address := os.Getenv("TX_CARDANO_HOST") + ":" + os.Getenv("TX_CARDANO_PORT")
	//address := "localhost:4884"
	conn, err := grpc.Dial(address, grpc.WithInsecure())
	if err != nil {
		return err
	}

	transactionClient := pb.NewTransactionServiceClient(conn)
	keyClient := pb.NewKeyServiceClient(conn)

	txc.TransactionClient = transactionClient
	txc.KeyClient = keyClient

	return nil
}

func (txc *TxCardano) SignAndSubmitTx(ctx context.Context, chainId string, txHexString []byte) (string, error) {
	//signTxReq := &pb.SignAndSubmitTxRequest{
	//	ChainId:              chainId,
	//	TransactionHexString: txHexString,
	//}
	signTxReq := &pb.SignAndSubmitTxRequest{
		ChainId:              chainId,
		TransactionHexString: txHexString,
	}
	res, err := txc.TransactionClient.SignAndSubmitTx(ctx, signTxReq)
	fmt.Println("SignAndSubmit error: ", err)
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
