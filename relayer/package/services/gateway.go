package services

import (
	"context"
	"fmt"
	"github.com/cardano/relayer/v1/package/mithril"
	"strings"

	pbclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	pbconnection "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	queryclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cosmos/cosmos-sdk/codec/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	any1 "github.com/golang/protobuf/ptypes/any"
	"google.golang.org/grpc"
)

type GatewayService interface {
}

type Gateway struct {
	ClientQueryService     pbclient.QueryClient
	ClientMsgService       pbclient.MsgClient
	ConnectionMsgService   pbconnection.MsgClient
	ConnectionQueryService queryclient.QueryClient
	ChannelQueryService    pbchannel.QueryClient
	ChannelMsgService      pbchannel.MsgClient

	TypeProvider   ibcclient.QueryClient
	MithrilService *mithril.MithrilService
}

func (gw *Gateway) NewGateWayService(address string, mithrilEndpoint string) error {
	conn, err := grpc.Dial(strings.TrimPrefix(address, "http://"), grpc.WithInsecure())
	if err != nil {
		return err
	}

	gw.ClientQueryService = pbclient.NewQueryClient(conn)
	gw.ClientMsgService = pbclient.NewMsgClient(conn)

	gw.ConnectionQueryService = pbconnection.NewQueryClient(conn)
	gw.ConnectionMsgService = pbconnection.NewMsgClient(conn)

	gw.ChannelQueryService = pbchannel.NewQueryClient(conn)
	gw.ChannelMsgService = pbchannel.NewMsgClient(conn)

	gw.TypeProvider = ibcclient.NewQueryClient(conn)
	gw.MithrilService = mithril.NewMithrilService(mithrilEndpoint)

	return nil
}

func (gw *Gateway) GetLastHeight() (uint64, error) {
	res, err := gw.MithrilService.GetCardanoTransactionsSetSnapshot()
	if err != nil {
		return 0, err
	}
	if len(res) == 0 {
		return 0, fmt.Errorf("cardano transaction set snapshot return nil")
	}
	return res[0].Beacon.ImmutableFileNumber, nil
}

func (gw *Gateway) QueryClientState(clientId string, height uint64) (*pbclient.QueryClientStateResponse, error) {
	req := &pbclient.QueryClientStateRequest{
		ClientId: clientId,
		Height:   height,
	}
	res, err := gw.ClientQueryService.ClientState(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryConsensusState(clientId string, height uint64) (*pbclient.QueryConsensusStateResponse, error) {
	req := &pbclient.QueryConsensusStateRequest{
		ClientId: clientId,
		Height:   height,
	}
	res, err := gw.ClientQueryService.ConsensusState(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) CreateClient(ctx context.Context, clientState *types.Any, consensusState *types.Any, signer string) (*pbclient.MsgCreateClientResponse, error) {

	req := &pbclient.MsgCreateClient{

		ClientState: &any1.Any{
			TypeUrl: clientState.TypeUrl,
			Value:   clientState.Value,
		},
		ConsensusState: &any1.Any{
			TypeUrl: consensusState.TypeUrl,
			Value:   consensusState.Value,
		},
		Signer: signer,
	}

	res, err := gw.ClientMsgService.CreateClient(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryCardanoState(height uint64) (*pbclient.QueryNewClientResponse, error) {
	req := &pbclient.QueryNewClientRequest{
		Height: height,
	}
	res, err := gw.ClientQueryService.NewClient(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryBlockData(ctx context.Context, height uint64) (*pbclient.QueryBlockDataResponse, error) {
	req := &pbclient.QueryBlockDataRequest{
		Height: height,
	}
	res, err := gw.ClientQueryService.BlockData(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) UpdateClient(ctx context.Context, req *pbclient.MsgUpdateClient) (*pbclient.MsgUpdateClientResponse, error) {
	res, err := gw.ClientMsgService.UpdateClient(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ConnectionOpenInit(ctx context.Context, req *pbconnection.MsgConnectionOpenInit) (*pbconnection.MsgConnectionOpenInitResponse, error) {
	res, err := gw.ConnectionMsgService.ConnectionOpenInit(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ConnectionOpenTry(ctx context.Context, msg *conntypes.MsgConnectionOpenTry) (*pbconnection.MsgConnectionOpenTryResponse, error) {

	versions := []*pbconnection.Version{}
	for _, ver := range msg.CounterpartyVersions {
		versions = append(versions, &pbconnection.Version{
			Identifier: ver.Identifier,
			Features:   ver.Features,
		})
	}

	req := &pbconnection.MsgConnectionOpenTry{
		ClientId:             msg.ClientId,
		PreviousConnectionId: msg.PreviousConnectionId,
		ClientState: &any1.Any{
			TypeUrl: msg.ClientState.TypeUrl,
			Value:   msg.ClientState.Value,
		},
		Counterparty: &pbconnection.Counterparty{
			ClientId:     msg.Counterparty.ClientId,
			ConnectionId: msg.Counterparty.ConnectionId,
			Prefix:       &msg.Counterparty.Prefix,
		},
		DelayPeriod:             msg.DelayPeriod,
		CounterpartyVersions:    versions,
		ProofHeight:             &msg.ProofHeight,
		ProofInit:               msg.ProofInit,
		ProofClient:             msg.ProofClient,
		ProofConsensus:          msg.ProofConsensus,
		ConsensusHeight:         &msg.ConsensusHeight,
		Signer:                  msg.Signer,
		HostConsensusStateProof: msg.HostConsensusStateProof,
	}
	res, err := gw.ConnectionMsgService.ConnectionOpenTry(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ConnectionOpenAck(ctx context.Context, req *pbconnection.MsgConnectionOpenAck) (*pbconnection.MsgConnectionOpenAckResponse, error) {
	res, err := gw.ConnectionMsgService.ConnectionOpenAck(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ConnectionOpenConfirm(ctx context.Context, msg *conntypes.MsgConnectionOpenConfirm) (*pbconnection.MsgConnectionOpenConfirmResponse, error) {
	req := &pbconnection.MsgConnectionOpenConfirm{
		ConnectionId: msg.ConnectionId,
		ProofAck:     msg.ProofAck,
		ProofHeight:  &msg.ProofHeight,
		Signer:       msg.Signer,
	}
	res, err := gw.ConnectionMsgService.ConnectionOpenConfirm(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ChannelOpenInit(ctx context.Context, req *pbchannel.MsgChannelOpenInit) (*pbchannel.MsgChannelOpenInitResponse, error) {
	res, err := gw.ChannelMsgService.ChannelOpenInit(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ChannelOpenAck(ctx context.Context, req *pbchannel.MsgChannelOpenAck) (*pbchannel.MsgChannelOpenAckResponse, error) {
	res, err := gw.ChannelMsgService.ChannelOpenAck(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryBlockResults(ctx context.Context, height uint64) (*ibcclient.QueryBlockResultsResponse, error) {
	req := ibcclient.QueryBlockResultsRequest{Height: height}
	res, err := gw.TypeProvider.BlockResults(ctx, &req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) Connections(ctx context.Context, req *pbconnection.QueryConnectionsRequest) (*pbconnection.QueryConnectionsResponse, error) {
	res, err := gw.ConnectionQueryService.Connections(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryConnectionDetail(ctx context.Context, connectionId string) (*queryclient.QueryConnectionResponse, error) {
	req := &queryclient.QueryConnectionRequest{
		ConnectionId: connectionId,
	}
	res, err := gw.ConnectionQueryService.Connection(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ConnectionChannels(ctx context.Context, req *pbchannel.QueryConnectionChannelsRequest) (*pbchannel.QueryConnectionChannelsResponse, error) {
	res, err := gw.ChannelQueryService.ConnectionChannels(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) Channels(ctx context.Context, req *pbchannel.QueryChannelsRequest) (*pbchannel.QueryChannelsResponse, error) {
	res, err := gw.ChannelQueryService.Channels(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) Channel(ctx context.Context, req *pbchannel.QueryChannelRequest) (*pbchannel.QueryChannelResponse, error) {
	res, err := gw.ChannelQueryService.Channel(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) PacketCommitments(ctx context.Context, req *pbchannel.QueryPacketCommitmentsRequest) (*pbchannel.QueryPacketCommitmentsResponse, error) {
	res, err := gw.ChannelQueryService.PacketCommitments(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) PacketCommitment(ctx context.Context, req *pbchannel.QueryPacketCommitmentRequest) (*pbchannel.QueryPacketCommitmentResponse, error) {
	res, err := gw.ChannelQueryService.PacketCommitment(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryPacketAcknowledgements(ctx context.Context, req *pbchannel.QueryPacketAcknowledgementsRequest) (*pbchannel.QueryPacketAcknowledgementsResponse, error) {
	res, err := gw.ChannelQueryService.PacketAcknowledgements(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryPacketAcknowledgement(ctx context.Context, req *pbchannel.QueryPacketAcknowledgementRequest) (*pbchannel.QueryPacketAcknowledgementResponse, error) {
	res, err := gw.ChannelQueryService.PacketAcknowledgement(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) RecvPacket(ctx context.Context, msg *pbchannel.MsgRecvPacket) (*pbchannel.MsgRecvPacketResponse, error) {
	res, err := gw.ChannelMsgService.RecvPacket(ctx, msg)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) PacketAcknowledgement(ctx context.Context, msg *pbchannel.MsgAcknowledgement) (*pbchannel.MsgAcknowledgementResponse, error) {
	res, err := gw.ChannelMsgService.Acknowledgement(ctx, msg)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) PacketTimeout(ctx context.Context, msg *pbchannel.MsgTimeout) (*pbchannel.MsgTimeoutResponse, error) {
	res, err := gw.ChannelMsgService.Timeout(ctx, msg)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) PacketTimeoutOnClose(ctx context.Context, msg *pbchannel.MsgTimeoutOnClose) (*pbchannel.MsgTimeoutOnCloseResponse, error) {
	res, err := gw.ChannelMsgService.TimeoutOnClose(ctx, msg)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) Transfer(ctx context.Context, msg *pbchannel.MsgTransfer) (*pbchannel.MsgTransferResponse, error) {
	res, err := gw.ChannelMsgService.Transfer(ctx, msg)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryUnreceivedPackets(ctx context.Context, in *pbchannel.QueryUnreceivedPacketsRequest) (*pbchannel.QueryUnreceivedPacketsResponse, error) {
	res, err := gw.ChannelQueryService.UnreceivedPackets(ctx, in)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryTransactionByHash(ctx context.Context, in *ibcclient.QueryTransactionByHashRequest) (*ibcclient.QueryTransactionByHashResponse, error) {
	res, err := gw.TypeProvider.TransactionByHash(ctx, in)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryBlockSearch(ctx context.Context, packetSrcChannel, packetDstChannel, packetSequence string, limit, page uint64) (*ibcclient.QueryBlockSearchResponse, error) {
	req := &ibcclient.QueryBlockSearchRequest{
		PacketSrcChannel: packetSrcChannel,
		PacketDstChannel: packetDstChannel,
		PacketSequence:   packetSequence,
		Limit:            limit,
		Page:             page,
	}
	res, err := gw.TypeProvider.BlockSearch(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) TimeoutRefresh(ctx context.Context, req *pbchannel.MsgTimeoutRefresh) (*pbchannel.MsgTimeoutRefreshResponse, error) {
	res, err := gw.ChannelMsgService.TimeoutRefresh(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) ProofUnreceivedPackets(ctx context.Context, req *pbchannel.QueryProofUnreceivedPacketsRequest) (*pbchannel.QueryProofUnreceivedPacketsResponse, error) {
	res, err := gw.ChannelQueryService.ProofUnreceivedPackets(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (gw *Gateway) QueryUnreceivedAcknowledgements(ctx context.Context, req *pbchannel.QueryUnreceivedAcksRequest) (*pbchannel.QueryUnreceivedAcksResponse, error) {
	res, err := gw.ChannelQueryService.UnreceivedAcks(ctx, req)
	if err != nil {
		return nil, err
	}
	return res, nil
}
