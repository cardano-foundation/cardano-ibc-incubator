package helpers

import (
	"fmt"
	"github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/services/constants"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	connectiontypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
)

func NormalizeEventFromConnDatum(connDatum ibc_types.ConnectionDatumSchema, connId string, eventType string) (types.Event, error) {
	if eventType == "" {
		eventType = connectiontypes.EventTypeConnectionOpenInit
	}

	eventAttribute := []*types.EventAttribute{
		&types.EventAttribute{
			Key:   connectiontypes.AttributeKeyConnectionID,
			Value: fmt.Sprintf("%s-%s", constants.ConnectionTokenPrefix, connId),
		},
		&types.EventAttribute{
			Key:   connectiontypes.AttributeKeyClientID,
			Value: string(connDatum.State.ClientId),
		},
		&types.EventAttribute{
			Key:   connectiontypes.AttributeKeyCounterpartyClientID,
			Value: string(connDatum.State.Counterparty.ClientId),
		},
		&types.EventAttribute{
			Key:   connectiontypes.AttributeKeyCounterpartyConnectionID,
			Value: string(connDatum.State.Counterparty.ConnectionId),
		},
	}
	return types.Event{
		Type:           eventType,
		EventAttribute: eventAttribute,
	}, nil
}
