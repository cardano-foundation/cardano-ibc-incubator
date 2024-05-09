package constant

import "time"

const (
	EpochPeriod          = 5
	ClientTrustingPeriod = EpochPeriod * 24 * time.Hour
	OgmiosEndpoint       = "OGMIOS_ENDPOINT"

	MsgCreateClient        = "/ibc.core.client.v1.MsgCreateClient"
	MsgUpdateClient        = "/ibc.core.client.v1.MsgUpdateClient"
	MsgConnectionOpenInit  = "/ibc.core.connection.v1.MsgConnectionOpenInit"
	MsgConnectionOpenAck   = "/ibc.core.connection.v1.MsgConnectionOpenAck"
	MsgChannelOpenInit     = "/ibc.core.channel.v1.MsgChannelOpenInit"
	MsgChannelOpenAck      = "/ibc.core.channel.v1.MsgChannelOpenAck"
	MsgApplicationTransfer = "/ibc.applications.transfer.v1.MsgTransfer"
	MsgRecvPacket          = "/ibc.core.channel.v1.MsgRecvPacket"
	MsgAcknowledgement     = "/ibc.core.channel.v1.MsgAcknowledgement"

	MsgTimeoutRefresh = "/ibc.core.channel.v1.MsgChannelCloseInit" //todo: find a better solution for this msg
	MsgTimeOut        = "/ibc.core.channel.v1.MsgTimeout"
)
