package helpers

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/services/constants"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
)

func NormalizeEventFromClientDatum(clientDatum ibc_types.ClientDatumSchema, spendClientRedeemer *ibc_types.SpendClientRedeemerSchema, clientId string, eventType string) (types.Event, error) {
	if eventType == "" {
		eventType = clienttypes.EventTypeCreateClient
	}
	var latestHeight ibc_types.HeightSchema
	// get last element of map type clientDatum.State.ConsensusState
	for currHeight, _ := range clientDatum.State.ConsensusStates {
		latestHeight = currHeight
	}

	header := ""
	if spendClientRedeemer != nil && spendClientRedeemer.Type == "UpdateClient" {
		clientMessage := spendClientRedeemer.Value.(ibc_types.UpdateClientSchema).Msg
		if clientMessage.Type == "HeaderCase" {
			msgUpdateClient := clientMessage.Value.(ibc_types.HeaderSchema)
			tendermintHeader := ibc_types.ConvertHeaderSchemaToHeaderTendermint(msgUpdateClient)
			tendermintHeaderBytes, _ := json.Marshal(tendermintHeader)
			header = hex.EncodeToString(tendermintHeaderBytes)
		}

	}

	eventAttribute := []*types.EventAttribute{
		&types.EventAttribute{
			Key:   clienttypes.AttributeKeyClientID,
			Value: fmt.Sprintf("%s-%s", constants.ClientIDPrefix, clientId),
		},
		&types.EventAttribute{
			Key:   clienttypes.AttributeKeyConsensusHeight,
			Value: fmt.Sprint(latestHeight.RevisionHeight),
		},
		&types.EventAttribute{
			Key:   clienttypes.AttributeKeyHeader,
			Value: header,
		},
	}
	return types.Event{
		Type:           eventType,
		EventAttribute: eventAttribute,
	}, nil
}
