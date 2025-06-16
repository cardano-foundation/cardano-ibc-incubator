package ibc

import (
	"context"

	"github.com/misko9/go-substrate-rpc-client/v4/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
)

func (i IBC) QueryAcknowledgements(
	ctx context.Context,
	height uint64,
	channelID,
	portID string) (
	[][]byte,
	error,
) {
	var res [][]byte
	err := i.client.CallContext(ctx, &res, queryAcknowledgementsMethod, height, channelID, portID)
	if err != nil {
		return [][]byte{}, err
	}
	return res, nil
}

func (i IBC) QueryPackets(
	ctx context.Context,
	channelID,
	portID string,
	seqs []uint64,
) (
	[]chantypes.Packet,
	error,
) {
	var res []chantypes.Packet
	err := i.client.CallContext(ctx, &res, queryPacketsMethod, channelID, portID, seqs)
	if err != nil {
		return []chantypes.Packet{}, err
	}
	return res, nil
}

func (i IBC) QueryPacketCommitments(
	ctx context.Context,
	height uint64,
	channelID,
	portID string) (
	*chantypes.QueryPacketCommitmentsResponse,
	error,
) {
	var res *chantypes.QueryPacketCommitmentsResponse
	err := i.client.CallContext(ctx, &res, queryPacketCommitmentsMethod, height, channelID, portID)
	if err != nil {
		return &chantypes.QueryPacketCommitmentsResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryPacketAcknowledgements(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
) (
	*chantypes.QueryPacketAcknowledgementsResponse,
	error,
) {
	var res *chantypes.QueryPacketAcknowledgementsResponse
	err := i.client.CallContext(ctx, &res, queryPacketAcknowledgementsMethod, height, channelID, portID)
	if err != nil {
		return &chantypes.QueryPacketAcknowledgementsResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryUnreceivedPackets(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
	seqs []uint64,
) (
	[]uint64, error,
) {
	var res []uint64
	err := i.client.CallContext(ctx, &res, queryUnreceivedPacketsMethod, height, channelID, portID, seqs)
	if err != nil {
		return []uint64{}, err
	}
	return res, nil
}

func (i IBC) QueryUnreceivedAcknowledgements(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
	seqs []uint64,
) (
	[]uint64,
	error,
) {
	var res []uint64
	err := i.client.CallContext(ctx, &res, queryUnreceivedAcknowledgementMethod, height, channelID, portID, seqs)
	if err != nil {
		return []uint64{}, err
	}
	return res, nil
}

func (i IBC) QueryNextSeqRecv(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
) (
	*chantypes.QueryNextSequenceReceiveResponse,
	error,
) {
	var res *chantypes.QueryNextSequenceReceiveResponse
	err := i.client.CallContext(ctx, &res, queryNextSeqRecvMethod, height, channelID, portID)
	if err != nil {
		return &chantypes.QueryNextSequenceReceiveResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryPacketCommitment(
	ctx context.Context,
	height int64,
	channelID,
	portID string,
) (
	*chantypes.QueryPacketCommitmentResponse,
	error,
) {
	var res *chantypes.QueryPacketCommitmentResponse
	err := i.client.CallContext(ctx, &res, queryPacketCommitmentMethod, height, channelID, portID)
	if err != nil {
		return &chantypes.QueryPacketCommitmentResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryPacketAcknowledgement(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
	seq uint64,
) (
	*chantypes.QueryPacketAcknowledgementResponse,
	error,
) {
	var res *chantypes.QueryPacketAcknowledgementResponse
	err := i.client.CallContext(ctx, &res, queryPacketAcknowledgementMethod, height, channelID, portID, seq)
	if err != nil {
		return &chantypes.QueryPacketAcknowledgementResponse{}, err
	}
	return res, nil
}

func (i IBC) QueryPacketReceipt(
	ctx context.Context,
	height uint32,
	channelID,
	portID string,
	seq uint64,
) (
	*chantypes.QueryPacketReceiptResponse,
	error,
) {
	var res *chantypes.QueryPacketReceiptResponse
	err := i.client.CallContext(ctx, &res, queryPacketReceiptMethod, height, channelID, portID, seq)
	if err != nil {
		return &chantypes.QueryPacketReceiptResponse{}, err
	}
	return res, nil
}

func (i IBC) QuerySendPackets(
	ctx context.Context,
	channelID,
	portID string,
	seqs []uint64,
) (
	[]types.PacketInfo,
	error,
) {
	var res []types.PacketInfo
	err := i.client.CallContext(ctx, &res, querySendPackets, channelID, portID, seqs)
	if err != nil {
		return []types.PacketInfo{}, err
	}
	return res, nil
}

func (i IBC) QueryRecvPackets(
	ctx context.Context,
	channelID,
	portID string,
	seqs []uint64,
) (
	[]types.PacketInfo,
	error,
) {
	var res []types.PacketInfo
	err := i.client.CallContext(ctx, &res, queryRecvPackets, channelID, portID, seqs)
	if err != nil {
		return []types.PacketInfo{}, err
	}
	return res, nil
}
