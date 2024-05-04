package cardano

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	sdkmath "cosmossdk.io/math"
	pbclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	pbconnection "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	pbclientstruct "github.com/cardano/proto-types/go/sidechain/x/clients/cardano"
	"github.com/cardano/relayer/v1/package/services"
	"github.com/cardano/relayer/v1/package/services_mock"
	"github.com/cardano/relayer/v1/relayer/provider"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/proto/tendermint/version"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	ty "github.com/cometbft/cometbft/types"
	"github.com/cosmos/cosmos-sdk/client/tx"
	sdk "github.com/cosmos/cosmos-sdk/types"

	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"testing"
)

func TestConnectionProof(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
		{
			name:  "fail",
			exErr: fmt.Errorf("expected error"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ConnectionQueryService)
			mockService.On("Connection",
				context.Background(),
				&pbconnection.QueryConnectionRequest{
					ConnectionId: "connectionId",
				}, []grpc.CallOption(nil)).Return(
				"Identifier", "Features", "ClientId",
				1, "ClientId", "ConnectionId", "KeyPrefix", 1, "Proof",
				1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ConnectionQueryService: mockService,
			}}

			response, err := cc.ConnectionProof(
				context.Background(),
				provider.ConnectionInfo{
					ConnID: "connectionId",
				},
				9)

			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgChannelOpenAck(t *testing.T) {
	testCases := []struct {
		name  string
		txErr error
		gwErr error
	}{
		{
			name:  "success",
			txErr: nil,
			gwErr: nil,
		},
		{
			name:  "fail err gw",
			txErr: nil,
			gwErr: fmt.Errorf("fail err gw"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gwMock := new(services_mock.ChannelMsgServiceMock)
			gwMock.On("ChannelOpenAck",
				context.Background(),
				&pbchannel.MsgChannelOpenAck{Signer: "Address", ProofHeight: &types.Height{}},
				[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelMsgService: gwMock,
				},
			}
			response, err := cc.MsgChannelOpenAck(provider.ChannelInfo{}, provider.ChannelProof{})
			if err != nil {
				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgChannelOpenInit(t *testing.T) {
	testCases := []struct {
		name  string
		txErr error
		gwErr error
	}{
		{
			name:  "success",
			txErr: nil,
			gwErr: nil,
		},
		{
			name:  "fail err gw",
			txErr: nil,
			gwErr: fmt.Errorf("fail err gw"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gwMock := new(services_mock.ChannelMsgServiceMock)
			gwMock.On("ChannelOpenInit",
				context.Background(),
				&pbchannel.MsgChannelOpenInit{
					Signer: "Address",
					Channel: &pbchannel.Channel{
						State:          pbchannel.State_STATE_INIT,
						Counterparty:   &pbchannel.Counterparty{},
						ConnectionHops: []string{"ConnID"},
					},
				},
				[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelMsgService: gwMock,
				},
			}
			response, err := cc.MsgChannelOpenInit(provider.ChannelInfo{ConnID: "ConnID"}, provider.ChannelProof{})
			if err != nil {
				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgConnectionOpenAck(t *testing.T) {
	testCases := []struct {
		name             string
		clientStateValue string
		txErr            error
		gwErr            error
	}{
		{
			name:             "success",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			txErr:            nil,
			gwErr:            nil,
		},
		{
			name:             "fail ShowAddress",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			txErr:            fmt.Errorf("fail ShowAddress"),
			gwErr:            nil,
		},
		{
			name:             "fail ConnectionOpenAck",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			txErr:            nil,
			gwErr:            fmt.Errorf("fail ConnectionOpenAck"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ClientQueryService)
			mockService.On(
				"ClientState",
				context.Background(),
				&pbclient.QueryClientStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ClientState",
				tc.clientStateValue,
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				210173,
				nil)

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ClientQueryService: mockService,
				},
			}
			clientState, err := cc.QueryClientState(context.Background(), 9, "")
			if err != nil {
				t.SkipNow()
			}
			csAny, err := clienttypes.PackClientState(clientState)
			if err != nil {
				t.SkipNow()
			}
			gwMock := new(services_mock.ConnectionMsgServiceMock)
			gwMock.On("ConnectionOpenAck",
				context.Background(),
				transformMsgConnectionOpenAck(&conntypes.MsgConnectionOpenAck{

					Version:     conntypes.DefaultIBCVersion,
					ClientState: csAny,
					ProofHeight: clienttypes.Height{},

					ConsensusHeight: clienttypes.Height{
						RevisionNumber: clientState.GetLatestHeight().GetRevisionNumber(),
						RevisionHeight: clientState.GetLatestHeight().GetRevisionHeight(),
					},
					Signer: "Address",
				}),
				[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)
			cc.GateWay.ConnectionMsgService = gwMock
			response, err := cc.MsgConnectionOpenAck(provider.ConnectionInfo{}, provider.ConnectionProof{
				ClientState: clientState,
			})
			if err != nil {

				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}

			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgConnectionOpenInit(t *testing.T) {
	testCases := []struct {
		name  string
		txErr error
		gwErr error
	}{
		{
			name:  "success",
			txErr: nil,
			gwErr: nil,
		},
		{
			name:  "fail ShowAddress",
			txErr: fmt.Errorf("fail ShowAddress"),
			gwErr: nil,
		},
		{
			name:  "fail ConnectionOpenInit",
			txErr: nil,
			gwErr: fmt.Errorf("fail ConnectionOpenInit"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			connectionMsgServiceMock := new(services_mock.ConnectionMsgServiceMock)
			connectionMsgServiceMock.On(
				"ConnectionOpenInit",
				context.Background(),
				&pbconnection.MsgConnectionOpenInit{
					Counterparty: &pbconnection.Counterparty{
						Prefix: &commitmenttypes.MerklePrefix{
							KeyPrefix: nil,
						},
					},
					Signer: "Address",
				}, []grpc.CallOption(nil)).
				Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ConnectionMsgService: connectionMsgServiceMock,
				},
			}
			response, err := cc.MsgConnectionOpenInit(provider.ConnectionInfo{}, provider.ConnectionProof{})
			if err != nil {
				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgCreateClient(t *testing.T) {

	var testCases = []struct {
		name            string
		showAddress     error
		createClient    error
		signAndSubmitTx error
	}{
		{
			name:            "success",
			showAddress:     nil,
			createClient:    nil,
			signAndSubmitTx: nil,
		},
		{
			name:            "fail showAddress",
			showAddress:     fmt.Errorf("fail showAddress"),
			createClient:    nil,
			signAndSubmitTx: nil,
		},
		{
			name:            "fail createClient",
			showAddress:     nil,
			createClient:    fmt.Errorf("fail createClient"),
			signAndSubmitTx: nil,
		},
		{
			name:            "fail signAndSubmit",
			showAddress:     nil,
			createClient:    nil,
			signAndSubmitTx: fmt.Errorf("fail signAndSubmit"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			clientQueryService := new(services_mock.ClientQueryService)

			clientQueryService.On(
				"ClientState",
				context.Background(),
				&pbclient.QueryClientStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ClientState",
				string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				210173,
				nil)
			clientQueryService.On("ConsensusState", context.Background(),
				&pbclient.QueryConsensusStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ConsensusState",
				string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
				"0-212218/consensus/749d9b2194341dbd7ce7f8787c6d85290351aeafa7dd38da3894e472997f04a4/0",
				212218,
				nil,
			)

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ClientQueryService: clientQueryService,
				},
			}
			clientState, err := cc.QueryClientState(context.Background(), 9, "")
			if err != nil {
				t.Skip()
			}
			anyClientState, err := clienttypes.PackClientState(clientState)
			if err != nil {
				t.Skip()
			}
			consensusState, _, err := cc.QueryConsensusState(context.Background(), 9)
			if err != nil {
				t.Skip()
			}
			anyConsensusState, err := clienttypes.PackConsensusState(consensusState)
			if err != nil {
				t.Skip()
			}

			clientMsgService := new(services_mock.ClientMsgService)
			clientMsgService.On(
				"CreateClient",
				context.Background(),
				&pbclient.MsgCreateClient{
					ClientState: &anypb.Any{
						TypeUrl: anyClientState.TypeUrl,
						Value:   anyClientState.Value,
					},
					ConsensusState: &anypb.Any{
						TypeUrl: anyConsensusState.TypeUrl,
						Value:   anyConsensusState.Value,
					},
					Signer: "Address",
				}, []grpc.CallOption(nil)).Return(
				"UnsignedTxTypeUrl",
				"UnsignedTxValue",
				"clientId", tc.createClient)
			cc.GateWay.ClientMsgService = clientMsgService
			response, err := cc.MsgCreateClient(clientState, consensusState)
			if err != nil {
				if tc.signAndSubmitTx != nil {
					require.EqualError(t, err, tc.signAndSubmitTx.Error())
				}
				if tc.createClient != nil {
					require.EqualError(t, err, tc.createClient.Error())
				}
				if tc.showAddress != nil {
					require.EqualError(t, err, tc.showAddress.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgRecvPacket(t *testing.T) {
	testCases := []struct {
		name        string
		showAddress error
		recvPacket  error
	}{
		{
			name:        "success",
			showAddress: nil,
			recvPacket:  nil,
		},
		{
			name:        "fail showAddress",
			showAddress: fmt.Errorf("fail showAddress"),
			recvPacket:  nil,
		},
		{
			name:        "fail recvPacket",
			showAddress: nil,
			recvPacket:  fmt.Errorf("fail recvPacket"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			channelMsgService := new(services_mock.ChannelMsgServiceMock)
			channelMsgService.On("RecvPacket",
				context.Background(),
				&pbchannel.MsgRecvPacket{
					Packet: &pbchannel.Packet{
						TimeoutHeight: &types.Height{},
					},
					ProofHeight:     &types.Height{},
					ProofCommitment: nil,
					Signer:          "Address",
				},
				[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.recvPacket)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelMsgService: channelMsgService,
				},
			}
			response, err := cc.MsgRecvPacket(provider.PacketInfo{}, provider.PacketProof{})
			if err != nil {
				if tc.recvPacket != nil {
					require.EqualError(t, err, tc.recvPacket.Error())
				}
				if tc.showAddress != nil {
					require.EqualError(t, err, tc.showAddress.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgUpdateClient(t *testing.T) {

	testCases := []struct {
		name         string
		showAddress  error
		updateClient error
	}{
		{
			name:         "success",
			showAddress:  nil,
			updateClient: nil,
		},
		{
			name:         "fail showAddress",
			showAddress:  fmt.Errorf("fail showAddress"),
			updateClient: nil,
		},
		{
			name:         "fail updateClient",
			showAddress:  nil,
			updateClient: fmt.Errorf("fail updateClient"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			clientQueryService := new(services_mock.ClientQueryService)
			clientQueryService.On("BlockData", context.Background(),
				&pbclient.QueryBlockDataRequest{
					Height: 1,
				}, []grpc.CallOption(nil)).Return(
				"ibc.clients.cardano.v1.BlockData",
				string([]byte{10, 2, 16, 100}),
				nil)

			clientMsgService := new(services_mock.ClientMsgService)
			clientMsgService.On(
				"UpdateClient",
				context.Background(),
				&pbclient.MsgUpdateClient{
					ClientId: "clientId",
					ClientMessage: &anypb.Any{
						TypeUrl: "/ibc.clients.cardano.v1.BlockData",
						Value:   []byte{10, 2, 16, 100},
					},
					Signer: "Address",
				}, []grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.updateClient)

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ClientMsgService:   clientMsgService,
					ClientQueryService: clientQueryService,
				},
			}
			blockData, err := cc.QueryBlockData(context.Background(), 1)
			if err != nil {
				t.Skip()
			}
			response, err := cc.MsgUpdateClient("clientId", blockData)
			if err != nil {
				fmt.Println(err)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestPacketAcknowledgement(t *testing.T) {
	testCases := []struct {
		name  string
		gwErr error
		ack   string
	}{
		{
			name:  "success",
			gwErr: nil,
			ack:   "Acknowledgement",
		},
		{
			name:  "fail gwErr",
			gwErr: fmt.Errorf("fail gwErr"),
			ack:   "",
		},
		{
			name:  "fail ack len",
			gwErr: nil,
			ack:   "",
		},
	}
	for _, tc := range testCases {
		tc := tc

		t.Run(tc.name, func(t *testing.T) {
			ChannelQueryService := new(services_mock.ChannelQueryService)
			ChannelQueryService.On("PacketAcknowledgement",
				context.Background(),
				&pbchannel.QueryPacketAcknowledgementRequest{
					PortId:    "DestPort",
					ChannelId: "DestChannel",
					Sequence:  0,
				},
				[]grpc.CallOption(nil)).Return(
				tc.ack, "Proof", 1, tc.gwErr)
			cc := &CardanoProvider{
				GateWay: services.Gateway{
					ChannelQueryService: ChannelQueryService,
				},
			}
			response, err := cc.PacketAcknowledgement(context.Background(), provider.PacketInfo{
				Sequence:    0,
				DestPort:    "DestPort",
				DestChannel: "DestChannel",
			}, 9)

			if err != nil {
				if tc.gwErr != nil {
					require.EqualError(t, err, tc.gwErr.Error())
				} else {
					require.ErrorContains(t, err, "invalid acknowledgement")
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestChannelProof(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
		{
			name:  "fail",
			exErr: fmt.Errorf("expected error"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("Channel", context.Background(),
				&pbchannel.QueryChannelRequest{
					PortId:    "PortID",
					ChannelId: "ChannelID",
				},
				[]grpc.CallOption(nil)).Return(1, 1, "PortId",
				"ChannelId", "ConnectionHops", "Version", "Proof", 9, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}

			response, err := cc.ChannelProof(context.Background(), provider.ChannelInfo{
				ChannelID: "ChannelID",
				PortID:    "PortID",
			}, 9)

			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})

	}
}

func TestMsgCreateCosmosClient(t *testing.T) {

	var testCases = []struct {
		name            string
		showAddress     error
		createClient    error
		signAndSubmitTx error
	}{
		{
			name:            "success",
			showAddress:     nil,
			createClient:    nil,
			signAndSubmitTx: nil,
		},
		{
			name:            "fail showAddress",
			showAddress:     fmt.Errorf("fail showAddress"),
			createClient:    nil,
			signAndSubmitTx: nil,
		},
		{
			name:            "fail createClient",
			showAddress:     nil,
			createClient:    fmt.Errorf("fail createClient"),
			signAndSubmitTx: nil,
		},
		{
			name:            "fail signAndSubmit",
			showAddress:     nil,
			createClient:    nil,
			signAndSubmitTx: fmt.Errorf("fail signAndSubmit"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			clientQueryService := new(services_mock.ClientQueryService)

			clientQueryService.On(
				"ClientState",
				context.Background(),
				&pbclient.QueryClientStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ClientState",
				string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				210173,
				nil)
			clientQueryService.On("ConsensusState", context.Background(),
				&pbclient.QueryConsensusStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ConsensusState",
				string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
				"0-212218/consensus/749d9b2194341dbd7ce7f8787c6d85290351aeafa7dd38da3894e472997f04a4/0",
				212218,
				nil,
			)

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ClientQueryService: clientQueryService,
				},
			}
			clientState, err := cc.QueryClientState(context.Background(), 9, "")
			if err != nil {
				t.Skip()
			}
			anyClientState, err := clienttypes.PackClientState(clientState)
			if err != nil {
				t.Skip()
			}
			consensusState, _, err := cc.QueryConsensusState(context.Background(), 9)
			if err != nil {
				t.Skip()
			}
			anyConsensusState, err := clienttypes.PackConsensusState(consensusState)
			if err != nil {
				t.Skip()
			}

			clientMsgService := new(services_mock.ClientMsgService)
			clientMsgService.On(
				"CreateClient",
				context.Background(),
				&pbclient.MsgCreateClient{
					ClientState: &anypb.Any{
						TypeUrl: anyClientState.TypeUrl,
						Value:   anyClientState.Value,
					},
					ConsensusState: &anypb.Any{
						TypeUrl: anyConsensusState.TypeUrl,
						Value:   anyConsensusState.Value,
					},
					Signer: "Address",
				}, []grpc.CallOption(nil)).Return(
				"UnsignedTxTypeUrl",
				"UnsignedTxValue",
				"clientId", tc.createClient)
			cc.GateWay.ClientMsgService = clientMsgService
			response, _, err := cc.MsgCreateCosmosClient(clientState, consensusState)
			if err != nil {
				if tc.signAndSubmitTx != nil {
					require.EqualError(t, err, tc.signAndSubmitTx.Error())
				}
				if tc.createClient != nil {
					require.EqualError(t, err, tc.createClient.Error())
				}
				if tc.showAddress != nil {
					require.EqualError(t, err, tc.showAddress.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgTransfer(t *testing.T) {
	testCases := []struct {
		name  string
		txErr error
		gwErr error
	}{
		{
			name:  "success",
			txErr: nil,
			gwErr: nil,
		},
		{
			name:  "fail err txCardano",
			txErr: fmt.Errorf("fail err txCardano"),
			gwErr: nil,
		},
		{
			name:  "fail err gw",
			txErr: nil,
			gwErr: fmt.Errorf("fail err gw"),
		},
		{
			name:  "info.TimeoutHeight.RevisionHeight != 0",
			txErr: nil,
			gwErr: nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			gwMock := new(services_mock.ChannelMsgServiceMock)
			if tc.name == "info.TimeoutHeight.RevisionHeight != 0" {
				gwMock.On("Transfer",
					context.Background(),
					&pbchannel.MsgTransfer{
						Token: &pbchannel.Coin{
							Denom:  "demon",
							Amount: 1,
						},
						TimeoutHeight:    &clienttypes.Height{},
						TimeoutTimestamp: 0,
						Sender:           "247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8",
						Receiver:         "address",
					},
					[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)
			} else {
				gwMock.On("Transfer",
					context.Background(),
					&pbchannel.MsgTransfer{
						Token: &pbchannel.Coin{
							Denom:  "demon",
							Amount: 1,
						},
						TimeoutHeight:    &clienttypes.Height{},
						TimeoutTimestamp: 0,
						Sender:           "247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8",
						Receiver:         "address",
					},
					[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", tc.gwErr)
			}

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelMsgService: gwMock,
				},
			}
			cc.log = zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))
			response, err := cc.MsgTransfer("address", sdk.Coin{
				Denom:  "demon",
				Amount: sdkmath.NewInt(1),
			}, provider.PacketInfo{})
			if err != nil {
				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
					// Check the log message
					require.Contains(t, buf.String(), "Fail to load signer from ....")
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestMsgAcknowledgement(t *testing.T) {
	testCases := []struct {
		name  string
		txErr error
		gwErr error
	}{
		{
			name:  "success",
			txErr: nil,
			gwErr: nil,
		},
		{
			name:  "fail err txCardano",
			txErr: fmt.Errorf("fail err txCardano"),
			gwErr: nil,
		},
		{
			name:  "fail err gw",
			txErr: nil,
			gwErr: fmt.Errorf("fail err gw"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gwMock := new(services_mock.ChannelMsgServiceMock)
			gwMock.On("Acknowledgement",
				context.Background(),
				&pbchannel.MsgAcknowledgement{
					Packet: &pbchannel.Packet{
						TimeoutHeight: &clienttypes.Height{},
					},
					ProofHeight: &clienttypes.Height{},
					Signer:      "Address",
				},
				[]grpc.CallOption(nil)).Return(0, tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelMsgService: gwMock,
				},
			}
			response, err := cc.MsgAcknowledgement(provider.PacketInfo{}, provider.PacketProof{})
			if err != nil {
				if tc.txErr != nil {
					require.EqualError(t, err, tc.txErr.Error())
				} else {
					require.EqualError(t, err, tc.gwErr.Error())
				}
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestValidatePacket(t *testing.T) {
	testCases := []struct {
		name                               string
		msg                                provider.PacketInfo
		latestBlock                        provider.LatestBlock
		sequenceErr                        error
		msgDataErr                         error
		timeoutHeightErr                   error
		latestHeightGTEMsgTimeOutHeightErr error
		latestTimeGTEMsgTimeErr            error
	}{
		{
			name: "success",
			msg: provider.PacketInfo{
				Height:        2127828,
				Sequence:      3,
				SourcePort:    "transfer",
				SourceChannel: "channel-387",
				DestPort:      "port-100",
				DestChannel:   "channel-3",
				ChannelOrder:  "ORDER_UNORDERED",
				Data:          []byte{123, 34, 97, 109, 111, 117, 110, 116, 34, 58, 34, 50, 48, 48, 48, 34, 44, 34, 100, 101, 110, 111, 109, 34, 58, 34, 115, 116, 97, 107, 101, 34, 44, 34, 114, 101, 99, 101, 105, 118, 101, 114, 34, 58, 34, 97, 100, 100, 114, 95, 116, 101, 115, 116, 49, 118, 113, 106, 56, 50, 117, 57, 99, 104, 102, 55, 117, 119, 102, 48, 102, 108, 117, 109, 55, 106, 97, 116, 109, 115, 57, 121, 116, 102, 52, 100, 112, 121, 107, 50, 99, 97, 107, 107, 122, 108, 52, 122, 112, 48, 119, 113, 103, 115, 113, 110, 113, 108, 34, 44, 34, 115, 101, 110, 100, 101, 114, 34, 58, 34, 99, 111, 115, 109, 111, 115, 49, 121, 99, 101, 108, 53, 51, 97, 53, 100, 57, 120, 107, 56, 57, 113, 51, 118, 100, 114, 55, 118, 109, 56, 51, 57, 116, 50, 118, 119, 108, 48, 56, 112, 108, 54, 122, 107, 54, 34, 125},
				TimeoutHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TimeoutTimestamp: 1711529067466540141,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2024, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        nil,
			msgDataErr:                         nil,
			timeoutHeightErr:                   nil,
			latestHeightGTEMsgTimeOutHeightErr: nil,
			latestTimeGTEMsgTimeErr:            nil,
		},
		{
			name: "refusing to relay packet with sequence",
			msg: provider.PacketInfo{
				Height:        2127828,
				Sequence:      0,
				SourcePort:    "transfer",
				SourceChannel: "channel-387",
				DestPort:      "port-100",
				DestChannel:   "channel-3",
				ChannelOrder:  "ORDER_UNORDERED",
				Data:          []byte{123, 34, 97, 109, 111, 117, 110, 116, 34, 58, 34, 50, 48, 48, 48, 34, 44, 34, 100, 101, 110, 111, 109, 34, 58, 34, 115, 116, 97, 107, 101, 34, 44, 34, 114, 101, 99, 101, 105, 118, 101, 114, 34, 58, 34, 97, 100, 100, 114, 95, 116, 101, 115, 116, 49, 118, 113, 106, 56, 50, 117, 57, 99, 104, 102, 55, 117, 119, 102, 48, 102, 108, 117, 109, 55, 106, 97, 116, 109, 115, 57, 121, 116, 102, 52, 100, 112, 121, 107, 50, 99, 97, 107, 107, 122, 108, 52, 122, 112, 48, 119, 113, 103, 115, 113, 110, 113, 108, 34, 44, 34, 115, 101, 110, 100, 101, 114, 34, 58, 34, 99, 111, 115, 109, 111, 115, 49, 121, 99, 101, 108, 53, 51, 97, 53, 100, 57, 120, 107, 56, 57, 113, 51, 118, 100, 114, 55, 118, 109, 56, 51, 57, 116, 50, 118, 119, 108, 48, 56, 112, 108, 54, 122, 107, 54, 34, 125},
				TimeoutHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TimeoutTimestamp: 1711529067466540141,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2024, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        errors.New("refusing to relay packet with sequence: 0"),
			msgDataErr:                         nil,
			timeoutHeightErr:                   nil,
			latestHeightGTEMsgTimeOutHeightErr: nil,
			latestTimeGTEMsgTimeErr:            nil,
		},
		{
			name: "refusing to relay packet with empty data",
			msg: provider.PacketInfo{
				Height:        2127828,
				Sequence:      3,
				SourcePort:    "transfer",
				SourceChannel: "channel-387",
				DestPort:      "port-100",
				DestChannel:   "channel-3",
				ChannelOrder:  "ORDER_UNORDERED",
				Data:          []byte{},
				TimeoutHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TimeoutTimestamp: 1711529067466540141,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2024, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        nil,
			msgDataErr:                         errors.New("refusing to relay packet with empty data"),
			timeoutHeightErr:                   nil,
			latestHeightGTEMsgTimeOutHeightErr: nil,
			latestTimeGTEMsgTimeErr:            nil,
		},
		{
			name: "refusing to relay packet without a timeout (height or timestamp must be set)",
			msg: provider.PacketInfo{
				Height:           2127828,
				Sequence:         3,
				SourcePort:       "transfer",
				SourceChannel:    "channel-387",
				DestPort:         "port-100",
				DestChannel:      "channel-3",
				ChannelOrder:     "ORDER_UNORDERED",
				Data:             []byte{123, 34, 97, 109, 111, 117, 110, 116, 34, 58, 34, 50, 48, 48, 48, 34, 44, 34, 100, 101, 110, 111, 109, 34, 58, 34, 115, 116, 97, 107, 101, 34, 44, 34, 114, 101, 99, 101, 105, 118, 101, 114, 34, 58, 34, 97, 100, 100, 114, 95, 116, 101, 115, 116, 49, 118, 113, 106, 56, 50, 117, 57, 99, 104, 102, 55, 117, 119, 102, 48, 102, 108, 117, 109, 55, 106, 97, 116, 109, 115, 57, 121, 116, 102, 52, 100, 112, 121, 107, 50, 99, 97, 107, 107, 122, 108, 52, 122, 112, 48, 119, 113, 103, 115, 113, 110, 113, 108, 34, 44, 34, 115, 101, 110, 100, 101, 114, 34, 58, 34, 99, 111, 115, 109, 111, 115, 49, 121, 99, 101, 108, 53, 51, 97, 53, 100, 57, 120, 107, 56, 57, 113, 51, 118, 100, 114, 55, 118, 109, 56, 51, 57, 116, 50, 118, 119, 108, 48, 56, 112, 108, 54, 122, 107, 54, 34, 125},
				TimeoutHeight:    clienttypes.Height{},
				TimeoutTimestamp: 0,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2024, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        nil,
			msgDataErr:                         nil,
			timeoutHeightErr:                   errors.New("refusing to relay packet without a timeout (height or timestamp must be set)"),
			latestHeightGTEMsgTimeOutHeightErr: nil,
			latestTimeGTEMsgTimeErr:            nil,
		},
		{
			name: "latest Client Types Height GTE msg Timeout Height",
			msg: provider.PacketInfo{
				Height:        2127828,
				Sequence:      3,
				SourcePort:    "transfer",
				SourceChannel: "channel-387",
				DestPort:      "port-100",
				DestChannel:   "channel-3",
				ChannelOrder:  "ORDER_UNORDERED",
				Data:          []byte{123, 34, 97, 109, 111, 117, 110, 116, 34, 58, 34, 50, 48, 48, 48, 34, 44, 34, 100, 101, 110, 111, 109, 34, 58, 34, 115, 116, 97, 107, 101, 34, 44, 34, 114, 101, 99, 101, 105, 118, 101, 114, 34, 58, 34, 97, 100, 100, 114, 95, 116, 101, 115, 116, 49, 118, 113, 106, 56, 50, 117, 57, 99, 104, 102, 55, 117, 119, 102, 48, 102, 108, 117, 109, 55, 106, 97, 116, 109, 115, 57, 121, 116, 102, 52, 100, 112, 121, 107, 50, 99, 97, 107, 107, 122, 108, 52, 122, 112, 48, 119, 113, 103, 115, 113, 110, 113, 108, 34, 44, 34, 115, 101, 110, 100, 101, 114, 34, 58, 34, 99, 111, 115, 109, 111, 115, 49, 121, 99, 101, 108, 53, 51, 97, 53, 100, 57, 120, 107, 56, 57, 113, 51, 118, 100, 114, 55, 118, 109, 56, 51, 57, 116, 50, 118, 119, 108, 48, 56, 112, 108, 54, 122, 107, 54, 34, 125},
				TimeoutHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 190903,
				},
				TimeoutTimestamp: 1711529067466540141,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2024, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        nil,
			msgDataErr:                         nil,
			timeoutHeightErr:                   nil,
			latestHeightGTEMsgTimeOutHeightErr: errors.New("latest height 192903 is greater than expiration height: 190903"),
			latestTimeGTEMsgTimeErr:            nil,
		},
		{
			name: "latest Client Types time GTE msg time",
			msg: provider.PacketInfo{
				Height:        2127828,
				Sequence:      3,
				SourcePort:    "transfer",
				SourceChannel: "channel-387",
				DestPort:      "port-100",
				DestChannel:   "channel-3",
				ChannelOrder:  "ORDER_UNORDERED",
				Data:          []byte{123, 34, 97, 109, 111, 117, 110, 116, 34, 58, 34, 50, 48, 48, 48, 34, 44, 34, 100, 101, 110, 111, 109, 34, 58, 34, 115, 116, 97, 107, 101, 34, 44, 34, 114, 101, 99, 101, 105, 118, 101, 114, 34, 58, 34, 97, 100, 100, 114, 95, 116, 101, 115, 116, 49, 118, 113, 106, 56, 50, 117, 57, 99, 104, 102, 55, 117, 119, 102, 48, 102, 108, 117, 109, 55, 106, 97, 116, 109, 115, 57, 121, 116, 102, 52, 100, 112, 121, 107, 50, 99, 97, 107, 107, 122, 108, 52, 122, 112, 48, 119, 113, 103, 115, 113, 110, 113, 108, 34, 44, 34, 115, 101, 110, 100, 101, 114, 34, 58, 34, 99, 111, 115, 109, 111, 115, 49, 121, 99, 101, 108, 53, 51, 97, 53, 100, 57, 120, 107, 56, 57, 113, 51, 118, 100, 114, 55, 118, 109, 56, 51, 57, 116, 50, 118, 119, 108, 48, 56, 112, 108, 54, 122, 107, 54, 34, 125},
				TimeoutHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TimeoutTimestamp: 1711529067466540141,
				Ack:              nil,
			},
			latestBlock: provider.LatestBlock{
				Height: 192903,
				Time:   time.Date(2025, time.March, 21, 12, 0, 0, 0, time.UTC),
			},
			sequenceErr:                        nil,
			msgDataErr:                         nil,
			timeoutHeightErr:                   nil,
			latestHeightGTEMsgTimeOutHeightErr: nil,
			latestTimeGTEMsgTimeErr:            errors.New("latest block timestamp 1742558400000000000 is greater than expiration timestamp: 1711529067466540141"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
			}
			err := cc.ValidatePacket(tc.msg, tc.latestBlock)
			if tc.sequenceErr != nil {
				require.EqualError(t, err, tc.sequenceErr.Error())
			} else if tc.msgDataErr != nil {
				require.EqualError(t, err, tc.msgDataErr.Error())
			} else if tc.timeoutHeightErr != nil {
				require.EqualError(t, err, tc.timeoutHeightErr.Error())
			} else if tc.latestHeightGTEMsgTimeOutHeightErr != nil {
				require.EqualError(t, err, tc.latestHeightGTEMsgTimeOutHeightErr.Error())
			} else if tc.latestTimeGTEMsgTimeErr != nil {
				require.EqualError(t, err, tc.latestTimeGTEMsgTimeErr.Error())
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestWaitForBlockInclusion(t *testing.T) {
	testCases := []struct {
		name        string
		ctx         context.Context
		txHash      string
		waitTimeout time.Duration
		timeOut     error
		gwErr       error
	}{
		{
			name:        "success",
			ctx:         context.Background(),
			txHash:      "",
			waitTimeout: 600000000000,
			timeOut:     nil,
		},
		{
			name:        "timed out after waiting for tx to get included in the block",
			ctx:         context.Background(),
			txHash:      "",
			waitTimeout: -5,
			timeOut:     fmt.Errorf("timed out after: -5; timed out after waiting for tx to get included in the block"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {

			gwMock := new(services_mock.TypeProvider)
			gwMock.On("TransactionByHash",
				context.Background(),
				&ibcclient.QueryTransactionByHashRequest{},
				[]grpc.CallOption(nil)).Return("hash", 0, 0, 0, tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					TypeProvider: gwMock,
				},
			}
			_, err := cc.waitForBlockInclusion(tc.ctx, tc.txHash, tc.waitTimeout)
			if tc.timeOut != nil {
				require.EqualError(t, err, tc.timeOut.Error())
			} else {
				require.Empty(t, nil, "")
			}
		})
	}
}

func TestWaitForTx(t *testing.T) {
	testCases := []struct {
		name        string
		ctx         context.Context
		txHash      string
		waitTimeout time.Duration
		callbacks   []func(*provider.RelayerTxResponse, error)
		error       error
		gwErr       error
	}{
		{
			name:        "success",
			ctx:         context.Background(),
			txHash:      "",
			waitTimeout: 600000000000,
			callbacks:   make([]func(*provider.RelayerTxResponse, error), 0),
			error:       fmt.Errorf("failed to wait for block inclusion"),
			gwErr:       nil,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			gwMock := new(services_mock.TypeProvider)
			gwMock.On("TransactionByHash",
				context.Background(),
				&ibcclient.QueryTransactionByHashRequest{},
				[]grpc.CallOption(nil)).Return("hash", 0, 0, 0, tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					TypeProvider: gwMock,
				},
			}
			var buf bytes.Buffer
			cc.log = zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))
			var msgs []provider.RelayerMessage
			cc.waitForTx(tc.ctx, tc.txHash, msgs, tc.waitTimeout, tc.callbacks)
		})
	}
}

func TestSendMessagesToMempool(t *testing.T) {
	ctx := context.Background()
	testCases := []struct {
		name               string
		ctx                context.Context
		msgs               []provider.RelayerMessage
		memo               string
		asyncCtx           context.Context
		asyncCallbacks     []func(*provider.RelayerTxResponse, error)
		err                error
		signAndSubmitTxErr error
	}{
		{
			name: "success",
			ctx:  context.Background(),
			msgs: []provider.RelayerMessage{
				CardanoMessage{
					Msg: &clienttypes.MsgUpdateClient{
						ClientId:      "ibc_client-16",
						ClientMessage: nil,
						Signer:        "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
					},
					UnsignedTx: &anypb.Any{
						TypeUrl: "",
						Value:   []byte{},
					},
					SetSigner:        nil,
					FeegrantDisabled: false,
				},
			},
			asyncCtx:           ctx,
			err:                nil,
			signAndSubmitTxErr: nil,
		},
		{
			name: "fail SignAndSubmitTx",
			ctx:  context.Background(),
			msgs: []provider.RelayerMessage{
				CardanoMessage{
					Msg: &clienttypes.MsgUpdateClient{
						ClientId:      "ibc_client-161",
						ClientMessage: nil,
						Signer:        "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
					},
					UnsignedTx: &anypb.Any{
						TypeUrl: "",
						Value:   []byte{},
					},
					SetSigner:        nil,
					FeegrantDisabled: false,
				},
			},
			asyncCtx:           ctx,
			err:                nil,
			signAndSubmitTxErr: fmt.Errorf("fail signAndSubmit"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			typeProviderMock := new(services_mock.TypeProvider)

			typeProviderMock.On("TransactionByHash",
				context.Background(),
				&ibcclient.QueryTransactionByHashRequest{
					Hash: "txId",
				},
				[]grpc.CallOption(nil)).Return("hash", 0, 0, 0, nil)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{TypeProvider: typeProviderMock},
			}

			cc.log = zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))
			err := cc.SendMessagesToMempool(tc.ctx, tc.msgs, tc.memo, tc.asyncCtx, tc.asyncCallbacks)
			if tc.signAndSubmitTxErr != nil {
				require.EqualError(t, err, tc.signAndSubmitTxErr.Error())
			} else {
				require.Empty(t, nil, "")
			}
		})
	}
}

func TestMsgUpdateClientHeader(t *testing.T) {
	testCases := []struct {
		name          string
		latestHeader  provider.IBCHeader
		trustedHeight clienttypes.Height
		trustedHeader provider.IBCHeader
		err           error
	}{
		{
			name: "success",
			latestHeader: provider.TendermintIBCHeader{
				SignedHeader: &ty.SignedHeader{
					Header: &ty.Header{
						Version: version.Consensus{
							Block: 11,
							App:   1,
						},
						ChainID:            "sidechain",
						Height:             2298597,
						Time:               time.Date(2024, time.March, 29, 12, 0, 0, 0, time.UTC),
						LastBlockID:        ty.BlockID{},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: nil,
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &ty.Commit{
						Height:     0,
						Round:      0,
						BlockID:    ty.BlockID{},
						Signatures: nil,
					},
				},
				ValidatorSet:      nil,
				TrustedValidators: nil,
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
			trustedHeight: types.Height{},
			trustedHeader: provider.TendermintIBCHeader{
				SignedHeader: &ty.SignedHeader{
					Header: &ty.Header{
						Version: version.Consensus{
							Block: 11,
							App:   1,
						},
						ChainID:            "sidechain",
						Height:             2298597,
						Time:               time.Date(2024, time.March, 29, 12, 0, 0, 0, time.UTC),
						LastBlockID:        ty.BlockID{},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: nil,
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &ty.Commit{
						Height:     0,
						Round:      0,
						BlockID:    ty.BlockID{},
						Signatures: nil,
					},
				},
				ValidatorSet:      nil,
				TrustedValidators: nil,
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
			err: nil,
		},
		{
			name:          "unsupported IBC header type",
			latestHeader:  nil,
			trustedHeight: types.Height{},
			trustedHeader: provider.TendermintIBCHeader{
				SignedHeader: &ty.SignedHeader{
					Header: &ty.Header{
						Version: version.Consensus{
							Block: 11,
							App:   1,
						},
						ChainID:            "sidechain",
						Height:             2298597,
						Time:               time.Date(2024, time.March, 29, 12, 0, 0, 0, time.UTC),
						LastBlockID:        ty.BlockID{},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: nil,
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &ty.Commit{
						Height:     0,
						Round:      0,
						BlockID:    ty.BlockID{},
						Signatures: nil,
					},
				},
				ValidatorSet:      nil,
				TrustedValidators: nil,
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
			err: fmt.Errorf("unsupported IBC header type, expected: TendermintIBCHeader, actual: <nil>"),
		},
		{
			name: "unsupported IBC trusted header type",
			latestHeader: provider.TendermintIBCHeader{
				SignedHeader: &ty.SignedHeader{
					Header: &ty.Header{
						Version: version.Consensus{
							Block: 11,
							App:   1,
						},
						ChainID:            "sidechain",
						Height:             2298597,
						Time:               time.Date(2024, time.March, 29, 12, 0, 0, 0, time.UTC),
						LastBlockID:        ty.BlockID{},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: nil,
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &ty.Commit{
						Height:     0,
						Round:      0,
						BlockID:    ty.BlockID{},
						Signatures: nil,
					},
				},
				ValidatorSet:      nil,
				TrustedValidators: nil,
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
			trustedHeight: types.Height{},
			trustedHeader: nil,
			err:           fmt.Errorf("unsupported IBC trusted header type, expected: TendermintIBCHeader, actual: <nil>"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
			}
			_, err := cc.MsgUpdateClientHeader(tc.latestHeader, tc.trustedHeight, tc.trustedHeader)
			if err != nil {
				require.EqualError(t, err, tc.err.Error())
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestParseEventsFromTxResponse(t *testing.T) {
	testCases := []struct {
		name string
		resp *sdk.TxResponse
	}{
		{
			name: "resp not nil",
			resp: &sdk.TxResponse{
				Height:    4,
				TxHash:    "",
				Codespace: "",
				Code:      0,
				Data:      "",
				RawLog:    "",
				Logs:      nil,
				Info:      "",
				GasWanted: 0,
				GasUsed:   0,
				Tx:        nil,
				Timestamp: "",
				Events:    make([]abci.Event, 1),
			},
		},
		{
			name: "resp is nil",
			resp: nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			events := parseEventsFromTxResponse(tc.resp)
			if tc.resp == nil {
				require.Empty(t, events)
			} else {
				require.Empty(t, []provider.RelayerEvent{})
			}
		})
	}
}

func TestPacketCommitment(t *testing.T) {
	testCases := []struct {
		name        string
		ctx         context.Context
		msgTransfer provider.PacketInfo
		height      uint64
		gwErr       error
		err         error
	}{
		{
			name: "success",
			ctx:  context.Background(),
			msgTransfer: provider.PacketInfo(packetInfo{
				Height:           5,
				Sequence:         0,
				SourcePort:       "",
				SourceChannel:    "",
				DestPort:         "",
				DestChannel:      "",
				ChannelOrder:     "",
				Data:             nil,
				TimeoutHeight:    types.Height{},
				TimeoutTimestamp: 0,
				Ack:              nil,
			}),
			height: 0,
			gwErr:  nil,
			err:    nil,
		},
		{
			name:        "fail call to gateway",
			ctx:         context.Background(),
			msgTransfer: provider.PacketInfo(packetInfo{}),
			height:      0,
			gwErr:       fmt.Errorf("error querying comet proof for packet commitment"),
			err:         nil,
		},
		{
			name:        "err packet commitment not found",
			ctx:         context.Background(),
			msgTransfer: provider.PacketInfo(packetInfo{}),
			height:      0,
			gwErr:       nil,
			err:         fmt.Errorf("packet commitment not found"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gwMock := new(services_mock.ChannelQueryService)
			gwMock.On("PacketCommitment",
				context.Background(),
				&pbchannel.QueryPacketCommitmentRequest{},
				[]grpc.CallOption(nil)).Return("[]byte{}", "[]byte{}", 0, 0, tc.gwErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ChannelQueryService: gwMock,
				},
			}
			res, _ := cc.PacketCommitment(tc.ctx, tc.msgTransfer, tc.height)
			if tc.gwErr != nil {
				require.EqualError(t, tc.gwErr, tc.gwErr.Error())
			} else if tc.err != nil {
				require.EqualError(t, tc.err, tc.err.Error())
			} else {
				require.NotEmpty(t, res)
			}
		})
	}
}

func TestConnectionHandshakeProof(t *testing.T) {
	testCases := []struct {
		name        string
		ctx         context.Context
		msgOpenInit provider.ConnectionInfo
		height      uint64
		err         error
	}{
		{
			name: "connStateProof == 0",
			ctx:  context.Background(),
			msgOpenInit: provider.ConnectionInfo{
				Height:                       9,
				ConnID:                       "connection-4",
				ClientID:                     "ibc_client-8",
				CounterpartyClientID:         "099-cardano-6",
				CounterpartyConnID:           "",
				CounterpartyCommitmentPrefix: commitmenttypes.MerklePrefix{},
			},
			height: 9,
			err:    nil,
		},
		{
			name: "connStateProof != 0",
			ctx:  context.Background(),
			msgOpenInit: provider.ConnectionInfo{
				Height:                       9,
				ConnID:                       "connection-4",
				ClientID:                     "ibc_client-8",
				CounterpartyClientID:         "099-cardano-6",
				CounterpartyConnID:           "",
				CounterpartyCommitmentPrefix: commitmenttypes.MerklePrefix{},
			},
			height: 9,
			err:    nil,
		},

		{
			name: "fail to GenerateConnHandshakeProof",
			ctx:  context.Background(),
			msgOpenInit: provider.ConnectionInfo{
				Height:                       9,
				ConnID:                       "connection-4",
				ClientID:                     "ibc_client-8",
				CounterpartyClientID:         "",
				CounterpartyConnID:           "",
				CounterpartyCommitmentPrefix: commitmenttypes.MerklePrefix{},
			},
			height: 9,
			err:    fmt.Errorf("fail to GenerateConnHandshakeProof"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {

			clientQueryService := new(services_mock.ClientQueryService)
			clientQueryService.On(
				"ClientState",
				context.Background(),
				&pbclient.QueryClientStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ClientState",
				string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 200, 208, 6, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				9,
				nil)
			clientQueryService.On("ConsensusState", context.Background(),
				&pbclient.QueryConsensusStateRequest{
					Height: 108616,
				},
				[]grpc.CallOption(nil)).Return(
				"/ibc.lightclients.tendermint.v1.ConsensusState",
				string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
				"0-212218/consensus/749d9b2194341dbd7ce7f8787c6d85290351aeafa7dd38da3894e472997f04a4/0",
				9,
				nil,
			)
			connQueryService := new(services_mock.ConnectionQueryService)
			if tc.name == "connStateProof == 0" {
				connQueryService.On(
					"Connection",
					context.Background(),
					&pbconnection.QueryConnectionRequest{
						ConnectionId: "connection-4",
					},
					[]grpc.CallOption(nil)).Return("",
					"",
					"",
					0,
					"",
					"",
					"",
					0,
					"",
					0,
					nil)
			} else {
				connQueryService.On(
					"Connection",
					context.Background(),
					&pbconnection.QueryConnectionRequest{
						ConnectionId: "connection-4",
					},
					[]grpc.CallOption(nil)).Return("",
					"",
					"",
					0,
					"",
					"",
					"",
					0,
					string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
					0,
					nil)
			}

			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{
					ClientQueryService:     clientQueryService,
					ConnectionQueryService: connQueryService,
				},
			}

			res, _ := cc.ConnectionHandshakeProof(tc.ctx, tc.msgOpenInit, tc.height)
			if tc.err != nil {
				require.EqualError(t, tc.err, tc.err.Error())
			} else if tc.name == "connStateProof == 0" {
				require.NotEmpty(t, provider.ConnectionProof{
					ConsensusStateProof:  []byte{},
					ConnectionStateProof: []byte{},
					ClientStateProof:     []byte{},
					ProofHeight: types.Height{
						RevisionNumber: 0,
						RevisionHeight: 0,
					},
					ClientState: nil,
				})
			} else {
				require.NotEmpty(t, res)
			}
		})
	}
}

func TestMsgCreateCardanoClient(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgCreateCardanoClient(&pbclientstruct.ClientState{}, &pbclientstruct.ConsensusState{})
			require.Empty(t, res)
		})
	}
}

//func TestMsgTimeout(t *testing.T) {
//	testCases := []struct {
//		name  string
//		exErr error
//	}{
//		{
//			name:  "success",
//			exErr: nil,
//		},
//	}
//
//	for _, tc := range testCases {
//		tc := tc
//		t.Run(tc.name, func(t *testing.T) {
//			cc := &CardanoProvider{}
//			res, _ := cc.MsgTimeout(provider.PacketInfo{}, provider.PacketProof{})
//			require.Empty(t, res)
//		})
//	}
//}

func TestAdjustEstimatedGas(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.AdjustEstimatedGas(0)
			require.Empty(t, res)
		})
	}
}

func TestSignMode(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res := cc.SignMode()
			require.Empty(t, res)
		})
	}
}

func TestTxFactory(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res := cc.TxFactory()
			require.Empty(t, res)
		})
	}
}

func TestSetWithExtensionOptionsy(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.SetWithExtensionOptions(tx.Factory{})
			require.Empty(t, res)
		})
	}
}

func TestPrepareFactory(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.PrepareFactory(tx.Factory{}, "")
			require.Empty(t, res)
		})
	}
}

func TestHandleAccountSequenceMismatchError(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			cc.handleAccountSequenceMismatchError(&WalletState{}, tc.err)
			require.Empty(t, "")
		})
	}
}

func TestBuildMessages(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			cc.buildMessages(context.Background(), []provider.RelayerMessage{}, "", 0, "", "", &WalletState{})
			require.Empty(t, "")
		})
	}
}

//func TestAcknowledgementFromSequence(t *testing.T) {
//	testCases := []struct {
//		name string
//		err  error
//	}{
//		{
//			name: "success",
//			err:  nil,
//		},
//	}
//
//	for _, tc := range testCases {
//		tc := tc
//		t.Run(tc.name, func(t *testing.T) {
//			cc := &CardanoProvider{}
//			res, _ := cc.AcknowledgementFromSequence(context.Background(), cc, 0, 0, "", "", "", "")
//			require.Empty(t, res)
//		})
//	}
//}

func TestQueryABCI(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.QueryABCI(context.Background(), abci.RequestQuery{})
			require.Empty(t, res)
		})
	}
}

func TestMsgChannelCloseInit(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgChannelCloseInit(provider.ChannelInfo{}, provider.ChannelProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgChannelCloseConfirm(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgChannelCloseConfirm(provider.ChannelInfo{}, provider.ChannelProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgChannelOpenConfirm(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgChannelOpenConfirm(provider.ChannelInfo{}, provider.ChannelProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgChannelOpenTry(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgChannelOpenTry(provider.ChannelInfo{}, provider.ChannelProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgConnectionOpenConfirm(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgConnectionOpenConfirm(provider.ConnectionInfo{}, provider.ConnectionProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgRegisterCounterpartyPayee(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgRegisterCounterpartyPayee("", "", "", "")
			require.Empty(t, res)
		})
	}
}

func TestMsgSubmitMisbehaviour(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgSubmitMisbehaviour("", nil)
			require.Empty(t, res)
		})
	}
}

func TestMsgSubmitQueryResponse(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgSubmitQueryResponse("", "", provider.ICQProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgTimeoutOnClose(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgTimeoutOnClose(provider.PacketInfo{}, provider.PacketProof{})
			require.Empty(t, res)
		})
	}
}

func TestMsgUpgradeClient(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgUpgradeClient("", &clienttypes.QueryConsensusStateResponse{}, &clienttypes.QueryClientStateResponse{})
			require.Empty(t, res)
		})
	}
}

func TestPacketReceipt(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.PacketReceipt(context.Background(), provider.PacketInfo{}, 0)
			require.Empty(t, res)
		})
	}
}

func TestSdkError(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			err := cc.sdkError("", 0)
			require.Empty(t, err)
		})
	}
}

func TestMsgConnectionOpenTry(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.MsgConnectionOpenTry(provider.ConnectionInfo{}, provider.ConnectionProof{})
			require.Empty(t, res)
		})
	}
}

func TestBuildSignerConfig(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			txKey, feeKey, _ := cc.buildSignerConfig([]provider.RelayerMessage{})
			require.Empty(t, txKey)
			require.Empty(t, feeKey)
		})
	}
}

func TestMkTxResult(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.mkTxResult(&coretypes.ResultTx{})
			require.Empty(t, res)
		})
	}
}

func TestQueryIBCHeader(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.QueryIBCHeader(context.Background(), 0)
			require.Empty(t, res)
		})
	}
}

func TestNewClientState(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.NewClientState("", provider.TendermintIBCHeader{}, 0, 0, true, true)
			require.Empty(t, res)
		})
	}
}

func TestNextSeqRecv(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.NextSeqRecv(context.Background(), provider.PacketInfo{}, 0)
			require.Empty(t, res)
		})
	}
}

func TestUpdateFeesSpent(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			cc.UpdateFeesSpent("", "", "", sdk.Coins{})
			require.Empty(t, nil)
		})
	}
}

func TestQueryICQWithProof(t *testing.T) {
	testCases := []struct {
		name string
		err  error
	}{
		{
			name: "success",
			err:  nil,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cc := &CardanoProvider{}
			res, _ := cc.QueryICQWithProof(context.Background(), "", []byte{}, 0)
			require.Empty(t, res)
		})
	}
}

func TestMsgTimeout(t *testing.T) {
	testCases := []struct {
		name             string
		showAddressErr   error
		packetTimeoutErr error
		exErr            error
	}{
		{
			name:             "success",
			showAddressErr:   nil,
			packetTimeoutErr: nil,
			exErr:            nil,
		},
		{
			name:             "fail showAddressErr",
			showAddressErr:   fmt.Errorf("showAddressErr"),
			packetTimeoutErr: nil,
			exErr:            fmt.Errorf("showAddressErr"),
		},
		{
			name:             "fail packetTimeoutErr",
			showAddressErr:   nil,
			packetTimeoutErr: fmt.Errorf("packetTimeoutErr"),
			exErr:            fmt.Errorf("packetTimeoutErr"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {

			channelMsgServiceMock := new(services_mock.ChannelMsgServiceMock)
			channelMsgServiceMock.On("Timeout", context.Background(),
				&pbchannel.MsgTimeout{
					Packet: &pbchannel.Packet{
						Sequence:           0,
						SourcePort:         "",
						SourceChannel:      "",
						DestinationPort:    "",
						DestinationChannel: "",
						Data:               nil,
						TimeoutHeight: &types.Height{
							RevisionNumber: 0,
							RevisionHeight: 0,
						},
						TimeoutTimestamp: 0,
					},
					ProofUnreceived: []byte{},
					ProofHeight: &types.Height{
						RevisionNumber: 0,
						RevisionHeight: 0,
					},
					NextSequenceRecv: 0,
					Signer:           "Address",
				},
				[]grpc.CallOption(nil)).Return(0, tc.packetTimeoutErr)

			cc := CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{ChannelMsgService: channelMsgServiceMock},
			}

			response, err := cc.MsgTimeout(provider.PacketInfo{
				Height:        0,
				Sequence:      0,
				SourcePort:    "",
				SourceChannel: "",
				DestPort:      "",
				DestChannel:   "",
				ChannelOrder:  "",
				Data:          nil,
				TimeoutHeight: types.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TimeoutTimestamp: 0,
				Ack:              nil,
			}, provider.PacketProof{
				Proof: []byte{},
				ProofHeight: types.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestTimeoutRefresh(t *testing.T) {
	testCases := []struct {
		name                 string
		showAddressErr       error
		channelMsgServiceErr error
		exErr                error
	}{
		{
			name:                 "success",
			showAddressErr:       nil,
			channelMsgServiceErr: nil,
			exErr:                nil,
		},
		{
			name:                 "fail showAddressErr",
			showAddressErr:       fmt.Errorf("showAddressErr"),
			channelMsgServiceErr: nil,
			exErr:                fmt.Errorf("showAddressErr"),
		},
		{
			name:                 "fail channelMsgServiceErr",
			showAddressErr:       nil,
			channelMsgServiceErr: fmt.Errorf("channelMsgServiceErr"),
			exErr:                fmt.Errorf("channelMsgServiceErr"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {

			channelMsgServiceMock := new(services_mock.ChannelMsgServiceMock)
			channelMsgServiceMock.On("TimeoutRefresh",
				context.Background(),
				&pbchannel.MsgTimeoutRefresh{
					ChannelId: "",
					Signer:    "Address",
				},
				[]grpc.CallOption(nil)).Return("TypeUrl", "Value", tc.channelMsgServiceErr)

			cc := CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{ChannelMsgService: channelMsgServiceMock},
			}
			response, err := cc.MsgTimeoutRefresh("")
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
				require.Nil(t, err)
			}
		})
	}
}

func TestSendMessages(t *testing.T) {
	testCases := []struct {
		name               string
		msgs               []provider.RelayerMessage
		memo               string
		asyncCallbacks     []func(*provider.RelayerTxResponse, error)
		err                error
		signAndSubmitTxErr error
		TypeProviderErr    error
	}{
		{
			name: "success",
			msgs: []provider.RelayerMessage{
				CardanoMessage{
					Msg: &clienttypes.MsgUpdateClient{
						ClientId:      "ibc_client-16",
						ClientMessage: nil,
						Signer:        "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
					},
					UnsignedTx: &anypb.Any{
						TypeUrl: "/ibc.clients.cardano.v1.BlockData",
						Value:   []byte{10, 2, 16, 100},
					},
					SetSigner:        nil,
					FeegrantDisabled: false,
				},
			},
			err:                nil,
			signAndSubmitTxErr: nil,
			TypeProviderErr:    nil,
		},
		{
			name: "fail signAndSubmitTxErr",
			msgs: []provider.RelayerMessage{
				CardanoMessage{
					Msg: &clienttypes.MsgUpdateClient{
						ClientId:      "ibc_client-16",
						ClientMessage: nil,
						Signer:        "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
					},
					UnsignedTx: &anypb.Any{
						TypeUrl: "/ibc.clients.cardano.v1.BlockData",
						Value:   []byte{10, 2, 16, 100},
					},
					SetSigner:        nil,
					FeegrantDisabled: false,
				},
			},
			err:                nil,
			signAndSubmitTxErr: fmt.Errorf("signAndSubmitTxErr"),
			TypeProviderErr:    nil,
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer

			typeProviderMock := new(services_mock.TypeProvider)
			typeProviderMock.On("TransactionByHash",
				context.Background(),
				&ibcclient.QueryTransactionByHashRequest{
					Hash: "txId",
				},
				[]grpc.CallOption(nil)).Return("hash", 0, 0, 0, tc.TypeProviderErr)
			cc := &CardanoProvider{
				PCfg: CardanoProviderConfig{
					Key:     "KeyName",
					ChainID: "ChainId",
				},
				GateWay: services.Gateway{TypeProvider: typeProviderMock},
			}

			cc.log = zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))

			_, _, err := cc.SendMessages(context.Background(), tc.msgs, tc.memo)
			if tc.signAndSubmitTxErr != nil {
				require.EqualError(t, err, tc.signAndSubmitTxErr.Error())
			} else {
				require.Empty(t, nil, "")
			}
		})
	}
}
