package helpers

import (
	"fmt"
	"github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/services/constants"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
)

func NormalizeEventFromChannelDatum(channDatum ibc_types.ChannelDatumSchema, connId string, chanelId string, eventType string) (types.Event, error) {
	if eventType == "" {
		eventType = channeltypes.EventTypeChannelOpenInit
	}

	eventAttribute := []*types.EventAttribute{
		&types.EventAttribute{
			Key:   channeltypes.AttributeKeyConnectionID,
			Value: fmt.Sprintf("%s-%s", constants.ConnectionTokenPrefix, connId),
		},
		&types.EventAttribute{
			Key:   channeltypes.AttributeKeyPortID,
			Value: string(channDatum.PortId),
		},
		&types.EventAttribute{
			Key:   channeltypes.AttributeKeyChannelID,
			Value: fmt.Sprintf("%s-%s", constants.ChannelTokenPrefix, chanelId),
		},
		&types.EventAttribute{
			Key:   channeltypes.AttributeVersion,
			Value: string(channDatum.State.Channel.Version),
		},
		&types.EventAttribute{
			Key:   channeltypes.AttributeCounterpartyChannelID,
			Value: string(channDatum.State.Channel.Counterparty.ChannelId),
		},
		&types.EventAttribute{
			Key:   channeltypes.AttributeCounterpartyPortID,
			Value: string(channDatum.State.Channel.Counterparty.PortId),
		},
	}
	return types.Event{
		Type:           eventType,
		EventAttribute: eventAttribute,
	}, nil
}
