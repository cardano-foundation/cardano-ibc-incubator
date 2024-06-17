package helpers

import (
	"fmt"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"strings"
)

func ValidQueryPacketCommitmentParam(req *channeltypes.QueryPacketCommitmentRequest) (*channeltypes.QueryPacketCommitmentRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	if req.Sequence <= 0 {
		return nil, fmt.Errorf("invalid argument: sequence must be greate than 0")
	}
	return req, nil
}

func ValidQueryPacketCommitmentsParam(req *channeltypes.QueryPacketCommitmentsRequest) (*channeltypes.QueryPacketCommitmentsRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	return req, nil
}

func ValidQueryPacketAckParam(req *channeltypes.QueryPacketAcknowledgementRequest) (*channeltypes.QueryPacketAcknowledgementRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	if req.Sequence <= 0 {
		return nil, fmt.Errorf("invalid argument: sequence must be greate than 0")
	}
	return req, nil
}

func ValidQueryPacketAcksParam(req *channeltypes.QueryPacketAcknowledgementsRequest) (*channeltypes.QueryPacketAcknowledgementsRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	return req, nil
}

func ValidQueryPacketReceipt(req *channeltypes.QueryPacketReceiptRequest) (*channeltypes.QueryPacketReceiptRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	if req.Sequence <= 0 {
		return nil, fmt.Errorf("invalid argument: sequence must be greate than 0")
	}
	return req, nil
}

func ValidQueryUnrecvPackets(req *channeltypes.QueryUnreceivedPacketsRequest) (*channeltypes.QueryUnreceivedPacketsRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	return req, nil

}

func ValidQueryUnrecvAcks(req *channeltypes.QueryUnreceivedAcksRequest) (*channeltypes.QueryUnreceivedAcksRequest, error) {
	if !strings.HasPrefix(req.ChannelId, "channel") {
		return nil, fmt.Errorf("innvalid channel-id: %s", req.ChannelId)
	}
	return req, nil
}
