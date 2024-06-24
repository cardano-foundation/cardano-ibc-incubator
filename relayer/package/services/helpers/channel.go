package helpers

import (
	"encoding/hex"
	"encoding/json"
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
			Value: connId,
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

func NormalizeEventPacketFromChannelRedeemer(spendChannRedeemer ibc_types.SpendChannelRedeemerSchema, channDatum ibc_types.ChannelDatumSchema) (abci.Event, error) {
	eventType := ""
	var packetData ibc_types.PacketSchema
	acknowledgement := ""

	switch spendChannRedeemer.Type {
	case ibc_types.SendPacket:
		eventType = channeltypes.EventTypeSendPacket
		packetData = spendChannRedeemer.Value.(ibc_types.SpendChannelRedeemerSendPacket).Packet
	case ibc_types.RecvPacket:
		eventType = channeltypes.EventTypeRecvPacket
		packetData = spendChannRedeemer.Value.(ibc_types.SpendChannelRedeemerRecvPacket).Packet
	case ibc_types.AcknowledgePacket:
		eventType = channeltypes.EventTypeAcknowledgePacket
		acknowledgement = string(spendChannRedeemer.Value.(ibc_types.SpendChannelRedeemerAcknowledgePacket).Acknowledgement)
	case ibc_types.TimeoutPacket:
		eventType = channeltypes.EventTypeTimeoutPacket
		packetData = spendChannRedeemer.Value.(ibc_types.SpendChannelRedeemerTimeoutPacket).Packet
	}
	eventAttribute := []abci.EventAttribute{
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyData,
			Value: string(packetData.Data),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyAck,
			Value: acknowledgement,
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyDataHex,
			Value: hex.EncodeToString(packetData.Data),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyAckHex,
			Value: hex.EncodeToString(packetData.Data),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyTimeoutHeight,
			Value: fmt.Sprintf("%d-%d", packetData.TimeoutHeight.RevisionNumber, packetData.TimeoutHeight.RevisionHeight),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyTimeoutTimestamp,
			Value: fmt.Sprint(packetData.TimeoutTimestamp),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeySequence,
			Value: fmt.Sprint(packetData.Sequence),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeySrcPort,
			Value: string(packetData.SourcePort),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeySrcChannel,
			Value: string(packetData.SourceChannel),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyDstPort,
			Value: string(packetData.DestinationPort),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyDstChannel,
			Value: string(packetData.DestinationChannel),
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyChannelOrdering,
			Value: channeltypes.Order_name[int32(channDatum.State.Channel.Ordering)],
		},
		abci.EventAttribute{
			Key:   channeltypes.AttributeKeyConnection,
			Value: string(channDatum.State.Channel.ConnectionHops[0]),
		},
	}
	return abci.Event{
		Type:       eventType,
		Attributes: eventAttribute,
	}, nil
}

func NormalizeEventRecvPacketFromIBCModuleRedeemer(spendChannRedeemer ibc_types.SpendChannelRedeemerSchema, channDatum ibc_types.ChannelDatumSchema, ibcModuleRedeemer ibc_types.IBCModuleRedeemerSchema) ([]abci.Event, error) {
	recvPacketEvent, err := NormalizeEventPacketFromChannelRedeemer(spendChannRedeemer, channDatum)
	if err != nil {
		return nil, err
	}

	if spendChannRedeemer.Type != ibc_types.RecvPacket {
		return []abci.Event{recvPacketEvent}, nil
	}
	acknowledgement := []byte{}
	if ibcModuleRedeemer.Type == ibc_types.IBCModuleCallback {
		moduleCallback := ibcModuleRedeemer.Value.(ibc_types.IBCModuleCallbackSchema)
		if moduleCallback.Type == ibc_types.OnRecvPacket {
			if moduleCallback.Value.(ibc_types.OnRecvPacketSchema).Acknowledgement.Response.Type == ibc_types.AcknowledgementResult {
				ack := channeltypes.Acknowledgement_Result{
					Result: moduleCallback.Value.(ibc_types.OnRecvPacketSchema).Acknowledgement.Response.Value.(ibc_types.AcknowledgementResultSchema).Result,
				}
				acknowledgement, _ = json.Marshal(ack)
			}
			if moduleCallback.Value.(ibc_types.OnRecvPacketSchema).Acknowledgement.Response.Type == ibc_types.AcknowledgementError {
				ack := channeltypes.Acknowledgement_Error{
					Error: string(moduleCallback.Value.(ibc_types.OnRecvPacketSchema).Acknowledgement.Response.Value.(ibc_types.AcknowledgementErrorSchema).Err),
				}
				acknowledgement, _ = json.Marshal(ack)
			}
		}
	}
	packetData := spendChannRedeemer.Value.(ibc_types.SpendChannelRedeemerRecvPacket).Packet
	return []abci.Event{
		recvPacketEvent,
		abci.Event{
			Type: channeltypes.EventTypeWriteAck,
			Attributes: []abci.EventAttribute{
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyData,
					Value: string(packetData.Data),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyAck,
					Value: string(acknowledgement),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyDataHex,
					Value: hex.EncodeToString(packetData.Data),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyAckHex,
					Value: hex.EncodeToString(acknowledgement),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyTimeoutHeight,
					Value: fmt.Sprintf("%d-%d", packetData.TimeoutHeight.RevisionNumber, packetData.TimeoutHeight.RevisionHeight),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyTimeoutTimestamp,
					Value: fmt.Sprint(packetData.TimeoutTimestamp),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeySequence,
					Value: fmt.Sprint(packetData.Sequence),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeySrcPort,
					Value: string(packetData.SourcePort),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeySrcChannel,
					Value: string(packetData.SourceChannel),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyDstPort,
					Value: string(packetData.DestinationPort),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyDstChannel,
					Value: string(packetData.DestinationChannel),
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyChannelOrdering,
					Value: channeltypes.Order_name[int32(channDatum.State.Channel.Ordering)],
				},
				abci.EventAttribute{
					Key:   channeltypes.AttributeKeyConnection,
					Value: string(channDatum.State.Channel.ConnectionHops[0]),
				},
			},
		},
	}, nil
}
