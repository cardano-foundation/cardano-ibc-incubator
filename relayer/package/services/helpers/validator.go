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
