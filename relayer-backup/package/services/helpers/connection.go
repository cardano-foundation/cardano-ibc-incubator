package helpers

import (
	"fmt"
	"github.com/cardano/relayer/v1/package/services/constants"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	abci "github.com/cometbft/cometbft/abci/types"
	connectiontypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
)

func NormalizeEventFromConnDatum(connDatum ibc_types.ConnectionDatumSchema, connId string, eventType string) (abci.Event, error) {
	if eventType == "" {
		eventType = connectiontypes.EventTypeConnectionOpenInit
	}

	eventAttribute := []abci.EventAttribute{
		abci.EventAttribute{
			Key:   connectiontypes.AttributeKeyConnectionID,
			Value: fmt.Sprintf("%s-%s", constants.ConnectionTokenPrefix, connId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   connectiontypes.AttributeKeyClientID,
			Value: string(connDatum.State.ClientId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   connectiontypes.AttributeKeyCounterpartyClientID,
			Value: string(connDatum.State.Counterparty.ClientId),
			Index: true,
		},
		abci.EventAttribute{
			Key:   connectiontypes.AttributeKeyCounterpartyConnectionID,
			Value: string(connDatum.State.Counterparty.ConnectionId),
			Index: true,
		},
	}
	return abci.Event{
		Type:       eventType,
		Attributes: eventAttribute,
	}, nil
}
