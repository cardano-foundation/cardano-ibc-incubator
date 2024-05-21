package services

import (
	"context"
	"fmt"
	"github.com/cardano/relayer/v1/package/mithril"
	"testing"

	pbclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	pbconnection "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/services_mock"
	"github.com/cosmos/cosmos-sdk/codec/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/anypb"
)

var gw Gateway

func TestNewGateWayService(t *testing.T) {
	t.Run("NewGateWayService Success", func(t *testing.T) {
		err := gw.NewGateWayService("192.168.11.72:5001")
		require.NoError(t, err)
		require.NotEmpty(t, gw.ChannelQueryService)
		require.NotEmpty(t, gw.ClientMsgService)
		require.NotEmpty(t, gw.ConnectionQueryService)
		require.NotEmpty(t, gw.ConnectionMsgService)
		require.NotEmpty(t, gw.ChannelMsgService)
		require.NotEmpty(t, gw.TypeProvider)
	})
	t.Run("NewGateWayService Fail", func(t *testing.T) {
		err := gw.NewGateWayService("")
		require.Error(t, err)
	})
}

func TestGetLastHeight(t *testing.T) {
	t.Run("GetLastHeight Success", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		mockService.On(
			"LatestHeight",
			context.Background(),
			&pbclient.QueryLatestHeightRequest{},
			[]grpc.CallOption(nil)).Return(1, nil)
		gw.ClientQueryService = mockService
		height, err := gw.GetLastHeight()
		require.NoError(t, err)
		require.Equal(t, uint64(1), height)
		mockService.AssertCalled(
			t,
			"LatestHeight",
			context.Background(),
			&pbclient.QueryLatestHeightRequest{},
			[]grpc.CallOption(nil))
	})
	t.Run("GetLastHeight Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		exErr := fmt.Errorf("GetLastHeight expected error")
		mockService.On(
			"LatestHeight",
			context.Background(),
			&pbclient.QueryLatestHeightRequest{},
			[]grpc.CallOption(nil)).Return(0, exErr)
		gw.ClientQueryService = mockService
		height, err := gw.GetLastHeight()
		require.Equal(t, exErr, err)
		require.Equal(t, uint64(0), height)
		mockService.AssertCalled(
			t,
			"LatestHeight",
			context.Background(),
			&pbclient.QueryLatestHeightRequest{},
			[]grpc.CallOption(nil))
	})
}

func TestQueryClientState(t *testing.T) {
	t.Run("TestQueryClientState Success", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		mockService.On(
			"ClientState",
			context.Background(),
			&pbclient.QueryClientStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"clientStateTypeUrl",
			"clientStateValue",
			"resProof",
			99999,
			nil)
		gw.ClientQueryService = mockService
		clientState, err := gw.QueryClientState("clientId", 9)
		require.NoError(t, err)
		require.NotEmpty(t, clientState)
		mockService.AssertCalled(
			t,
			"ClientState",
			context.Background(),
			&pbclient.QueryClientStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})
	t.Run("TestQueryClientState Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		exErr := fmt.Errorf("QueryClientState expected error")

		mockService.On(
			"ClientState",
			context.Background(),
			&pbclient.QueryClientStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"clientStateTypeUrl",
			"clientStateValue",
			"resProof",
			99999,
			exErr)
		gw.ClientQueryService = mockService
		clientState, err := gw.QueryClientState("clientId", 9)
		require.Equal(t, exErr, err)
		require.Empty(t, clientState)
		mockService.AssertCalled(
			t,
			"ClientState",
			context.Background(),
			&pbclient.QueryClientStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})
}

func TestQueryConsensusState(t *testing.T) {
	t.Run("TestQueryConsensusState Success", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		mockService.On(
			"ConsensusState",
			context.Background(),
			&pbclient.QueryConsensusStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"ConsensusStateTypeUrl",
			"ConsensusStateValue",
			"resProof",
			99999,
			nil)

		gw.ClientQueryService = mockService
		consensusState, err := gw.QueryConsensusState("clientId", 9)
		require.NoError(t, err)
		require.NotEmpty(t, consensusState)
		require.Equal(t, uint64(99999), consensusState.ProofHeight.RevisionHeight)
		mockService.AssertCalled(t, "ConsensusState",
			context.Background(),
			&pbclient.QueryConsensusStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})
	t.Run("TestQueryConsensusState Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		exErr := fmt.Errorf("QueryConsensusState expected error")

		mockService.On(
			"ConsensusState",
			context.Background(),
			&pbclient.QueryConsensusStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"ConsensusStateTypeUrl",
			"ConsensusStateValue",
			"resProof",
			99999,
			exErr)

		gw.ClientQueryService = mockService
		consensusState, err := gw.QueryConsensusState("clientId", 9)
		require.Equal(t, exErr, err)
		require.Empty(t, consensusState)
		mockService.AssertCalled(t, "ConsensusState",
			context.Background(),
			&pbclient.QueryConsensusStateRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})
}

func TestQueryCardanoState(t *testing.T) {
	t.Run("QueryCardanoState Success", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		mockService.On(
			"NewClient",
			context.Background(),
			&pbclient.QueryNewClientRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"ClientStateTypeUrl",
			"ClientStateValue",
			"ConsensusStateTypeUrl",
			"ConsensusStateValue", nil)
		gw.ClientQueryService = mockService
		cardanoState, err := gw.QueryCardanoState(9)
		require.NoError(t, err)
		require.NotEmpty(t, cardanoState)
		mockService.AssertCalled(t, "NewClient",
			context.Background(),
			&pbclient.QueryNewClientRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})

	t.Run("QueryCardanoState Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		exErr := fmt.Errorf("QueryCardanoState expected error")
		mockService.On(
			"NewClient",
			context.Background(),
			&pbclient.QueryNewClientRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil)).Return(
			"ClientStateTypeUrl",
			"ClientStateValue",
			"ConsensusStateTypeUrl",
			"ConsensusStateValue", exErr)
		gw.ClientQueryService = mockService
		cardanoState, err := gw.QueryCardanoState(9)
		require.Error(t, err)
		require.Empty(t, cardanoState)
		mockService.AssertCalled(t, "NewClient",
			context.Background(),
			&pbclient.QueryNewClientRequest{
				Height: 9,
			},
			[]grpc.CallOption(nil))
	})
}

func TestQueryBlockData(t *testing.T) {
	t.Run("QueryBlockData Success", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		mockService.On(
			"BlockData",
			context.Background(),
			&pbclient.QueryBlockDataRequest{
				Height: 9,
			}, []grpc.CallOption(nil)).Return(
			"BlockDataTypeUrl", "BlockDataValue", nil)
		gw.ClientQueryService = mockService
		blockData, err := gw.QueryBlockData(context.Background(), 9)
		require.NoError(t, err)
		require.NotEmpty(t, blockData)
	})

	t.Run("QueryBlockData Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientQueryService)
		exErr := fmt.Errorf("QueryBlockData expected error")
		mockService.On(
			"BlockData",
			context.Background(),
			&pbclient.QueryBlockDataRequest{
				Height: 9,
			}, []grpc.CallOption(nil)).Return(
			"BlockDataTypeUrl", "BlockDataValue", exErr)
		gw.ClientQueryService = mockService
		blockData, err := gw.QueryBlockData(context.Background(), 9)
		require.Error(t, err)
		require.Empty(t, blockData)
	})
}

func TestCreateClient(t *testing.T) {
	t.Run("CreateClient Success", func(t *testing.T) {
		mockService := new(services_mock.ClientMsgService)
		mockService.On(
			"CreateClient",
			context.Background(),
			&pbclient.MsgCreateClient{
				ClientState:    &anypb.Any{TypeUrl: "clientStateTypeUrl", Value: []byte("")},
				ConsensusState: &anypb.Any{TypeUrl: "ConsensusStateTypeUrl", Value: []byte("")},
				Signer:         "signer",
			}, []grpc.CallOption(nil)).Return(
			"UnsignedTxTypeUrl",
			"UnsignedTxValue",
			"clientId", nil)
		gw.ClientMsgService = mockService
		unsigned, err := gw.CreateClient(context.Background(),
			&types.Any{TypeUrl: "clientStateTypeUrl", Value: []byte("")},
			&types.Any{TypeUrl: "ConsensusStateTypeUrl", Value: []byte("")},
			"signer")
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)

	})

	t.Run("CreateClient Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientMsgService)
		exErr := fmt.Errorf("CreateClient expected error")
		mockService.On(
			"CreateClient",
			context.Background(),
			&pbclient.MsgCreateClient{
				ClientState:    &anypb.Any{TypeUrl: "clientStateTypeUrl", Value: []byte("")},
				ConsensusState: &anypb.Any{TypeUrl: "ConsensusStateTypeUrl", Value: []byte("")},
				Signer:         "signer",
			}, []grpc.CallOption(nil)).Return(
			"UnsignedTxTypeUrl",
			"UnsignedTxValue",
			"clientId", exErr)
		gw.ClientMsgService = mockService
		unsigned, err := gw.CreateClient(context.Background(),
			&types.Any{TypeUrl: "clientStateTypeUrl", Value: []byte("")},
			&types.Any{TypeUrl: "ConsensusStateTypeUrl", Value: []byte("")},
			"signer")
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestUpdateClient(t *testing.T) {
	t.Run("UpdateClient Success", func(t *testing.T) {
		mockService := new(services_mock.ClientMsgService)
		mockService.On(
			"UpdateClient",
			context.Background(),
			&pbclient.MsgUpdateClient{
				ClientId: "clientId",
				ClientMessage: &anypb.Any{
					TypeUrl: "ClientMessageTypeUrl",
					Value:   []byte("ClientMessageValue"),
				},
				Signer: "signer",
			}, []grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ClientMsgService = mockService
		unsigned, err := gw.UpdateClient(context.Background(),
			&pbclient.MsgUpdateClient{
				ClientId: "clientId",
				ClientMessage: &anypb.Any{
					TypeUrl: "ClientMessageTypeUrl",
					Value:   []byte("ClientMessageValue"),
				},
				Signer: "signer"})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})

	t.Run("UpdateClient Fail", func(t *testing.T) {
		mockService := new(services_mock.ClientMsgService)
		exErr := fmt.Errorf("UpdateClient expected error")
		mockService.On(
			"UpdateClient",
			context.Background(),
			&pbclient.MsgUpdateClient{
				ClientId: "clientId",
				ClientMessage: &anypb.Any{
					TypeUrl: "ClientMessageTypeUrl",
					Value:   []byte("ClientMessageValue"),
				},
				Signer: "signer",
			}, []grpc.CallOption(nil)).Return(
			"UnsignedTxTypeUrl",
			"UnsignedTxValue", exErr)
		gw.ClientMsgService = mockService
		unsigned, err := gw.UpdateClient(context.Background(),
			&pbclient.MsgUpdateClient{
				ClientId: "clientId",
				ClientMessage: &anypb.Any{
					TypeUrl: "ClientMessageTypeUrl",
					Value:   []byte("ClientMessageValue"),
				},
				Signer: "signer"})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestConnectionOpenInit(t *testing.T) {
	t.Run("ConnectionOpenInit Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		mockService.On(
			"ConnectionOpenInit",
			context.Background(),
			&pbconnection.MsgConnectionOpenInit{}, []grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ConnectionMsgService = mockService

		unsigned, err := gw.ConnectionOpenInit(context.Background(), &pbconnection.MsgConnectionOpenInit{})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})

	t.Run("ConnectionOpenInit Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		exErr := fmt.Errorf("ConnectionOpenInit expected error")
		mockService.On(
			"ConnectionOpenInit",
			context.Background(),
			&pbconnection.MsgConnectionOpenInit{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)
		gw.ConnectionMsgService = mockService

		unsigned, err := gw.ConnectionOpenInit(
			context.Background(), &pbconnection.MsgConnectionOpenInit{})
		require.Error(t, err)
		require.Empty(t, unsigned)

		mockService.AssertCalled(t, "ConnectionOpenInit",
			context.Background(),
			&pbconnection.MsgConnectionOpenInit{}, []grpc.CallOption(nil))
	})
}

func TestConnectionOpenTry(t *testing.T) {
	t.Run("ConnectionOpenTry Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		inputClientState := &types.Any{
			TypeUrl: "",
			Value:   nil,
		}
		mockService.On("ConnectionOpenTry",
			context.Background(),
			&pbconnection.MsgConnectionOpenTry{
				ClientId:             "",
				PreviousConnectionId: "",
				ClientState: &anypb.Any{
					TypeUrl: inputClientState.TypeUrl,
					Value:   inputClientState.Value,
				},
				Counterparty: &pbconnection.Counterparty{
					ClientId:     "",
					ConnectionId: "",
					Prefix:       &commitmenttypes.MerklePrefix{},
				},
				DelayPeriod: 0,
				CounterpartyVersions: []*pbconnection.Version{&pbconnection.Version{
					Identifier: "",
					Features:   []string{"feature"},
				}},
				ProofHeight:             &clienttypes.Height{},
				ProofInit:               nil,
				ProofClient:             nil,
				ProofConsensus:          nil,
				ConsensusHeight:         &clienttypes.Height{},
				Signer:                  "",
				HostConsensusStateProof: nil,
			},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenTry(context.Background(), &conntypes.MsgConnectionOpenTry{
			ClientId:             "",
			PreviousConnectionId: "",
			ClientState:          inputClientState,
			Counterparty: conntypes.Counterparty{
				ClientId:     "",
				ConnectionId: "",
				Prefix:       commitmenttypes.MerklePrefix{},
			},
			DelayPeriod: 0,
			CounterpartyVersions: []*conntypes.Version{&conntypes.Version{
				Identifier: "",
				Features:   []string{"feature"},
			}},
			ProofHeight:             clienttypes.Height{},
			ProofInit:               nil,
			ProofClient:             nil,
			ProofConsensus:          nil,
			ConsensusHeight:         clienttypes.Height{},
			Signer:                  "",
			HostConsensusStateProof: nil,
		})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})
	t.Run("ConnectionOpenTry Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		inputClientState := &types.Any{
			TypeUrl: "",
			Value:   nil,
		}
		exErr := fmt.Errorf("ConnectionOpenTry expected error")
		mockService.On("ConnectionOpenTry",
			context.Background(),
			&pbconnection.MsgConnectionOpenTry{
				ClientId:             "",
				PreviousConnectionId: "",
				ClientState: &anypb.Any{
					TypeUrl: inputClientState.TypeUrl,
					Value:   inputClientState.Value,
				},
				Counterparty: &pbconnection.Counterparty{
					ClientId:     "",
					ConnectionId: "",
					Prefix:       &commitmenttypes.MerklePrefix{},
				},
				DelayPeriod:             0,
				CounterpartyVersions:    []*pbconnection.Version{},
				ProofHeight:             &clienttypes.Height{},
				ProofInit:               nil,
				ProofClient:             nil,
				ProofConsensus:          nil,
				ConsensusHeight:         &clienttypes.Height{},
				Signer:                  "",
				HostConsensusStateProof: nil,
			},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)
		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenTry(context.Background(), &conntypes.MsgConnectionOpenTry{
			ClientId:             "",
			PreviousConnectionId: "",
			ClientState:          inputClientState,
			Counterparty: conntypes.Counterparty{
				ClientId:     "",
				ConnectionId: "",
				Prefix:       commitmenttypes.MerklePrefix{},
			},
			DelayPeriod:             0,
			CounterpartyVersions:    []*conntypes.Version{},
			ProofHeight:             clienttypes.Height{},
			ProofInit:               nil,
			ProofClient:             nil,
			ProofConsensus:          nil,
			ConsensusHeight:         clienttypes.Height{},
			Signer:                  "",
			HostConsensusStateProof: nil,
		})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestConnectionOpenAck(t *testing.T) {
	t.Run("ConnectionOpenAck Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		mockService.On("ConnectionOpenAck",
			context.Background(),
			&pbconnection.MsgConnectionOpenAck{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)

		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenAck(context.Background(), &pbconnection.MsgConnectionOpenAck{})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})
	t.Run("ConnectionOpenAck Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		exErr := fmt.Errorf("ConnectionOpenAck expected error")
		mockService.On("ConnectionOpenAck",
			context.Background(),
			&pbconnection.MsgConnectionOpenAck{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)

		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenAck(context.Background(), &pbconnection.MsgConnectionOpenAck{})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestConnectionOpenConfirm(t *testing.T) {
	t.Run("ConnectionOpenConfirm Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		mockService.On(
			"ConnectionOpenConfirm",
			context.Background(),
			&pbconnection.MsgConnectionOpenConfirm{
				ConnectionId: "",
				ProofAck:     nil,
				ProofHeight:  &clienttypes.Height{},
				Signer:       "",
			}, []grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)

		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenConfirm(context.Background(),
			&conntypes.MsgConnectionOpenConfirm{
				ConnectionId: "",
				ProofAck:     nil,
				ProofHeight:  clienttypes.Height{},
				Signer:       "",
			})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})

	t.Run("ConnectionOpenConfirm Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionMsgServiceMock)
		exErr := fmt.Errorf("ConnectionOpenConfirm expected error")
		mockService.On(
			"ConnectionOpenConfirm",
			context.Background(),
			&pbconnection.MsgConnectionOpenConfirm{
				ConnectionId: "",
				ProofAck:     nil,
				ProofHeight:  &clienttypes.Height{},
				Signer:       "",
			}, []grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)

		gw.ConnectionMsgService = mockService
		unsigned, err := gw.ConnectionOpenConfirm(context.Background(),
			&conntypes.MsgConnectionOpenConfirm{
				ConnectionId: "",
				ProofAck:     nil,
				ProofHeight:  clienttypes.Height{},
				Signer:       "",
			})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestChannelOpenInit(t *testing.T) {
	t.Run("ChannelOpenInit Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("ChannelOpenInit",
			context.Background(),
			&pbchannel.MsgChannelOpenInit{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ChannelMsgService = mockService

		unsigned, err := gw.ChannelOpenInit(context.Background(), &pbchannel.MsgChannelOpenInit{})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})
	t.Run("ChannelOpenInit Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("ChannelOpenInit expected error")
		mockService.On("ChannelOpenInit",
			context.Background(),
			&pbchannel.MsgChannelOpenInit{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)
		gw.ChannelMsgService = mockService

		unsigned, err := gw.ChannelOpenInit(context.Background(), &pbchannel.MsgChannelOpenInit{})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestChannelOpenAck(t *testing.T) {
	t.Run("ChannelOpenAck Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("ChannelOpenAck",
			context.Background(),
			&pbchannel.MsgChannelOpenAck{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ChannelMsgService = mockService
		unsigned, err := gw.ChannelOpenAck(context.Background(), &pbchannel.MsgChannelOpenAck{})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})

	t.Run("ChannelOpenAck Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("ChannelOpenAck expected error")
		mockService.On("ChannelOpenAck",
			context.Background(),
			&pbchannel.MsgChannelOpenAck{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)
		gw.ChannelMsgService = mockService
		unsigned, err := gw.ChannelOpenAck(context.Background(), &pbchannel.MsgChannelOpenAck{})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestRecvPacket(t *testing.T) {
	t.Run("RecvPacket Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("RecvPacket",
			context.Background(),
			&pbchannel.MsgRecvPacket{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", nil)
		gw.ChannelMsgService = mockService
		unsigned, err := gw.RecvPacket(context.Background(),
			&pbchannel.MsgRecvPacket{})
		require.NoError(t, err)
		require.NotEmpty(t, unsigned)
	})

	t.Run("RecvPacket Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("RecvPacket expected error")

		mockService.On("RecvPacket",
			context.Background(),
			&pbchannel.MsgRecvPacket{},
			[]grpc.CallOption(nil)).Return("UnsignedTxTypeUrl", "UnsignedTxValue", exErr)
		gw.ChannelMsgService = mockService
		unsigned, err := gw.RecvPacket(context.Background(),
			&pbchannel.MsgRecvPacket{})
		require.Error(t, err)
		require.Empty(t, unsigned)
	})
}

func TestPacketAcknowledgement(t *testing.T) {
	t.Run("PacketAcknowledgement Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("Acknowledgement",
			context.Background(),
			&pbchannel.MsgAcknowledgement{},
			[]grpc.CallOption(nil)).Return(9, nil)

		gw.ChannelMsgService = mockService
		response, err := gw.PacketAcknowledgement(context.Background(), &pbchannel.MsgAcknowledgement{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
		require.Equal(t, pbchannel.ResponseResultType(9), response.Result)

	})

	t.Run("PacketAcknowledgement Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("PacketAcknowledgement expected error")
		mockService.On("Acknowledgement",
			context.Background(),
			&pbchannel.MsgAcknowledgement{},
			[]grpc.CallOption(nil)).Return(9, exErr)

		gw.ChannelMsgService = mockService
		response, err := gw.PacketAcknowledgement(context.Background(), &pbchannel.MsgAcknowledgement{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestPacketTimeout(t *testing.T) {
	t.Run("PacketTimeout Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("Timeout", context.Background(),
			&pbchannel.MsgTimeout{},
			[]grpc.CallOption(nil)).Return(9, nil)
		gw.ChannelMsgService = mockService
		response, err := gw.PacketTimeout(context.Background(), &pbchannel.MsgTimeout{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
	t.Run("PacketTimeout Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("PacketTimeout expected error")
		mockService.On("Timeout", context.Background(),
			&pbchannel.MsgTimeout{},
			[]grpc.CallOption(nil)).Return(9, exErr)
		gw.ChannelMsgService = mockService
		response, err := gw.PacketTimeout(context.Background(), &pbchannel.MsgTimeout{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestPacketTimeoutOnClose(t *testing.T) {
	t.Run("PacketTimeoutOnClose Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		mockService.On("TimeoutOnClose", context.Background(),
			&pbchannel.MsgTimeoutOnClose{},
			[]grpc.CallOption(nil)).Return(9, nil)
		gw.ChannelMsgService = mockService
		response, err := gw.PacketTimeoutOnClose(context.Background(), &pbchannel.MsgTimeoutOnClose{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
	t.Run("PacketTimeoutOnClose Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelMsgServiceMock)
		exErr := fmt.Errorf("PacketTimeoutOnClose expected error")
		mockService.On("TimeoutOnClose", context.Background(),
			&pbchannel.MsgTimeoutOnClose{},
			[]grpc.CallOption(nil)).Return(9, exErr)
		gw.ChannelMsgService = mockService
		response, err := gw.PacketTimeoutOnClose(context.Background(), &pbchannel.MsgTimeoutOnClose{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestChannels(t *testing.T) {
	t.Run("Channels Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("Channels",
			context.Background(),
			&pbchannel.QueryChannelsRequest{},
			[]grpc.CallOption(nil),
		).Return(1, 1, "PortId", "ChannelId",
			"ConnectionHops", "Version", "PortId", "ChannelId",
			"NextKey", 1, 1, nil)
		gw.ChannelQueryService = mockService
		response, err := gw.Channels(context.Background(), &pbchannel.QueryChannelsRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("Channels Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("ConnectionChannels expected error")
		mockService.On("Channels",
			context.Background(),
			&pbchannel.QueryChannelsRequest{},
			[]grpc.CallOption(nil),
		).Return(1, 1, "PortId", "ChannelId",
			"ConnectionHops", "Version", "PortId", "ChannelId",
			"NextKey", 1, 1, exErr)
		gw.ChannelQueryService = mockService
		response, err := gw.Channels(context.Background(), &pbchannel.QueryChannelsRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestConnectionChannels(t *testing.T) {
	t.Run("ConnectionChannels Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("ConnectionChannels",
			context.Background(),
			&pbchannel.QueryConnectionChannelsRequest{},
			[]grpc.CallOption(nil)).Return(1, 1, "PortId", "ChannelId",
			"ConnectionHops", "Version", "PortId", "ChannelId",
			"NextKey", 1, 1, nil)

		gw.ChannelQueryService = mockService
		response, err := gw.ConnectionChannels(context.Background(), &pbchannel.QueryConnectionChannelsRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("ConnectionChannels Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("ConnectionChannels expected error")
		mockService.On("ConnectionChannels",
			context.Background(),
			&pbchannel.QueryConnectionChannelsRequest{},
			[]grpc.CallOption(nil)).Return(1, 1, "PortId", "ChannelId",
			"ConnectionHops", "Version", "PortId", "ChannelId",
			"NextKey", 1, 1, exErr)

		gw.ChannelQueryService = mockService
		response, err := gw.ConnectionChannels(context.Background(), &pbchannel.QueryConnectionChannelsRequest{})
		require.Error(t, err)
		require.Equal(t, exErr, err)
		require.Empty(t, response)
	})
}

func TestChannel(t *testing.T) {
	t.Run("Channel Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("Channel", context.Background(),
			&pbchannel.QueryChannelRequest{},
			[]grpc.CallOption(nil)).Return(1, 1, "PortId",
			"ChannelId", "ConnectionHops", "Version", "Proof", 9, nil)
		gw.ChannelQueryService = mockService
		response, err := gw.Channel(context.Background(), &pbchannel.QueryChannelRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
	t.Run("Channel Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("Channel expected error")
		mockService.On("Channel", context.Background(),
			&pbchannel.QueryChannelRequest{},
			[]grpc.CallOption(nil)).Return(1, 1, "PortId",
			"ChannelId", "ConnectionHops", "Version", "Proof", 9, exErr)
		gw.ChannelQueryService = mockService
		response, err := gw.Channel(context.Background(), &pbchannel.QueryChannelRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestPacketCommitments(t *testing.T) {
	t.Run("PacketCommitments Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("PacketCommitments", context.Background(),
			&pbchannel.QueryPacketCommitmentsRequest{},
			[]grpc.CallOption(nil)).Return("PortId", "ChannelId",
			1, "Data", "NextKey", 1, 1, nil)
		gw.ChannelQueryService = mockService
		response, err := gw.PacketCommitments(context.Background(), &pbchannel.QueryPacketCommitmentsRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
	t.Run("PacketCommitments Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("PacketCommitments expected error")
		mockService.On("PacketCommitments", context.Background(),
			&pbchannel.QueryPacketCommitmentsRequest{},
			[]grpc.CallOption(nil)).Return("PortId", "ChannelId",
			1, "Data", "NextKey", 1, 1, exErr)
		gw.ChannelQueryService = mockService
		response, err := gw.PacketCommitments(context.Background(), &pbchannel.QueryPacketCommitmentsRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestPacketCommitment(t *testing.T) {
	t.Run("PacketCommitment Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("PacketCommitment",
			context.Background(),
			&pbchannel.QueryPacketCommitmentRequest{},
			[]grpc.CallOption(nil)).Return("Commitment", "Proof", 1, 1, nil)
		gw.ChannelQueryService = mockService
		response, err := gw.PacketCommitment(context.Background(), &pbchannel.QueryPacketCommitmentRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("PacketCommitment Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("PacketCommitment expected error")
		mockService.On("PacketCommitment",
			context.Background(),
			&pbchannel.QueryPacketCommitmentRequest{},
			[]grpc.CallOption(nil)).Return("Commitment", "Proof", 1, 1, exErr)
		gw.ChannelQueryService = mockService
		response, err := gw.PacketCommitment(context.Background(), &pbchannel.QueryPacketCommitmentRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestQueryPacketAcknowledgements(t *testing.T) {
	t.Run("QueryPacketAcknowledgements Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("PacketAcknowledgements",
			context.Background(),
			&pbchannel.QueryPacketAcknowledgementsRequest{},
			[]grpc.CallOption(nil)).Return(
			"PortId", "ChannelId", 1, "Data", "NextKey", 1, 1, nil)

		gw.ChannelQueryService = mockService
		response, err := gw.QueryPacketAcknowledgements(context.Background(), &pbchannel.QueryPacketAcknowledgementsRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("QueryPacketAcknowledgements Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("QueryPacketAcknowledgements expected error")
		mockService.On("PacketAcknowledgements",
			context.Background(),
			&pbchannel.QueryPacketAcknowledgementsRequest{},
			[]grpc.CallOption(nil)).Return(
			"PortId", "ChannelId", 1, "Data", "NextKey", 1, 1, exErr)

		gw.ChannelQueryService = mockService
		response, err := gw.QueryPacketAcknowledgements(context.Background(), &pbchannel.QueryPacketAcknowledgementsRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestQueryPacketAcknowledgement(t *testing.T) {
	t.Run("QueryPacketAcknowledgement Success", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		mockService.On("PacketAcknowledgement",
			context.Background(),
			&pbchannel.QueryPacketAcknowledgementRequest{},
			[]grpc.CallOption(nil)).Return(
			"Acknowledgement", "Proof", 1, nil)

		gw.ChannelQueryService = mockService
		response, err := gw.QueryPacketAcknowledgement(context.Background(), &pbchannel.QueryPacketAcknowledgementRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("QueryPacketAcknowledgement Fail", func(t *testing.T) {
		mockService := new(services_mock.ChannelQueryService)
		exErr := fmt.Errorf("QueryPacketAcknowledgement expected error")
		mockService.On("PacketAcknowledgement",
			context.Background(),
			&pbchannel.QueryPacketAcknowledgementRequest{},
			[]grpc.CallOption(nil)).Return(
			"Acknowledgement", "Proof", 1, exErr)

		gw.ChannelQueryService = mockService
		response, err := gw.QueryPacketAcknowledgement(context.Background(), &pbchannel.QueryPacketAcknowledgementRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestConnections(t *testing.T) {
	t.Run("Connections Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionQueryService)
		mockService.On("Connections",
			context.Background(), &pbconnection.QueryConnectionsRequest{},
			[]grpc.CallOption(nil)).Return("Identifier", "Features",
			"Id", "ClientId", 1, "ClientId", "ConnectionId", "KeyPrefix", 1,
			"NextKey", 1, 1, nil)

		gw.ConnectionQueryService = mockService

		response, err := gw.Connections(context.Background(), &pbconnection.QueryConnectionsRequest{})
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("Connections Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionQueryService)
		exErr := fmt.Errorf("Connections expected error")
		mockService.On("Connections",
			context.Background(), &pbconnection.QueryConnectionsRequest{},
			[]grpc.CallOption(nil)).Return("Identifier", "Features",
			"Id", "ClientId", 1, "ClientId", "ConnectionId", "KeyPrefix", 1,
			"NextKey", 1, 1, exErr)

		gw.ConnectionQueryService = mockService

		response, err := gw.Connections(context.Background(), &pbconnection.QueryConnectionsRequest{})
		require.Error(t, err)
		require.Empty(t, response)
	})
}
func TestQueryConnectionDetail(t *testing.T) {
	t.Run("QueryConnectionDetail Success", func(t *testing.T) {
		mockService := new(services_mock.ConnectionQueryService)
		mockService.On("Connection",
			context.Background(),
			&pbconnection.QueryConnectionRequest{
				ConnectionId: "connectionId",
			}, []grpc.CallOption(nil)).Return(
			"Identifier", "Features", "ClientId",
			1, "ClientId", "ConnectionId", "KeyPrefix", 1, "Proof",
			1, nil)

		gw.ConnectionQueryService = mockService
		response, err := gw.QueryConnectionDetail(context.Background(), "connectionId")
		require.NoError(t, err)
		require.NotEmpty(t, response)

	})

	t.Run("QueryConnectionDetail Fail", func(t *testing.T) {
		mockService := new(services_mock.ConnectionQueryService)
		exErr := fmt.Errorf("QueryConnectionDetail expected error")
		mockService.On("Connection",
			context.Background(),
			&pbconnection.QueryConnectionRequest{
				ConnectionId: "connectionId",
			}, []grpc.CallOption(nil)).Return(
			"Identifier", "Features", "ClientId",
			1, "ClientId", "ConnectionId", "KeyPrefix", 1, "Proof",
			1, exErr)

		gw.ConnectionQueryService = mockService
		response, err := gw.QueryConnectionDetail(context.Background(), "connectionId")
		require.Error(t, err)
		require.Empty(t, response)

	})
}

func TestQueryBlockResults(t *testing.T) {
	t.Run("QueryBlockResults Success", func(t *testing.T) {
		mockService := new(services_mock.TypeProvider)
		mockService.On("BlockResults", context.Background(),
			&ibcclient.QueryBlockResultsRequest{
				Height: 1,
			}, []grpc.CallOption(nil)).Return(
			"Key", "Value", true, "Type", 1, 1, nil)
		//gw.TypeProvider = mockService
		response, err := gw.QueryBlockResults(context.Background(), 1)
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})

	t.Run("QueryBlockResults Fail", func(t *testing.T) {
		mockService := new(services_mock.TypeProvider)
		exErr := fmt.Errorf("QueryBlockResults expected error")
		mockService.On("BlockResults", context.Background(),
			&ibcclient.QueryBlockResultsRequest{
				Height: 1,
			}, []grpc.CallOption(nil)).Return(
			"Key", "Value", true, "Type", 1, 1, exErr)
		//gw.TypeProvider = mockService
		response, err := gw.QueryBlockResults(context.Background(), 1)
		require.Error(t, err)
		require.Empty(t, response)
	})
}

func TestTransfer(t *testing.T) {
	testCases := []struct {
		name                 string
		channelMsgServiceErr error
		exErr                error
	}{
		{
			name:                 "success",
			channelMsgServiceErr: nil,
			exErr:                nil,
		},
		{
			name:                 "fail channelMsgServiceErr",
			channelMsgServiceErr: fmt.Errorf("channelMsgServiceErr"),
			exErr:                fmt.Errorf("channelMsgServiceErr"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelMsgServiceMock)

			mockService.On("Transfer", context.Background(),
				&pbchannel.MsgTransfer{}, []grpc.CallOption(nil)).Return("TypeUrl", "Value", tc.channelMsgServiceErr)

			gw.ChannelMsgService = mockService
			response, err := gw.Transfer(context.Background(), &pbchannel.MsgTransfer{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryUnreceivedPackets(t *testing.T) {
	testCases := []struct {
		name                string
		ChannelQueryService error
		exErr               error
	}{
		{
			name:                "success",
			ChannelQueryService: nil,
			exErr:               nil,
		},
		{
			name:                "fail ChannelQueryService",
			ChannelQueryService: fmt.Errorf("ChannelQueryService"),
			exErr:               fmt.Errorf("ChannelQueryService"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)

			mockService.On("UnreceivedPackets", context.Background(),
				&pbchannel.QueryUnreceivedPacketsRequest{}, []grpc.CallOption(nil)).Return(1, 1, tc.ChannelQueryService)

			gw.ChannelQueryService = mockService
			response, err := gw.QueryUnreceivedPackets(context.Background(), &pbchannel.QueryUnreceivedPacketsRequest{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}
func TestQueryTransactionByHash(t *testing.T) {
	testCases := []struct {
		name         string
		TypeProvider error
		exErr        error
	}{
		{
			name:         "success",
			TypeProvider: nil,
			exErr:        nil,
		},
		{
			name:         "fail TypeProvider",
			TypeProvider: fmt.Errorf("TypeProvider"),
			exErr:        fmt.Errorf("TypeProvider"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.TypeProvider)

			mockService.On("TransactionByHash", context.Background(),
				&ibcclient.QueryTransactionByHashRequest{}, []grpc.CallOption(nil)).Return("", 1, 1, 1, tc.TypeProvider)

			//gw.TypeProvider = mockService
			response, err := gw.QueryTransactionByHash(context.Background(), &ibcclient.QueryTransactionByHashRequest{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryBlockSearch(t *testing.T) {
	testCases := []struct {
		name         string
		TypeProvider error
		exErr        error
	}{
		{
			name:         "success",
			TypeProvider: nil,
			exErr:        nil,
		},
		{
			name:         "fail TypeProvider",
			TypeProvider: fmt.Errorf("TypeProvider"),
			exErr:        fmt.Errorf("TypeProvider"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.TypeProvider)

			mockService.On("BlockSearch", context.Background(),
				&ibcclient.QueryBlockSearchRequest{
					PacketSrcChannel: "",
					PacketDstChannel: "",
					PacketSequence:   "",
					Limit:            0,
					Page:             0,
				}, []grpc.CallOption(nil)).Return(0, 1, 2, tc.TypeProvider)

			//gw.TypeProvider = mockService
			response, err := gw.QueryBlockSearch(context.Background(),
				"", "", "",
				0, 0)
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
		name              string
		ChannelMsgService error
		exErr             error
	}{
		{
			name:              "success",
			ChannelMsgService: nil,
			exErr:             nil,
		},
		{
			name:              "fail ChannelMsgService",
			ChannelMsgService: fmt.Errorf("ChannelMsgService"),
			exErr:             fmt.Errorf("ChannelMsgService"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelMsgServiceMock)

			mockService.On("TimeoutRefresh", context.Background(),
				&pbchannel.MsgTimeoutRefresh{},
				[]grpc.CallOption(nil)).Return("", "", tc.ChannelMsgService)

			gw.ChannelMsgService = mockService
			response, err := gw.TimeoutRefresh(context.Background(),
				&pbchannel.MsgTimeoutRefresh{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestProofUnreceivedPackets(t *testing.T) {
	testCases := []struct {
		name                string
		ChannelQueryService error
		exErr               error
	}{
		{
			name:                "success",
			ChannelQueryService: nil,
			exErr:               nil,
		},
		{
			name:                "fail ChannelQueryService",
			ChannelQueryService: fmt.Errorf("ChannelQueryService"),
			exErr:               fmt.Errorf("ChannelQueryService"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)

			mockService.On("ProofUnreceivedPackets", context.Background(),
				&pbchannel.QueryProofUnreceivedPacketsRequest{},
				[]grpc.CallOption(nil)).Return("", 0, 0, tc.ChannelQueryService)

			gw.ChannelQueryService = mockService
			response, err := gw.ProofUnreceivedPackets(context.Background(),
				&pbchannel.QueryProofUnreceivedPacketsRequest{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryUnreceivedAcknowledgements(t *testing.T) {
	testCases := []struct {
		name                string
		ChannelQueryService error
		exErr               error
	}{
		{
			name:                "success",
			ChannelQueryService: nil,
			exErr:               nil,
		},
		{
			name:                "fail ChannelQueryService",
			ChannelQueryService: fmt.Errorf("ChannelQueryService"),
			exErr:               fmt.Errorf("ChannelQueryService"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)

			mockService.On("UnreceivedAcks", context.Background(),
				&pbchannel.QueryUnreceivedAcksRequest{},
				[]grpc.CallOption(nil)).Return(0, 0, 0, tc.ChannelQueryService)

			gw.ChannelQueryService = mockService
			response, err := gw.QueryUnreceivedAcknowledgements(context.Background(),
				&pbchannel.QueryUnreceivedAcksRequest{})
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryIBCHeader(t *testing.T) {
	t.Run("QueryIBCHeader Success", func(t *testing.T) {
		gw.MithrilService = mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		response, err := gw.QueryIBCHeader(context.Background(), 11476)
		require.NoError(t, err)
		require.NotEmpty(t, response)
	})
}
