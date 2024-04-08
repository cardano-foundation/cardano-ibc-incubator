package services

import (
	"context"
	"fmt"
	pb "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/tx-cardano"
	"github.com/cardano/relayer/v1/package/services_mock"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"os"
	"testing"
)

func init() {
	err := os.Chdir("../../")
	newTxc, err := NewTxCardanoService()
	if err != nil {
		panic("fail to setup test")
	}
	txc = newTxc
}

var txc *TxCardano

func TestNewTxCardanoService(t *testing.T) {
	t.Run("NewTxCardanoService Success", func(t *testing.T) {
		err := os.Chdir("../")
		require.NoError(t, err)
		txc, err := NewTxCardanoService()
		require.NoError(t, err)
		require.NotEmpty(t, txc)
	})
}

func TestSignAndSubmitTx(t *testing.T) {
	t.Run("SignAndSubmitTx Success", func(t *testing.T) {
		mockService := new(services_mock.TransactionClient)
		mockService.On("SignAndSubmitTx", context.Background(), &pb.SignAndSubmitTxRequest{
			ChainId:              "chainId",
			TransactionHexString: []byte("txHexString"),
		}, []grpc.CallOption(nil)).Return("txId", nil)
		txc.TransactionClient = mockService

		response, err := txc.SignAndSubmitTx(context.Background(), "chainId", []byte("txHexString"))
		require.NoError(t, err)
		require.NotEmpty(t, response)
		require.Equal(t, "txId", response)
	})

	t.Run("SignAndSubmitTx Fail", func(t *testing.T) {
		mockService := new(services_mock.TransactionClient)
		exErr := fmt.Errorf("SignAndSubmitTx expected error")
		mockService.On("SignAndSubmitTx", context.Background(), &pb.SignAndSubmitTxRequest{
			ChainId:              "chainId",
			TransactionHexString: []byte("txHexString"),
		}, []grpc.CallOption(nil)).Return("txId", exErr)
		txc.TransactionClient = mockService

		response, err := txc.SignAndSubmitTx(context.Background(), "chainId", []byte("txHexString"))
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestAddKey(t *testing.T) {

	t.Run("AddKey Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("AddKey", context.Background(),
			&pb.AddKeyRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("Address", "Mnemonic", nil)
		txc.KeyClient = mockService

		response, err := txc.AddKey(context.Background(), "KeyName", "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("AddKey Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("AddKey expected error")
		mockService.On("AddKey", context.Background(),
			&pb.AddKeyRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("Address", "Mnemonic", exErr)
		txc.KeyClient = mockService

		response, err := txc.AddKey(context.Background(), "KeyName", "ChainId")
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestShowAddress(t *testing.T) {

	t.Run("ShowAddress Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("ShowAddress", context.Background(),
			&pb.ShowAddressRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("Address", nil)

		txc.KeyClient = mockService
		response, err := txc.ShowAddress(context.Background(), "KeyName", "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
		require.Equal(t, "Address", response)
	})

	t.Run("ShowAddress Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("ShowAddress expected error")
		mockService.On("ShowAddress", context.Background(),
			&pb.ShowAddressRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("Address", exErr)

		txc.KeyClient = mockService
		response, err := txc.ShowAddress(context.Background(), "KeyName", "ChainId")
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestDeleteKey(t *testing.T) {

	t.Run("DeleteKey Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("DeleteKey", context.Background(),
			&pb.DeleteKeyRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return(nil)
		txc.KeyClient = mockService
		response, err := txc.DeleteKey(context.Background(), "KeyName", "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
		require.Equal(t, true, response)
	})

	t.Run("DeleteKey Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("DeleteKey expected error")
		mockService.On("DeleteKey", context.Background(),
			&pb.DeleteKeyRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return(exErr)
		txc.KeyClient = mockService
		response, err := txc.DeleteKey(context.Background(), "KeyName", "ChainId")
		require.Error(t, err)
		require.Equal(t, false, response)
	})
}

func TestKeyExist(t *testing.T) {

	t.Run("KeyExist Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("KeyExist", context.Background(),
			&pb.KeyExistRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return(true, nil)
		txc.KeyClient = mockService
		response, err := txc.KeyExist(context.Background(), "KeyName", "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("KeyExist Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("KeyExist expected error")
		mockService.On("KeyExist", context.Background(),
			&pb.KeyExistRequest{
				KeyName: "KeyName",
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return(true, exErr)
		txc.KeyClient = mockService
		response, err := txc.KeyExist(context.Background(), "KeyName", "ChainId")
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestListAddresses(t *testing.T) {

	t.Run("ListAddresses Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("ListAddresses", context.Background(),
			&pb.ListAddressesRequest{
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("KeyName", "Address", nil)
		txc.KeyClient = mockService
		response, err := txc.ListAddresses(context.Background(), "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("ListAddresses Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("ListAddress expected error")
		mockService.On("ListAddresses", context.Background(),
			&pb.ListAddressesRequest{
				ChainId: "ChainId",
			}, []grpc.CallOption(nil)).Return("KeyName", "Address", exErr)
		txc.KeyClient = mockService
		response, err := txc.ListAddresses(context.Background(), "ChainId")
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestKeyFromKeyOrAddress(t *testing.T) {

	t.Run("KeyFromKeyOrAddress Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("KeyFromKeyOrAddress", context.Background(),
			&pb.KeyFromKeyOrAddressRequest{
				ChainId:      "ChainId",
				KeyOrAddress: "KeyOrAddress",
			}, []grpc.CallOption(nil)).Return("KeyName", nil)

		txc.KeyClient = mockService
		response, err := txc.KeyFromKeyOrAddress(context.Background(), "KeyOrAddress", "ChainId")
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
	t.Run("KeyFromKeyOrAddress Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("KeyFromKeyOrAddress expected error")
		mockService.On("KeyFromKeyOrAddress", context.Background(),
			&pb.KeyFromKeyOrAddressRequest{
				ChainId:      "ChainId",
				KeyOrAddress: "KeyOrAddress",
			}, []grpc.CallOption(nil)).Return("KeyName", exErr)

		txc.KeyClient = mockService
		response, err := txc.KeyFromKeyOrAddress(context.Background(), "KeyOrAddress", "ChainId")
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestRestoreKey(t *testing.T) {

	t.Run("RestoreKey Success", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		mockService.On("RestoreKey", context.Background(),
			&pb.RestoreKeyRequest{
				KeyName:  "KeyName",
				ChainId:  "ChainId",
				Mnemonic: "Mnemonic",
			}, []grpc.CallOption(nil)).Return("address", nil)
		txc.KeyClient = mockService

		response, err := txc.RestoreKey(context.Background(), "KeyName", "ChainId", "Mnemonic")
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("RestoreKey Fail", func(t *testing.T) {
		mockService := new(services_mock.KeyClient)
		exErr := fmt.Errorf("RestoreKey expected error")
		mockService.On("RestoreKey", context.Background(),
			&pb.RestoreKeyRequest{
				KeyName:  "KeyName",
				ChainId:  "ChainId",
				Mnemonic: "Mnemonic",
			}, []grpc.CallOption(nil)).Return("address", exErr)
		txc.KeyClient = mockService

		response, err := txc.RestoreKey(context.Background(), "KeyName", "ChainId", "Mnemonic")
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestUpdateConfig(t *testing.T) {
	var testcases = []struct {
		name         string
		ConfigClient error
		exErr        error
	}{
		{
			name:         "success",
			ConfigClient: nil,
			exErr:        nil,
		},
		{
			name:         "fail",
			ConfigClient: fmt.Errorf("ConfigClient"),
			exErr:        fmt.Errorf("ConfigClient"),
		},
	}
	for _, tc := range testcases {

		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			configClient := new(services_mock.ConfigClient)
			configClient.On("UpdatePathConfig", context.Background(),
				&pb.UpdatePathConfigRequest{
					Path: "",
				}, []grpc.CallOption(nil)).Return(tc.ConfigClient)
			txc.ConfigClient = configClient
			err := txc.UpdateConfig(context.Background(), "")
			if err != nil {
				require.Error(t, err, tc.exErr)
			}
		})
	}
}

func TestShowConfig(t *testing.T) {
	var testcases = []struct {
		name         string
		ConfigClient error
		exErr        error
	}{
		{
			name:         "success",
			ConfigClient: nil,
			exErr:        nil,
		},
		{
			name:         "fail",
			ConfigClient: fmt.Errorf("ConfigClient"),
			exErr:        fmt.Errorf("ConfigClient"),
		},
	}
	for _, tc := range testcases {

		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			configClient := new(services_mock.ConfigClient)
			configClient.On("ShowPathConfig", context.Background(),
				&pb.ShowPathConfigRequest{}, []grpc.CallOption(nil)).Return("response", tc.ConfigClient)
			txc.ConfigClient = configClient
			response, err := txc.ShowConfig(context.Background())
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}
