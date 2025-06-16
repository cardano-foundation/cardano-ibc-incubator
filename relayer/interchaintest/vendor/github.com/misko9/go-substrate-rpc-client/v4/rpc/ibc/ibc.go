package ibc

import (
	"github.com/misko9/go-substrate-rpc-client/v4/client"
	sdktypes "github.com/cosmos/cosmos-sdk/codec/types"
	prototypes "github.com/gogo/protobuf/types"
)

const (
	generateConnectionHandshakeProofMethod = "ibc_generateConnectionHandshakeProof"// Generate proof for connection handshake
	queryAcknowledgementsMethod            = "ibc_queryAcknowledgements"
	queryBalanceWithAddressMethod          = "ibc_queryBalanceWithAddress" // Query balance of an address on chain, addr should be a valid hexadecimal or SS58 string, representing the account id.
	queryChannelMethod                     = "ibc_queryChannel"// Query a channel state
	queryChannelClientMethod               = "ibc_queryChannelClient"// Query client state for channel and port id
	queryChannelsMethod                    = "ibc_queryChannels"// Query all channel states
	queryClientStateMethod                 = "ibc_queryClientState"// Query a client state
	queryClientConsensusStateMethod        = "ibc_queryClientConsensusState"// Query client consensus state, 
	queryClientsMethod                     = "ibc_queryClients"// Query all client states
	queryConnectionMethod                  = "ibc_queryConnection"// Query a connection state
	queryConnectionsMethod                 = "ibc_queryConnections"// Query all connection states
	queryConnectionChannelsMethod          = "ibc_queryConnectionChannels"// Query all channel states for associated connection
	queryConnectionUsingClientMethod       = "ibc_queryConnectionUsingClient"// Query all connection states for associated client
	queryConsensusStateMethod              = "ibc_queryConsensusState"
	queryDenomTraceMethod                  = "ibc_queryDenomTrace"// Query the denom trace for an ibc denom from the asset Id
	queryDenomTracesMethod                 = "ibc_queryDenomTraces"// Query the denom traces for ibc denoms
	queryEventsMethod                      = "ibc_queryEvents"// Query Ibc Events that were deposited in a series of blocks
	queryLatestHeightMethod                = "ibc_queryLatestHeight"// Query latest height
	queryNextSeqRecvMethod                 = "ibc_queryNextSeqRecv"// Query next sequence to be received on channel
	queryNewlyCreatedClientMethod          = "ibc_queryNewlyCreatedClient"// Query newly created client in block and extrinsic
	queryPacketsMethod                     = "ibc_queryPackets"
	queryPacketCommitmentsMethod           = "ibc_queryPacketCommitments"// Query packet commitments
	queryPacketAcknowledgementsMethod      = "ibc_queryPacketAcknowledgements"// Query packet acknowledgements
	queryPacketCommitmentMethod            = "ibc_queryPacketCommitment"// Query packet commitment
	queryPacketAcknowledgementMethod       = "ibc_queryPacketAcknowledgement" // Query packet acknowledgement
	queryPacketReceiptMethod               = "ibc_queryPacketReceipt"// Query packet receipt
	queryProofMethod                       = "ibc_queryProof" // Generate proof for given key
	querySendPackets                       = "ibc_querySendPackets" // Query packet data
	queryRecvPackets                       = "ibc_queryRecvPackets"// Query Recv Packet
	queryTimestampMethod                   = "ibc_queryTimestamp" 
	queryUnreceivedAcknowledgementMethod   = "ibc_queryUnreceivedAcknowledgement"// Given a list of counterparty packet acknowledgements
	queryUnreceivedPacketsMethod           = "ibc_queryUnreceivedPackets"// Given a list of counterparty packet commitments
	queryUpgradedClientMethod              = "ibc_queryUpgradedClient"// Query upgraded client state
	queryUpgradedConnectionStateMethod     = "ibc_queryUpgradedConnectionState"// Query upgraded consensus state for client
	//ibc_clientUpdateTimeAndHeight /// Query local time and height that a client was updated
)

// IBC exposes methods for retrieval of chain data
type IBC struct {
	client client.Client
}

// NewIBC creates a new IBC struct
func NewIBC(cl client.Client) *IBC {
	return &IBC{cl}
}

func parseAny(any *prototypes.Any) (*sdktypes.Any, error) {
	message, err := prototypes.EmptyAny(any)
	if err != nil {
		return nil, err
	}

	err = prototypes.UnmarshalAny(any, message)
	if err != nil {
		return nil, err
	}

	return sdktypes.NewAnyWithValue(message)
}
