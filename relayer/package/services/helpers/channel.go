package helpers

import (
	"fmt"
	"github.com/cardano/relayer/v1/package/services/constants"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	abci "github.com/cometbft/cometbft/abci/types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
)

func NormalizeEventFromChannelDatum(channDatum ibc_types.ChannelDatumSchema, connId string, chanelId string, eventType string) (abci.Event, error) {
	if eventType == "" {
		eventType = channeltypes.EventTypeChannelOpenInit
	}

	eventAttribute := []abci.EventAttribute{
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyConnectionID,
			Value: fmt.Sprintf("%s-%s", constants.ConnectionTokenPrefix, connId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyPortID,
			Value: string(channDatum.PortId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyChannelID,
			Value: fmt.Sprintf("%s-%s", constants.ChannelTokenPrefix, chanelId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeVersion,
			Value: string(channDatum.State.Channel.Version),
			Index: true,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeCounterpartyChannelID,
			Value: string(channDatum.State.Channel.Counterparty.ChannelId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeCounterpartyPortID,
			Value: string(channDatum.State.Channel.Counterparty.PortId),
			Index: true,
		},
	}
	return abci.Event{
		Type:       eventType,
		Attributes: eventAttribute,
	}, nil
}
