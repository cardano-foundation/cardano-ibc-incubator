package cardano

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	pbclient "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	pbconnection "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcclient "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/services"
	"github.com/cardano/relayer/v1/package/services_mock"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/module"
	"github.com/cardano/relayer/v1/relayer/provider"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc"
	"testing"
)

func TestQueryChannel(t *testing.T) {

	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},
		{
			name:  "err contain not found",
			exErr: fmt.Errorf("not found"),
		},
		{
			name:  "err not contain not found",
			exErr: fmt.Errorf("test query channel"),
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("Channel", context.Background(),
				&pbchannel.QueryChannelRequest{},
				[]grpc.CallOption(nil)).Return(1, 1, "PortId",
				"ChannelId", "ConnectionHops", "Version", "Proof", 9, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}
			response, err := cc.QueryChannel(context.Background(), 0, "", "")
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryClientState(t *testing.T) {
	testCases := []struct {
		name             string
		typeUrl          string
		clientStateValue string
		exErr            error
	}{
		{
			name:             "success",
			typeUrl:          "/ibc.lightclients.tendermint.v1.ClientState",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			exErr:            nil,
		},
		{
			name:             "fail to query client state",
			typeUrl:          "/ibc.lightclients.tendermint.v1.ClientState",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			exErr:            fmt.Errorf("fail to query client state"),
		},
		{
			name:             "fail to parse data",
			typeUrl:          "ClientState",
			clientStateValue: "clientStateValue",
			exErr:            nil,
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
				tc.typeUrl,
				tc.clientStateValue,
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				210173,
				tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}
			response, err := cc.QueryClientState(context.Background(), 9, "")
			if tc.name == "fail to parse data" {
				require.Error(t, err)
			} else {
				if err != nil {
					require.EqualError(t, err, tc.exErr.Error())
				} else {
					require.NotEmpty(t, response)
				}
			}
		})
	}
}

func TestQueryClientStateResponse(t *testing.T) {
	testCases := []struct {
		name             string
		typeUrl          string
		clientStateValue string
		exErr            error
	}{
		{
			name:             "success",
			typeUrl:          "/ibc.lightclients.tendermint.v1.ClientState",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			exErr:            nil,
		},
		{
			name:             "fail to query client state",
			typeUrl:          "/ibc.lightclients.tendermint.v1.ClientState",
			clientStateValue: string([]byte{10, 18, 55, 51, 54, 57, 54, 52, 54, 53, 54, 51, 54, 56, 54, 49, 54, 57, 54, 101, 18, 4, 8, 1, 16, 3, 26, 4, 8, 128, 163, 5, 34, 4, 8, 128, 223, 110, 42, 3, 8, 216, 4, 50, 0, 58, 4, 16, 158, 223, 43, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 33, 24, 4, 32, 12, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 66, 72, 10, 47, 8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 24, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 42, 1, 211, 18, 21, 10, 2, 0, 1, 16, 32, 24, 1, 32, 1, 48, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1}),
			exErr:            fmt.Errorf("fail to query client state"),
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
				tc.typeUrl,
				tc.clientStateValue,
				"0-210173/client/cb4c4a7c0b0aa83640ae6545c7c51d34c892aee67cc38c157cf56994e0889473/1",
				210173,
				tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}
			response, err := cc.QueryClientStateResponse(context.Background(), 9, "")
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryConsensusState(t *testing.T) {

	testCases := []struct {
		name    string
		typeUrl string
		Value   string
		exErr   error
	}{
		{
			name:    "success",
			typeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState",
			Value:   string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
			exErr:   nil,
		},
		{
			name:    "fail to query client state",
			typeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState",
			Value:   string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
			exErr:   fmt.Errorf("fail to query client state"),
		},
		{
			name:    "fail to parse data",
			typeUrl: "ClientState",
			Value:   "clientStateValue",
			exErr:   nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ClientQueryService)
			mockService.On("ConsensusState", context.Background(),
				&pbclient.QueryConsensusStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				tc.typeUrl,
				tc.Value,
				"0-212218/consensus/749d9b2194341dbd7ce7f8787c6d85290351aeafa7dd38da3894e472997f04a4/0",
				212218,
				tc.exErr,
			)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}
			response, height, err := cc.QueryConsensusState(context.Background(), 9)
			if tc.name == "fail to parse data" {
				require.Error(t, err)
			} else {
				if err != nil {
					require.EqualError(t, err, tc.exErr.Error())
				} else {
					require.NotEmpty(t, height)
					require.NotEmpty(t, response)
				}
			}
		})
	}
}

func TestQueryLatestHeight(t *testing.T) {
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
			mockService := new(services_mock.ClientQueryService)
			mockService.On(
				"LatestHeight",
				context.Background(),
				&pbclient.QueryLatestHeightRequest{},
				[]grpc.CallOption(nil)).Return(1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}
			response, err := cc.QueryLatestHeight(context.Background())
			if err != nil {
				require.Error(t, err)
				require.Equal(t, -1, int(response))
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketCommitments(t *testing.T) {
	testCases := []struct {
		name    string
		nextKey string
		exErr   error
	}{
		{
			name:    "success",
			nextKey: "",
			exErr:   nil,
		},
		{
			name:    "fail",
			nextKey: "",
			exErr:   fmt.Errorf("expected error"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("PacketCommitments", context.Background(),
				&pbchannel.QueryPacketCommitmentsRequest{
					PortId:     "",
					ChannelId:  "",
					Pagination: DefaultPageRequest(),
				},
				[]grpc.CallOption(nil)).Return("PortId", "ChannelId",
				1, "Data", tc.nextKey, 1, 1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}
			response, err := cc.QueryPacketCommitments(context.Background(), 9, "", "")
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryBlockResults(t *testing.T) {
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
			mockService := new(services_mock.TypeProvider)
			mockService.On("BlockResults", context.Background(),
				&ibcclient.QueryBlockResultsRequest{
					Height: 1,
				}, []grpc.CallOption(nil)).Return(
				"Key", "Value", true, "Type", 1, 1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				TypeProvider: mockService,
			}}
			response, err := cc.QueryBlockResults(context.Background(), 1)
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}

}

func TestQueryClientConsensusState(t *testing.T) {
	testCases := []struct {
		name    string
		typeUrl string
		Value   string
		exErr   error
	}{
		{
			name:    "success",
			typeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState",
			Value:   string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
			exErr:   nil,
		},
		{
			name:    "fail to query client state",
			typeUrl: "/ibc.lightclients.tendermint.v1.ConsensusState",
			Value:   string([]byte{10, 12, 8, 205, 179, 181, 175, 6, 16, 128, 138, 149, 138, 1, 18, 50, 10, 48, 125, 253, 251, 245, 199, 117, 109, 230, 252, 243, 174, 244, 215, 141, 56, 209, 255, 118, 119, 142, 246, 235, 223, 29, 211, 142, 90, 225, 255, 52, 119, 71, 187, 233, 239, 31, 107, 93, 154, 127, 135, 221, 247, 79, 54, 219, 78, 180, 26, 48, 211, 159, 91, 127, 127, 91, 237, 199, 185, 125, 230, 158, 225, 183, 218, 109, 247, 155, 231, 206, 187, 215, 189, 125, 119, 182, 185, 115, 166, 154, 107, 87, 250, 239, 150, 220, 213, 254, 53, 231, 135, 93, 215, 151, 189, 217, 183, 116}),
			exErr:   fmt.Errorf("fail to query client state"),
		},
		{
			name:    "fail to parse data",
			typeUrl: "ClientState",
			Value:   "clientStateValue",
			exErr:   nil,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ClientQueryService)
			mockService.On("ConsensusState", context.Background(),
				&pbclient.QueryConsensusStateRequest{
					Height: 9,
				},
				[]grpc.CallOption(nil)).Return(
				tc.typeUrl,
				tc.Value,
				"0-212218/consensus/749d9b2194341dbd7ce7f8787c6d85290351aeafa7dd38da3894e472997f04a4/0",
				212218,
				tc.exErr,
			)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}

			response, err := cc.QueryClientConsensusState(context.Background(), 9, "", module.Height{
				RevisionNumber: 0,
				RevisionHeight: 9,
			})
			if tc.name == "fail to parse data" {
				require.Error(t, err)
			} else {
				if err != nil {
					require.EqualError(t, err, tc.exErr.Error())
				} else {
					require.NotEmpty(t, response)
				}
			}
		})
	}
}

func TestQueryConnection(t *testing.T) {
	testCases := []struct {
		name  string
		exErr error
	}{
		{
			name:  "success",
			exErr: nil,
		},

		{
			name:  "err contain not found",
			exErr: fmt.Errorf("not found"),
		},

		{
			name:  "err not contain not found",
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
			response, err := cc.QueryConnection(context.Background(), 9, "connectionId")
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryChannels(t *testing.T) {
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
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("Channels",
				context.Background(),
				&pbchannel.QueryChannelsRequest{
					Pagination: DefaultPageRequest(),
				},
				[]grpc.CallOption(nil),
			).Return(1, 1, "PortId", "ChannelId",
				"ConnectionHops", "Version", "PortId", "ChannelId",
				"", 1, 1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}
			response, err := cc.QueryChannels(context.Background())
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryConnectionChannels(t *testing.T) {
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
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("ConnectionChannels",
				context.Background(),
				&pbchannel.QueryConnectionChannelsRequest{
					Connection: "connectionid",
					Pagination: DefaultPageRequest(),
				},
				[]grpc.CallOption(nil)).Return(1, 1, "PortId", "ChannelId",
				"ConnectionHops", "Version", "PortId", "ChannelId",
				"", 1, 1, tc.exErr)
			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}
			response, err := cc.QueryConnectionChannels(context.Background(), 9, "connectionid")
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryConnections(t *testing.T) {
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
			mockService.On("Connections",
				context.Background(), &pbconnection.QueryConnectionsRequest{
					Pagination: DefaultPageRequest(),
				},
				[]grpc.CallOption(nil)).Return("Identifier", "Features",
				"Id", "ClientId", 1, "ClientId", "ConnectionId", "KeyPrefix", 1,
				"", 1, 1, tc.exErr)

			cc := &CardanoProvider{GateWay: services.Gateway{
				ConnectionQueryService: mockService,
			}}

			response, err := cc.QueryConnections(context.Background())
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryCardanoState(t *testing.T) {
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
			mockService := new(services_mock.ClientQueryService)
			mockService.On("NewClient",
				context.Background(),
				&pbclient.QueryNewClientRequest{Height: 0},
				[]grpc.CallOption(nil)).Return("", "",
				"", "", tc.exErr)

			cc := &CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}

			clientState, consensusState, err := cc.QueryCardanoState(context.Background(), 0)
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, clientState, consensusState)
			}
		})
	}
}

func TestQueryUnreceivedPackets(t *testing.T) {
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
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("UnreceivedPackets",
				context.Background(),
				&pbchannel.QueryUnreceivedPacketsRequest{
					PortId:                    "PortId",
					ChannelId:                 "ChannelId",
					PacketCommitmentSequences: []uint64{},
				},
				[]grpc.CallOption(nil)).Return(0, 0, tc.exErr)

			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}

			res, err := cc.QueryUnreceivedPackets(context.Background(), 0, "ChannelId", "PortId", []uint64{})
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.Empty(t, res)
			}
		})
	}
}

func TestQueryPacketCommitmentGW(t *testing.T) {
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
			mockService := new(services_mock.ChannelQueryService)
			mockService.On("PacketCommitment",
				context.Background(),
				&pbchannel.QueryPacketCommitmentRequest{
					PortId:    "PortId",
					ChannelId: "ChannelId",
					Sequence:  0,
				},
				[]grpc.CallOption(nil)).Return("[]byte{}", "[]byte{}", 0, 0, tc.exErr)

			cc := &CardanoProvider{GateWay: services.Gateway{
				ChannelQueryService: mockService,
			}}

			commit, proof, h, err := cc.QueryPacketCommitmentGW(context.Background(), provider.PacketInfo{
				Height:           0,
				Sequence:         0,
				SourcePort:       "PortId",
				SourceChannel:    "ChannelId",
				DestPort:         "PortId",
				DestChannel:      "ChannelId",
				ChannelOrder:     "",
				Data:             nil,
				TimeoutHeight:    clienttypes.Height{},
				TimeoutTimestamp: 0,
				Ack:              nil,
			})
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, commit, proof, h)
			}
		})
	}
}

func TestQueryUpgradedConsState(t *testing.T) {
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
			res, err := cc.QueryUpgradedConsState(context.Background(), 0)
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.Empty(t, res)
			}
		})
	}
}

func TestQueryUpgradeProof(t *testing.T) {
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
			res, _, err := cc.QueryUpgradeProof(context.Background(), []byte{}, 0)
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.Empty(t, res)
			}
		})
	}
}

func TestQueryUnbondingPeriod(t *testing.T) {
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
			res, err := cc.QueryUnbondingPeriod(context.Background())
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.Empty(t, res)
			}
		})
	}
}

//func TestQueryStatus(t *testing.T) {
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
//
//			cc := &CardanoProvider{}
//			res, err := cc.QueryStatus(context.Background())
//			if err != nil {
//				require.EqualError(t, err, tc.exErr.Error())
//			} else {
//				require.Empty(t, res)
//			}
//		})
//	}
//}

func TestQueryClients(t *testing.T) {
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
			res, err := cc.QueryClients(context.Background())
			if err != nil {
				require.EqualError(t, err, tc.exErr.Error())
			} else {
				require.Empty(t, res)
			}
		})
	}
}

func TestQueryIBCMessages(t *testing.T) {
	testCases := []struct {
		name                 string
		page, limit          int
		queryBlockSearchErr  error
		queryBlockResultsErr error
		exErr                error
	}{
		{
			name:                 "success",
			page:                 1,
			limit:                1,
			queryBlockSearchErr:  nil,
			queryBlockResultsErr: nil,
			exErr:                nil,
		},
		{
			name:                 "fail page",
			page:                 0,
			limit:                0,
			queryBlockSearchErr:  nil,
			queryBlockResultsErr: nil,
			exErr:                errors.New("page must greater than 0"),
		},
		{
			name:                 "fail limit",
			page:                 1,
			limit:                0,
			queryBlockSearchErr:  nil,
			queryBlockResultsErr: nil,
			exErr:                errors.New("limit must greater than 0"),
		},
		{
			name:                 "fail queryBlockSearchErr",
			page:                 1,
			limit:                1,
			queryBlockSearchErr:  fmt.Errorf("fail queryBlockSearchErr"),
			queryBlockResultsErr: nil,
			exErr:                fmt.Errorf("fail queryBlockSearchErr"),
		},
		{
			name:                 "fail queryBlockResultsErr",
			page:                 1,
			limit:                1,
			queryBlockSearchErr:  nil,
			queryBlockResultsErr: fmt.Errorf("queryBlockResultsErr"),
			exErr:                fmt.Errorf("queryBlockResultsErr"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			typeProviderMock := new(services_mock.TypeProvider)
			typeProviderMock.On("BlockSearch", context.Background(),
				&ibcclient.QueryBlockSearchRequest{
					PacketSrcChannel: "packetSrcChannel",
					PacketDstChannel: "",
					PacketSequence:   "packetSequence",
					Limit:            uint64(tc.limit),
					Page:             uint64(tc.page),
				}, []grpc.CallOption(nil)).Return(1, 1, 1, tc.queryBlockSearchErr)
			typeProviderMock.On("BlockResults", context.Background(),
				&ibcclient.QueryBlockResultsRequest{
					Height: 1,
				}, []grpc.CallOption(nil)).Return(
				"send_packet", "Value", true, "send_packet", 1, 1, tc.queryBlockResultsErr)
			cc := CardanoProvider{GateWay: services.Gateway{TypeProvider: typeProviderMock}}
			log := zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))
			response, err := cc.queryIBCMessages(context.Background(), log, "packetSrcChannel", "", "packetSequence", tc.page, tc.limit, false)
			if err != nil {
				require.Errorf(t, err, tc.exErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketAcknowledgements(t *testing.T) {
	var testCases = []struct {
		name                           string
		queryPacketAcknowledgementsErr error
		exErr                          error
	}{
		{
			name:                           "success",
			queryPacketAcknowledgementsErr: nil,
			exErr:                          nil,
		},
		{
			name:                           "fail queryPacketAcknowledgementsErr",
			queryPacketAcknowledgementsErr: fmt.Errorf("queryPacketAcknowledgementsErr"),
			exErr:                          fmt.Errorf("queryPacketAcknowledgementsErr"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			channelQueryServiceMock := new(services_mock.ChannelQueryService)
			channelQueryServiceMock.On("PacketAcknowledgements",
				context.Background(),
				&pbchannel.QueryPacketAcknowledgementsRequest{
					PortId:                    "PortId",
					ChannelId:                 "ChannelId",
					Pagination:                DefaultPageRequest(),
					PacketCommitmentSequences: nil,
				},
				[]grpc.CallOption(nil),
			).Return("PortId", "ChannelId", 1, "Data", "", 1, 1, tc.queryPacketAcknowledgementsErr)

			cc := CardanoProvider{GateWay: services.Gateway{ChannelQueryService: channelQueryServiceMock}}

			response, err := cc.QueryPacketAcknowledgements(context.Background(), 0, "ChannelId", "PortId")
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryProofUnreceivedPackets(t *testing.T) {
	testCases := []struct {
		name                      string
		proofUnreceivedPacketsErr error
		exErr                     error
	}{
		{
			name:                      "success",
			proofUnreceivedPacketsErr: nil,
			exErr:                     nil,
		},
		{
			name:                      "fail proofUnreceivedPacketsErr",
			proofUnreceivedPacketsErr: fmt.Errorf("proofUnreceivedPacketsErr"),
			exErr:                     fmt.Errorf("proofUnreceivedPacketsErr"),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			channelQueryServiceMock := new(services_mock.ChannelQueryService)
			channelQueryServiceMock.On("ProofUnreceivedPackets",
				context.Background(),
				&pbchannel.QueryProofUnreceivedPacketsRequest{
					ChannelId:      "channelId",
					PortId:         "portId",
					Sequence:       0,
					RevisionHeight: 0,
				}, []grpc.CallOption(nil),
			).Return("proof", 0, 1, tc.proofUnreceivedPacketsErr)

			cc := CardanoProvider{GateWay: services.Gateway{ChannelQueryService: channelQueryServiceMock}}

			response, err := cc.QueryProofUnreceivedPackets(context.Background(), "channelId", "portId", 0, 0)
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQuerySendPacket(t *testing.T) {
	testCases := []struct {
		name                string
		eventType           string
		queryIBCMessagesErr error
		exErr               error
	}{
		{
			name:                "success",
			eventType:           "send_packet",
			queryIBCMessagesErr: nil,
			exErr:               nil,
		},
		{
			name:                "fail queryIBCMessagesErr",
			queryIBCMessagesErr: fmt.Errorf("queryIBCMessagesErr"),
			exErr:               fmt.Errorf("queryIBCMessagesErr"),
		},
		{
			name:                "fail eventType",
			eventType:           "recv_packet",
			queryIBCMessagesErr: nil,
			exErr:               fmt.Errorf("no ibc messages found for send_packet query: %s", "send_packet.packet_src_channel='packetSrcChannel' AND send_packet.packet_sequence='1'"),
		},
	}
	for _, tc := range testCases {

		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			typeProviderMock := new(services_mock.TypeProvider)
			typeProviderMock.On("BlockSearch", context.Background(),
				&ibcclient.QueryBlockSearchRequest{
					PacketSrcChannel: "packetSrcChannel",
					PacketDstChannel: "",
					PacketSequence:   "1",
					Limit:            1000,
					Page:             1,
				}, []grpc.CallOption(nil)).Return(1, 1, 1, tc.queryIBCMessagesErr)
			typeProviderMock.On("BlockResults", context.Background(),
				&ibcclient.QueryBlockResultsRequest{
					Height: 1,
				}, []grpc.CallOption(nil)).Return(
				"send_packet", "Value", true, tc.eventType, 1, 1, tc.queryIBCMessagesErr)
			cc := CardanoProvider{GateWay: services.Gateway{TypeProvider: typeProviderMock}}
			log := zap.New(zapcore.NewCore(
				zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
				zapcore.AddSync(&buf),
				zap.InfoLevel,
			))
			cc.log = log
			response, err := cc.QuerySendPacket(context.Background(), "packetSrcChannel", "", 1)
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
		name                               string
		queryUnreceivedAcknowledgementsErr error
		exErr                              error
	}{
		{
			name:                               "success",
			queryUnreceivedAcknowledgementsErr: nil,
			exErr:                              nil,
		},
		{
			name:                               "fail queryUnreceivedAcknowledgementsErr",
			queryUnreceivedAcknowledgementsErr: fmt.Errorf("queryUnreceivedAcknowledgementsErr"),
			exErr:                              fmt.Errorf("queryUnreceivedAcknowledgementsErr"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			channelQueryServiceMock := new(services_mock.ChannelQueryService)
			channelQueryServiceMock.On("UnreceivedAcks", context.Background(),
				&pbchannel.QueryUnreceivedAcksRequest{
					PortId:             "PortId",
					ChannelId:          "ChannelId",
					PacketAckSequences: nil,
				},
				[]grpc.CallOption(nil)).Return(0, 1, 1, tc.queryUnreceivedAcknowledgementsErr)

			cc := CardanoProvider{GateWay: services.Gateway{ChannelQueryService: channelQueryServiceMock}}
			response, err := cc.QueryUnreceivedAcknowledgements(context.Background(), 0, "ChannelId", "PortId", nil)
			if err != nil {
				require.Error(t, err, tc.exErr)
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}
