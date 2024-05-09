package cardano

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/joho/godotenv"

	pbclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"

	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	transfertypes "github.com/cosmos/ibc-go/v7/modules/apps/transfer/types"
	any1 "github.com/golang/protobuf/ptypes/any"

	"github.com/avast/retry-go/v4"
	pbconnection "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	pbclientstruct "github.com/cardano/proto-types/go/sidechain/x/clients/cardano"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/relayer/provider"
	abci "github.com/cometbft/cometbft/abci/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	"github.com/cosmos/cosmos-sdk/client/tx"
	"github.com/cosmos/cosmos-sdk/crypto/keyring"
	sdk "github.com/cosmos/cosmos-sdk/types"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/cosmos-sdk/types/tx/signing"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	echovl "github.com/echovl/cardano-go"
	"go.uber.org/zap"
)

// Variables used for retries
var (
	rtyAttNum                   = uint(5)
	rtyAtt                      = retry.Attempts(rtyAttNum)
	rtyDel                      = retry.Delay(time.Millisecond * 400)
	rtyErr                      = retry.LastErrorOnly(true)
	accountSeqRegex             = regexp.MustCompile("account sequence mismatch, expected ([0-9]+), got ([0-9]+)")
	defaultBroadcastWaitTimeout = 10 * time.Minute
	errUnknown                  = "unknown"
)

// Default IBC settings
var (
	defaultChainPrefix = commitmenttypes.NewMerklePrefix([]byte("ibc"))
	defaultDelayPeriod = uint64(0)
)

// Strings for parsing events
var (
	spTag      = "send_packet"
	waTag      = "write_acknowledgement"
	srcChanTag = "packet_src_channel"
	dstChanTag = "packet_dst_channel"
)

// AcknowledgementFromSequence relays an acknowledgement with a given seq on src, source is the sending chain, destination is the receiving chain
func (cc *CardanoProvider) AcknowledgementFromSequence(ctx context.Context, dst provider.ChainProvider, dsth, seq uint64, dstChanId, dstPortId, srcChanId, srcPortId string) (provider.RelayerMessage, uint64, error) {
	msgRecvPacket, err := dst.QueryRecvPacket(ctx, dstChanId, dstPortId, seq)
	if err != nil {
		return nil, 0, err
	}

	pp, err := dst.PacketAcknowledgement(ctx, msgRecvPacket, dsth)
	if err != nil {
		return nil, 0, err
	}
	msg, err := cc.MsgAcknowledgement(msgRecvPacket, pp)
	if err != nil {
		return nil, 0, err
	}
	return msg, pp.ProofHeight.RevisionHeight, nil
}

func (cc *CardanoProvider) MsgAcknowledgement(
	msgRecvPacket provider.PacketInfo,
	proof provider.PacketProof,
) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgAcknowledgement{
		Packet:          msgRecvPacket.Packet(),
		Acknowledgement: msgRecvPacket.Ack,
		ProofAcked:      proof.Proof,
		ProofHeight:     proof.ProofHeight,
		Signer:          signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}
func transferMsgAcknowledgement(msg *chantypes.MsgAcknowledgement) *pbchannel.MsgAcknowledgement {
	return &pbchannel.MsgAcknowledgement{
		Packet: &pbchannel.Packet{
			Sequence:           msg.Packet.Sequence,
			SourcePort:         msg.Packet.SourcePort,
			SourceChannel:      msg.Packet.SourceChannel,
			DestinationPort:    msg.Packet.DestinationPort,
			DestinationChannel: msg.Packet.DestinationChannel,
			Data:               msg.Packet.Data,
			TimeoutHeight: &clienttypes.Height{
				RevisionNumber: msg.Packet.TimeoutHeight.RevisionNumber,
				RevisionHeight: msg.Packet.TimeoutHeight.RevisionHeight,
			},
			TimeoutTimestamp: msg.Packet.TimeoutTimestamp,
		},
		Acknowledgement: msg.Acknowledgement,
		ProofAcked:      msg.ProofAcked,
		ProofHeight: &clienttypes.Height{
			RevisionNumber: msg.ProofHeight.RevisionNumber,
			RevisionHeight: msg.ProofHeight.RevisionHeight,
		},
		Signer: msg.Signer,
	}
}

// QueryABCI performs an ABCI query and returns the appropriate response and error sdk error code.
func (cc *CardanoProvider) QueryABCI(ctx context.Context, req abci.RequestQuery) (abci.ResponseQuery, error) {
	return abci.ResponseQuery{}, nil
}

func (cc *CardanoProvider) ConnectionHandshakeProof(
	ctx context.Context,
	msgOpenInit provider.ConnectionInfo,
	height uint64,
) (provider.ConnectionProof, error) {
	clientState, clientStateProof, consensusStateProof, connStateProof, proofHeight, err := cc.GenerateConnHandshakeProof(ctx, int64(height), msgOpenInit.ClientID, msgOpenInit.ConnID)
	if err != nil {
		return provider.ConnectionProof{}, err
	}

	if len(connStateProof) == 0 {
		// It is possible that we have asked for a proof too early.
		// If the connection state proof is empty, there is no point in returning the next message.
		// We are not using (*conntypes.MsgConnectionOpenTry).ValidateBasic here because
		// that chokes on cross-chain bech32 details in ibc-go.
		return provider.ConnectionProof{}, fmt.Errorf("received invalid zero-length connection state proof")
	}

	return provider.ConnectionProof{
		ClientState:          clientState,
		ClientStateProof:     clientStateProof,
		ConsensusStateProof:  consensusStateProof,
		ConnectionStateProof: connStateProof,
		ProofHeight:          proofHeight.(clienttypes.Height),
	}, nil
}

func (cc *CardanoProvider) ConnectionProof(
	ctx context.Context,
	msgOpenAck provider.ConnectionInfo,
	height uint64,
) (provider.ConnectionProof, error) {
	connState, err := cc.QueryConnection(ctx, int64(height), msgOpenAck.ConnID)
	if err != nil {
		return provider.ConnectionProof{}, err
	}

	return provider.ConnectionProof{
		ConnectionStateProof: connState.Proof,
		ProofHeight:          connState.ProofHeight,
	}, nil
}

func (cc *CardanoProvider) MsgChannelCloseInit(info provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgChannelCloseConfirm(msgCloseInit provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgChannelOpenAck(msgOpenTry provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgChannelOpenAck{
		PortId:                msgOpenTry.CounterpartyPortID,
		ChannelId:             msgOpenTry.CounterpartyChannelID,
		CounterpartyChannelId: msgOpenTry.ChannelID,
		CounterpartyVersion:   proof.Version,
		ProofTry:              proof.Proof,
		ProofHeight:           proof.ProofHeight,
		Signer:                signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformMsgChannelOpenAck(msg *chantypes.MsgChannelOpenAck) *pbchannel.MsgChannelOpenAck {
	return &pbchannel.MsgChannelOpenAck{
		PortId:                msg.PortId,
		ChannelId:             msg.ChannelId,
		CounterpartyChannelId: msg.CounterpartyChannelId,
		CounterpartyVersion:   msg.CounterpartyVersion,
		ProofTry:              msg.ProofTry,
		ProofHeight: &clienttypes.Height{
			RevisionNumber: msg.ProofHeight.RevisionNumber,
			RevisionHeight: msg.ProofHeight.RevisionHeight,
		},
		Signer: msg.Signer,
	}
}

func (cc *CardanoProvider) MsgChannelOpenConfirm(msgOpenAck provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgChannelOpenInit(info provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	msg := &chantypes.MsgChannelOpenInit{
		PortId: info.PortID,
		Channel: chantypes.Channel{
			State:    chantypes.INIT,
			Ordering: info.Order,
			Counterparty: chantypes.Counterparty{
				PortId:    info.CounterpartyPortID,
				ChannelId: "",
			},
			ConnectionHops: []string{info.ConnID},
			Version:        info.Version,
		},
		Signer: signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformMsgChannelOpenInit(msg *chantypes.MsgChannelOpenInit) *pbchannel.MsgChannelOpenInit {
	return &pbchannel.MsgChannelOpenInit{
		PortId: msg.PortId,
		Channel: &pbchannel.Channel{
			State:    pbchannel.State_STATE_INIT,
			Ordering: pbchannel.Order(msg.Channel.Ordering),
			Counterparty: &pbchannel.Counterparty{
				PortId:    msg.Channel.Counterparty.PortId,
				ChannelId: "",
			},
			ConnectionHops: msg.Channel.ConnectionHops,
			Version:        msg.Channel.Version,
		},
		Signer: msg.Signer,
	}
}

func (cc *CardanoProvider) MsgChannelOpenTry(msgOpenInit provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgConnectionOpenAck(msgOpenTry provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	csAny, err := clienttypes.PackClientState(proof.ClientState)
	if err != nil {
		return nil, err
	}

	clientState := proof.ClientState
	latestHeight := clientState.GetLatestHeight()

	msg := &conntypes.MsgConnectionOpenAck{
		ConnectionId:             msgOpenTry.CounterpartyConnID,
		CounterpartyConnectionId: msgOpenTry.ConnID,
		Version:                  conntypes.DefaultIBCVersion,
		ClientState:              csAny,
		ProofHeight: clienttypes.Height{
			RevisionNumber: proof.ProofHeight.GetRevisionNumber(),
			RevisionHeight: proof.ProofHeight.GetRevisionHeight(),
		},
		ProofTry:       proof.ConnectionStateProof,
		ProofClient:    proof.ClientStateProof,
		ProofConsensus: proof.ConsensusStateProof,
		ConsensusHeight: clienttypes.Height{
			RevisionNumber: latestHeight.GetRevisionNumber(),
			RevisionHeight: latestHeight.GetRevisionHeight(),
		},
		Signer: signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformMsgConnectionOpenAck(msg *conntypes.MsgConnectionOpenAck) *pbconnection.MsgConnectionOpenAck {
	return &pbconnection.MsgConnectionOpenAck{
		ConnectionId:             msg.ConnectionId,
		CounterpartyConnectionId: msg.CounterpartyConnectionId,
		Version: &pbconnection.Version{
			Identifier: msg.Version.Identifier,
			Features:   msg.Version.Features,
		},
		ClientState: &any1.Any{
			TypeUrl: msg.ClientState.TypeUrl,
			Value:   msg.ClientState.Value,
		},
		ProofHeight:             &msg.ProofHeight,
		ProofTry:                msg.ProofTry,
		ProofClient:             msg.ProofClient,
		ProofConsensus:          msg.ProofConsensus,
		ConsensusHeight:         &msg.ConsensusHeight,
		Signer:                  msg.Signer,
		HostConsensusStateProof: msg.HostConsensusStateProof,
	}
}

func (cc *CardanoProvider) MsgConnectionOpenConfirm(msgOpenAck provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgConnectionOpenInit(info provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &conntypes.MsgConnectionOpenInit{
		ClientId: info.ClientID,
		Counterparty: conntypes.Counterparty{
			ClientId:     info.CounterpartyClientID,
			ConnectionId: "",
			Prefix:       info.CounterpartyCommitmentPrefix,
		},
		Version:     nil,
		DelayPeriod: defaultDelayPeriod,
		Signer:      signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformMsgConnectionOpenInit(msg *conntypes.MsgConnectionOpenInit) *pbconnection.MsgConnectionOpenInit {
	return &pbconnection.MsgConnectionOpenInit{
		ClientId: msg.ClientId,
		Counterparty: &pbconnection.Counterparty{
			ClientId:     msg.Counterparty.ClientId,
			ConnectionId: msg.Counterparty.ConnectionId,
			Prefix:       &msg.Counterparty.Prefix,
		},
		Version:     nil,
		DelayPeriod: msg.DelayPeriod,
		Signer:      msg.Signer,
	}
}

func (cc *CardanoProvider) MsgConnectionOpenTry(msgOpenInit provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	return nil, nil
}

// MsgCreateClient creates an sdk.Msg to update the client on src with consensus state from dst
func (cc *CardanoProvider) MsgCreateClient(
	clientState ibcexported.ClientState,
	consensusState ibcexported.ConsensusState,
) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	anyClientState, err := clienttypes.PackClientState(clientState)
	if err != nil {
		return nil, err
	}

	anyConsensusState, err := clienttypes.PackConsensusState(consensusState)
	if err != nil {
		return nil, err
	}

	msg := &clienttypes.MsgCreateClient{
		ClientState:    anyClientState,
		ConsensusState: anyConsensusState,
		Signer:         signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgRecvPacket(
	msgTransfer provider.PacketInfo,
	proof provider.PacketProof,
) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgRecvPacket{
		Packet:          msgTransfer.Packet(),
		ProofCommitment: proof.Proof,
		ProofHeight:     proof.ProofHeight,
		Signer:          signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformMsgRecvPacket(msg *chantypes.MsgRecvPacket) *pbchannel.MsgRecvPacket {
	return &pbchannel.MsgRecvPacket{
		Packet: &pbchannel.Packet{
			Sequence:           msg.Packet.Sequence,
			SourcePort:         msg.Packet.SourcePort,
			SourceChannel:      msg.Packet.SourceChannel,
			DestinationPort:    msg.Packet.DestinationPort,
			DestinationChannel: msg.Packet.DestinationChannel,
			Data:               msg.Packet.Data,
			TimeoutHeight:      &msg.Packet.TimeoutHeight,
			TimeoutTimestamp:   msg.Packet.TimeoutTimestamp,
		},
		ProofCommitment: msg.ProofCommitment,
		ProofHeight:     &msg.ProofHeight,
		Signer:          msg.Signer,
	}
}

// MsgRegisterCounterpartyPayee creates an sdk.Msg to broadcast the counterparty address
func (cc *CardanoProvider) MsgRegisterCounterpartyPayee(portID, channelID, relayerAddr, counterpartyPayee string) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgSubmitMisbehaviour(clientID string, misbehaviour ibcexported.ClientMessage) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgSubmitQueryResponse(chainID string, queryID provider.ClientICQQueryID, proof provider.ICQProof) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) MsgTimeoutOnClose(msgTransfer provider.PacketInfo, proof provider.PacketProof) (provider.RelayerMessage, error) {
	return nil, nil
}

// MsgTransfer creates a new transfer message
func (cc *CardanoProvider) MsgTransfer(
	dstAddr string,
	amount sdk.Coin,
	info provider.PacketInfo,
) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	senderAddress, err := echovl.NewAddress(signer)
	if err != nil {
		return nil, err
	}
	senderPublicKeyHash := hex.EncodeToString(senderAddress.Payment.Hash())

	msg := &transfertypes.MsgTransfer{
		SourcePort:       info.SourcePort,
		SourceChannel:    info.SourceChannel,
		Token:            amount,
		Sender:           senderPublicKeyHash,
		Receiver:         dstAddr,
		TimeoutTimestamp: info.TimeoutTimestamp,
	}

	// If the timeoutHeight is 0 then we don't need to explicitly set it on the MsgTransfer
	if info.TimeoutHeight.RevisionHeight != 0 {
		msg.TimeoutHeight = info.TimeoutHeight
	}

	msgTransfer := NewCardanoMessage(msg, nil).(CardanoMessage)
	msgTransfer.FeegrantDisabled = true
	return msgTransfer, nil
}

func tranMsgTransferToGWMsgTransfer(msg *transfertypes.MsgTransfer, signer string) *pbchannel.MsgTransfer {
	return &pbchannel.MsgTransfer{
		SourcePort:    msg.SourcePort,
		SourceChannel: msg.SourceChannel,
		Token: &pbchannel.Coin{
			Denom:  msg.Token.Denom,
			Amount: uint64(msg.Token.Amount.Int64()),
		},
		Sender:   msg.Sender,
		Receiver: msg.Receiver,
		TimeoutHeight: &clienttypes.Height{
			RevisionNumber: msg.TimeoutHeight.RevisionNumber,
			RevisionHeight: msg.TimeoutHeight.RevisionHeight,
		},
		TimeoutTimestamp: msg.TimeoutTimestamp,
		Signer:           signer,
	}

}

func (cc *CardanoProvider) MsgUpdateClient(srcClientID string, dstHeader ibcexported.ClientMessage) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	clientMsg, err := clienttypes.PackClientMessage(dstHeader)
	if err != nil {
		return nil, err
	}

	msg := &clienttypes.MsgUpdateClient{
		ClientId:      srcClientID,
		ClientMessage: clientMsg,
		Signer:        signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), nil
}

func transformStdUpdateClientToGwUpdateClient(msg *clienttypes.MsgUpdateClient) *pbclient.MsgUpdateClient {
	return &pbclient.MsgUpdateClient{
		ClientId: msg.ClientId,
		ClientMessage: &any1.Any{
			TypeUrl: msg.ClientMessage.TypeUrl,
			Value:   msg.ClientMessage.Value,
		},
		Signer: msg.Signer,
	}
}

func (cc *CardanoProvider) MsgUpdateClientHeader(latestHeader provider.IBCHeader, trustedHeight clienttypes.Height, trustedHeader provider.IBCHeader) (ibcexported.ClientMessage, error) {
	trustedCosmosHeader, ok := trustedHeader.(provider.TendermintIBCHeader)
	if !ok {
		return nil, fmt.Errorf("unsupported IBC trusted header type, expected: TendermintIBCHeader, actual: %T", trustedHeader)
	}

	latestCosmosHeader, ok := latestHeader.(provider.TendermintIBCHeader)
	if !ok {
		return nil, fmt.Errorf("unsupported IBC header type, expected: TendermintIBCHeader, actual: %T", latestHeader)
	}

	trustedValidatorsProto, err := trustedCosmosHeader.ValidatorSet.ToProto()
	if err != nil {
		return nil, fmt.Errorf("error converting trusted validators to proto object: %w", err)
	}

	signedHeaderProto := latestCosmosHeader.SignedHeader.ToProto()

	validatorSetProto, err := latestCosmosHeader.ValidatorSet.ToProto()
	if err != nil {
		return nil, fmt.Errorf("error converting validator set to proto object: %w", err)
	}

	return &tmclient.Header{
		SignedHeader:      signedHeaderProto,
		ValidatorSet:      validatorSetProto,
		TrustedValidators: trustedValidatorsProto,
		TrustedHeight:     trustedHeight,
	}, nil
}

func (cc *CardanoProvider) MsgUpgradeClient(srcClientId string, consRes *clienttypes.QueryConsensusStateResponse, clientRes *clienttypes.QueryClientStateResponse) (provider.RelayerMessage, error) {
	return nil, nil
}

// NewClientState creates a new tendermint client state tracking the dst chain.
func (cc *CardanoProvider) NewClientState(
	dstChainID string,
	dstUpdateHeader provider.IBCHeader,
	dstTrustingPeriod,
	dstUbdPeriod time.Duration,
	allowUpdateAfterExpiry,
	allowUpdateAfterMisbehaviour bool,
) (ibcexported.ClientState, error) {
	return nil, nil
}

// NextSeqRecv queries for the appropriate Tendermint proof required to prove the next expected packet sequence number
// for a given counterparty channel. This is used in ORDERED channels to ensure packets are being delivered in the
// exact same order as they were sent over the wire.
func (cc *CardanoProvider) NextSeqRecv(
	ctx context.Context,
	msgTransfer provider.PacketInfo,
	height uint64,
) (provider.PacketProof, error) {
	return provider.PacketProof{}, nil
}

func (cc *CardanoProvider) PacketAcknowledgement(
	ctx context.Context,
	msgRecvPacket provider.PacketInfo,
	height uint64,
) (provider.PacketProof, error) {
	res, err := cc.GateWay.QueryPacketAcknowledgement(ctx, transformPacketAcknowledgement(msgRecvPacket.DestPort, msgRecvPacket.DestChannel, msgRecvPacket.Sequence))
	if err != nil {
		return provider.PacketProof{}, err
	}
	if len(res.Acknowledgement) == 0 {
		return provider.PacketProof{}, chantypes.ErrInvalidAcknowledgement
	}
	return provider.PacketProof{
		Proof:       res.Proof,
		ProofHeight: *res.ProofHeight,
	}, nil
}

func transformPacketAcknowledgement(portId, chanId string, seq uint64) *pbchannel.QueryPacketAcknowledgementRequest {
	return &pbchannel.QueryPacketAcknowledgementRequest{
		PortId:    portId,
		ChannelId: chanId,
		Sequence:  seq,
	}
}

func (cc *CardanoProvider) PacketCommitment(
	ctx context.Context,
	msgTransfer provider.PacketInfo,
	height uint64,
) (provider.PacketProof, error) {
	commitment, proof, proofHeight, err := cc.QueryPacketCommitmentGW(ctx, msgTransfer)
	if err != nil {
		return provider.PacketProof{}, fmt.Errorf("error querying comet proof for packet commitment: %w", err)
	}
	// check if packet commitment exists
	if len(commitment) == 0 {
		return provider.PacketProof{}, chantypes.ErrPacketCommitmentNotFound
	}

	return provider.PacketProof{
		Proof:       proof,
		ProofHeight: proofHeight,
	}, nil
}

func (cc *CardanoProvider) PacketReceipt(
	ctx context.Context,
	msgTransfer provider.PacketInfo,
	height uint64,
) (provider.PacketProof, error) {
	return provider.PacketProof{}, nil
}

// broadcastTx broadcasts a transaction with the given raw bytes and then, in an async goroutine, waits for the tx to be included in the block.
// The wait will end after either the asyncTimeout has run out or the asyncCtx exits.
// If there is no error broadcasting, the asyncCallback will be called with success/failure of the wait for block inclusion.
func (cc *CardanoProvider) broadcastTx(
	ctx context.Context, // context for tx broadcast
	tx []byte, // raw tx to be broadcasted
	msgs []provider.RelayerMessage, // used for logging only
	fees sdk.Coins, // used for metrics

	asyncCtx context.Context, // context for async wait for block inclusion after successful tx broadcast
	asyncTimeout time.Duration, // timeout for waiting for block inclusion
	asyncCallbacks []func(*provider.RelayerTxResponse, error), // callback for success/fail of the wait for block inclusion
) error {
	godotenv.Load()

	endpoint := os.Getenv(constant.OgmiosEndpoint)
	submit := hex.EncodeToString(tx)
	var (
		payload = makePayload("SubmitTx", Map{"submit": submit})
		res     Response
	)
	if err := query(ctx, payload, &res, endpoint); err != nil {
		return err
	}

	go cc.waitForTx(asyncCtx, res.Result.SubmitSuccess.TxId, msgs, asyncTimeout, asyncCallbacks)

	return nil
}

// sdkError will return the Cosmos SDK registered error for a given codespace/code combo if registered, otherwise nil.
func (cc *CardanoProvider) sdkError(codespace string, code uint32) error {
	err := errors.Unwrap(sdkerrors.ABCIError(codespace, code, "error broadcasting transaction"))
	if err.Error() != errUnknown {
		return err
	}
	return nil
}

func parseEventsFromTxResponse(resp *sdk.TxResponse) []provider.RelayerEvent {
	var events []provider.RelayerEvent

	if resp == nil {
		return events
	}

	for _, logs := range resp.Logs {
		for _, event := range logs.Events {
			attributes := make(map[string]string)
			for _, attribute := range event.Attributes {
				attributes[attribute.Key] = attribute.Value
			}
			events = append(events, provider.RelayerEvent{
				EventType:  event.Type,
				Attributes: attributes,
			})
		}
	}

	// After SDK v0.50, indexed events are no longer provided in the logs on
	// transaction execution, the response events can be directly used
	if len(events) == 0 {
		for _, event := range resp.Events {
			attributes := make(map[string]string)
			for _, attribute := range event.Attributes {
				attributes[attribute.Key] = attribute.Value
			}
			events = append(events, provider.RelayerEvent{
				EventType:  event.Type,
				Attributes: attributes,
			})
		}
	}

	return events
}

func (cc *CardanoProvider) UpdateFeesSpent(chain, key, address string, fees sdk.Coins) {
	return
}

// waitForTx waits for a transaction to be included in a block, logs success/fail, then invokes callback.
// This is intended to be called as an async goroutine.
func (cc *CardanoProvider) waitForTx(
	ctx context.Context,
	txHash string,
	msgs []provider.RelayerMessage, // used for logging only
	waitTimeout time.Duration,
	callbacks []func(*provider.RelayerTxResponse, error),
) {
	res, err := cc.waitForBlockInclusion(ctx, txHash, waitTimeout)
	if err != nil {
		cc.log.Error("Failed to wait for block inclusion", zap.Error(err))
		if len(callbacks) > 0 {
			for _, cb := range callbacks {
				//Call each callback in order since waitForTx is already invoked asyncronously
				cb(nil, err)
			}
		}
		return
	}

	rlyResp := &provider.RelayerTxResponse{
		Height:    res.Height,
		TxHash:    res.TxHash,
		Codespace: res.Codespace,
		Code:      res.Code,
		Data:      res.Data,
		// Events: parseEventsFromTxResponse(res),
	}

	if res.Code != 0 {
		// Check for any registered SDK errors
		err := cc.sdkError(res.Codespace, res.Code)
		if err == nil {
			err = fmt.Errorf("transaction failed to execute")
		}
		if len(callbacks) > 0 {
			for _, cb := range callbacks {
				//Call each callback in order since waitForTx is already invoked asyncronously
				cb(nil, err)
			}
		}
		cc.LogFailedTx(rlyResp, nil, msgs)
		return
	}

	if len(callbacks) > 0 {
		for _, cb := range callbacks {
			//Call each callback in order since waitForTx is already invoked asyncronously
			cb(rlyResp, nil)
		}
	}

	cc.LogSuccessTx(res, msgs)
}

// waitForBlockInclusion will wait for a transaction to be included in a block, up to waitTimeout or context cancellation.
func (cc *CardanoProvider) waitForBlockInclusion(
	ctx context.Context,
	txHash string,
	waitTimeout time.Duration,
) (*sdk.TxResponse, error) {
	exitAfter := time.After(waitTimeout)
	for {
		select {
		case <-exitAfter:
			return nil, fmt.Errorf("timed out after: %d; %w", waitTimeout, ErrTimeoutAfterWaitingForTxBroadcast)
		// This fixed poll is fine because it's only for logging and updating prometheus metrics currently.
		case <-time.After(time.Millisecond * 1000):
			res, err := cc.GateWay.QueryTransactionByHash(ctx, &ibcclient.QueryTransactionByHashRequest{
				Hash: txHash,
			})
			if err != nil || res.Hash == "" {
				continue
			}

			return &sdk.TxResponse{
				TxHash:  res.Hash,
				Height:  int64(res.Height),
				GasUsed: int64(res.GasFee),
				Info:    fmt.Sprintf("tx_size %v", res.TxSize),
			}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// mkTxResult decodes a comet transaction into an SDK TxResponse.
func (cc *CardanoProvider) mkTxResult(resTx *coretypes.ResultTx) (*sdk.TxResponse, error) {
	return nil, nil
}

// QueryIBCHeader returns the IBC compatible block header (TendermintIBCHeader) at a specific height.
func (cc *CardanoProvider) QueryIBCHeader(ctx context.Context, h int64) (provider.IBCHeader, error) {
	return nil, nil
}

func (cc *CardanoProvider) QueryICQWithProof(ctx context.Context, path string, request []byte, height uint64) (provider.ICQProof, error) {
	return provider.ICQProof{}, nil
}

// RelayPacketFromSequence relays a packet with a given seq on src and returns recvPacket msgs, timeoutPacketmsgs and error
func (cc *CardanoProvider) RelayPacketFromSequence(
	ctx context.Context,
	src provider.ChainProvider,
	srch, dsth, seq uint64,
	srcChanID, srcPortID string,
	order chantypes.Order,
	srcClientId, dstClientId string,
) (provider.RelayerMessage, provider.RelayerMessage, error) {
	msgTransfer, err := src.QuerySendPacket(ctx, srcChanID, srcPortID, seq)
	if err != nil {
		return nil, nil, err
	}

	blockData, err := cc.QueryBlockData(ctx, int64(dsth))
	if err != nil {
		return nil, nil, err
	}

	if err := cc.ValidatePacket(msgTransfer, provider.LatestBlock{
		Height: dsth,
		Time:   time.Unix(int64(blockData.Timestamp), 0),
	}); err != nil {
		switch err.(type) {
		case *provider.TimeoutHeightError, *provider.TimeoutTimestampError, *provider.TimeoutOnCloseError:
			var pp provider.PacketProof
			switch order {
			case chantypes.UNORDERED:
				pp, err = cc.QueryProofUnreceivedPackets(ctx, msgTransfer.DestChannel, msgTransfer.DestPort, msgTransfer.Sequence, dsth)
				if err != nil {
					return nil, nil, err
				}

				srcBlockData, err := cc.QueryBlockData(ctx, int64(pp.ProofHeight.RevisionHeight))
				if err != nil {
					return nil, nil, err
				}

				msgUpdateClient, err := src.MsgUpdateClient(srcClientId, srcBlockData)
				if err != nil {
					return nil, nil, err
				}

				err = src.SendMessagesToMempool(ctx, []provider.RelayerMessage{msgUpdateClient}, "", context.Background(), nil)
				if err != nil {
					return nil, nil, err
				}
			case chantypes.ORDERED:
				pp, err = cc.NextSeqRecv(ctx, msgTransfer, dsth)
				if err != nil {
					return nil, nil, err
				}
			}
			if _, ok := err.(*provider.TimeoutOnCloseError); ok {
				timeout, err := src.MsgTimeoutOnClose(msgTransfer, pp)
				if err != nil {
					return nil, nil, err
				}
				return nil, timeout, nil
			} else {
				timeout, err := src.MsgTimeout(msgTransfer, pp)
				if err != nil {
					return nil, nil, err
				}
				return nil, timeout, nil
			}
		default:
			return nil, nil, err
		}
	}

	pp, err := src.PacketCommitment(ctx, msgTransfer, srch)
	if err != nil {
		return nil, nil, err
	}

	// Update client before build MsgRecvPacket to cosmos
	srcClientState, err := cc.QueryClientState(ctx, int64(srch), dstClientId)
	if err != nil {
		return nil, nil, err
	}

	dstHeader, err := src.QueryIBCHeader(ctx, int64(pp.ProofHeight.RevisionHeight))
	if err != nil {
		return nil, nil, err
	}

	srcTrustedHeader, err := src.QueryIBCHeader(ctx, int64(srcClientState.GetLatestHeight().GetRevisionHeight())+1)
	if err != nil {
		return nil, nil, err
	}

	updateHeader, err := src.MsgUpdateClientHeader(dstHeader, srcClientState.GetLatestHeight().(clienttypes.Height), srcTrustedHeader)
	if err != nil {
		return nil, nil, err
	}

	msgUpdateClient, err := cc.MsgUpdateClient(dstClientId, updateHeader)
	err = cc.SendMessagesToMempool(ctx, []provider.RelayerMessage{msgUpdateClient}, "", context.Background(), nil)
	if err != nil {
		return nil, nil, err
	}
	// End Update Client

	packet, err := cc.MsgRecvPacket(msgTransfer, pp)
	if err != nil {
		return nil, nil, err
	}

	return packet, nil, nil
}

// SendMessage attempts to sign, encode & send a RelayerMessage
// This is used extensively in the relayer as an extension of the Provider interface
func (cc *CardanoProvider) SendMessage(ctx context.Context, msg provider.RelayerMessage, memo string) (*provider.RelayerTxResponse, bool, error) {
	return cc.SendMessages(ctx, []provider.RelayerMessage{msg}, memo)
}

// SendMessages attempts to sign, encode, & send a slice of RelayerMessages
// This is used extensively in the relayer as an extension of the Provider interface
//
// NOTE: An error is returned if there was an issue sending the transaction. A successfully sent, but failed
// transaction will not return an error. If a transaction is successfully sent, the result of the execution
// of that transaction will be logged. A boolean indicating if a transaction was successfully
// sent and executed successfully is returned.
func (cc *CardanoProvider) SendMessages(ctx context.Context, msgs []provider.RelayerMessage, memo string) (*provider.RelayerTxResponse, bool, error) {
	var (
		rlyResp     *provider.RelayerTxResponse
		callbackErr error
		wg          sync.WaitGroup
	)

	callback := func(rtr *provider.RelayerTxResponse, err error) {
		rlyResp = rtr
		callbackErr = err
		wg.Done()
	}

	wg.Add(1)

	if err := retry.Do(func() error {
		return cc.SendMessagesToMempool(ctx, msgs, memo, ctx, []func(*provider.RelayerTxResponse, error){callback})
	}, retry.Context(ctx), rtyAtt, rtyDel, rtyErr, retry.OnRetry(func(n uint, err error) {
		cc.log.Info(
			"Error building or broadcasting transaction",
			zap.String("chain_id", cc.PCfg.ChainID),
			zap.Uint("attempt", n+1),
			zap.Uint("max_attempts", rtyAttNum),
			zap.Error(err),
		)
	})); err != nil {
		return nil, false, err
	}

	wg.Wait()

	if callbackErr != nil {
		return rlyResp, false, callbackErr
	}

	if rlyResp.Code != 0 {
		return rlyResp, false, fmt.Errorf("transaction failed with code: %d", rlyResp.Code)
	}

	return rlyResp, true, callbackErr
}

// SendMessagesToMempool simulates and broadcasts a transaction with the given msgs and memo.
// This method will return once the transaction has entered the mempool.
// In an async goroutine, will wait for the tx to be included in the block unless asyncCtx exits.
// If there is no error broadcasting, the asyncCallback will be called with success/failure of the wait for block inclusion.
func (cc *CardanoProvider) SendMessagesToMempool(
	ctx context.Context,
	msgs []provider.RelayerMessage,
	memo string,

	asyncCtx context.Context,
	asyncCallbacks []func(*provider.RelayerTxResponse, error),
) error {
	txSignerKey, feegranterKey, err := cc.buildSignerConfig(msgs)
	if err != nil {
		return err
	}

	sequenceGuard := ensureSequenceGuard(cc, txSignerKey)
	sequenceGuard.Mu.Lock()
	defer sequenceGuard.Mu.Unlock()

	// Currently only supports sending 1 message per transaction for Cardano
	for _, msg := range msgs {
		txBytes, sequence, fees, err := cc.buildMessages(ctx, []provider.RelayerMessage{msg}, memo, 0, txSignerKey, feegranterKey, sequenceGuard)

		if err != nil {
			// Account sequence mismatch errors can happen on the simulated transaction also.
			if strings.Contains(err.Error(), sdkerrors.ErrWrongSequence.Error()) {
				cc.handleAccountSequenceMismatchError(sequenceGuard, err)
			}

			return err
		}
		if err := cc.broadcastTx(ctx, txBytes, []provider.RelayerMessage{msg}, fees, asyncCtx, defaultBroadcastWaitTimeout, asyncCallbacks); err != nil {
			if strings.Contains(err.Error(), sdkerrors.ErrWrongSequence.Error()) {
				cc.handleAccountSequenceMismatchError(sequenceGuard, err)
			}

			return err
		}

		// we had a successful tx broadcast with this sequence, so update it to the next
		cc.updateNextAccountSequence(sequenceGuard, sequence+1)
	}

	return nil
}

var seqGuardSingleton sync.Mutex

// Gets the sequence guard. If it doesn't exist, initialized and returns it.
func ensureSequenceGuard(cc *CardanoProvider, key string) *WalletState {
	seqGuardSingleton.Lock()
	defer seqGuardSingleton.Unlock()

	if cc.walletStateMap == nil {
		cc.walletStateMap = map[string]*WalletState{}
	}

	sequenceGuard, ok := cc.walletStateMap[key]
	if !ok {
		cc.walletStateMap[key] = &WalletState{}
		return cc.walletStateMap[key]
	}

	return sequenceGuard
}

func (cc *CardanoProvider) buildSignerConfig(msgs []provider.RelayerMessage) (
	txSignerKey string,
	feegranterKey string,
	err error,
) {
	//Guard against race conditions when choosing a signer/feegranter
	cc.feegrantMu.Lock()
	defer cc.feegrantMu.Unlock()

	//Some messages have feegranting disabled. If any message in the TX disables feegrants, then the TX will not be feegranted.
	isFeegrantEligible := cc.PCfg.FeeGrants != nil

	for _, curr := range msgs {
		if cMsg, ok := curr.(CardanoMessage); ok {
			if cMsg.FeegrantDisabled {
				isFeegrantEligible = false
			}
		}
	}

	//By default, we should sign TXs with the provider's default key
	txSignerKey = cc.PCfg.Key

	if isFeegrantEligible {
		txSignerKey, feegranterKey = cc.GetTxFeeGrant()
		signerAcc, addrErr := cc.GetKeyAddressForKey(txSignerKey)
		if addrErr != nil {
			err = addrErr
			return
		}

		signerAccAddr, encodeErr := cc.EncodeBech32AccAddr(signerAcc)
		if encodeErr != nil {
			err = encodeErr
			return
		}

		//Overwrite the 'Signer' field in any Msgs that provide an 'optionalSetSigner' callback
		for _, curr := range msgs {
			if cMsg, ok := curr.(CardanoMessage); ok {
				if cMsg.SetSigner != nil {
					cMsg.SetSigner(signerAccAddr)
				}
			}
		}
	}

	return
}

func (cc *CardanoProvider) ValidatePacket(msgTransfer provider.PacketInfo, latest provider.LatestBlock) error {
	if msgTransfer.Sequence == 0 {
		return errors.New("refusing to relay packet with sequence: 0")
	}

	if len(msgTransfer.Data) == 0 {
		return errors.New("refusing to relay packet with empty data")
	}

	// This should not be possible, as it violates IBC spec
	if msgTransfer.TimeoutHeight.IsZero() && msgTransfer.TimeoutTimestamp == 0 {
		return errors.New("refusing to relay packet without a timeout (height or timestamp must be set)")
	}

	revision := clienttypes.ParseChainID(cc.PCfg.ChainID)
	latestClientTypesHeight := clienttypes.NewHeight(revision, latest.Height)
	if !msgTransfer.TimeoutHeight.IsZero() && latestClientTypesHeight.GTE(msgTransfer.TimeoutHeight) {
		return provider.NewTimeoutHeightError(latest.Height, msgTransfer.TimeoutHeight.RevisionHeight)
	}
	latestTimestamp := uint64(latest.Time.UnixNano())
	if msgTransfer.TimeoutTimestamp > 0 && latestTimestamp > msgTransfer.TimeoutTimestamp {
		return provider.NewTimeoutTimestampError(latestTimestamp, msgTransfer.TimeoutTimestamp)
	}

	return nil
}

func (cc *CardanoProvider) buildMessages(
	ctx context.Context,
	msgs []provider.RelayerMessage,
	memo string,
	gas uint64,
	txSignerKey string,
	feegranterKey string,
	sequenceGuard *WalletState,
) (
	txBytes []byte,
	sequence uint64,
	fees sdk.Coins,
	err error,
) {
	// Prepare transaction factory
	txf, err := cc.PrepareFactory(cc.TxFactory(), txSignerKey)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	if memo != "" {
		txf = txf.WithMemo(memo)
	}

	signer, err := cc.Address()
	if err != nil {
		return nil, 0, nil, err
	}

	// TO-DO: support multiple msgs per transaction
	if len(msgs) != 1 {
		return nil, 0, sdk.Coins{}, fmt.Errorf("Only supports 1 msg per transaction")
	}

	cardanoMsg, ok := msgs[0].(CardanoMessage)
	if !ok {
		return nil, 0, sdk.Coins{}, fmt.Errorf("not a cardano message")
	}

	msgBytes, err := cc.buildMsgViaGW(ctx, cardanoMsg, signer)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	var babbageTx BabbageTransaction
	if _, err := cbor.Decode(msgBytes, &babbageTx); err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	// Generate the bytes to be signed.
	txHash := babbageTx.Body.Hash()
	bytesToSign, err := hex.DecodeString(txHash)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	k, err := txf.Keybase().Key(txSignerKey)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	pubKey, err := k.GetPubKey()
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	// Sign those bytes
	sigBytes, _, err := txf.Keybase().Sign(txSignerKey, bytesToSign)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	// Construct signed transaction
	var vKeyWitnesses []VKeyWitness = []VKeyWitness{
		{
			VKey:      pubKey.Bytes(),
			Signature: sigBytes[:],
		},
	}

	var interfaces []interface{} = make([]interface{}, len(vKeyWitnesses))
	for i, v := range vKeyWitnesses {
		interfaces[i] = v
	}
	babbageTx.WitnessSet.VkeyWitnesses = interfaces

	txBytes, err = cbor.Encode(babbageTx)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	return txBytes, 0, sdk.Coins{}, nil
}

// handleAccountSequenceMismatchError will parse the error string, e.g.:
// "account sequence mismatch, expected 10, got 9: incorrect account sequence"
// and update the next account sequence with the expected value.
func (cc *CardanoProvider) handleAccountSequenceMismatchError(sequenceGuard *WalletState, err error) {
	return
}

// PrepareFactory mutates the tx factory with the appropriate account number, sequence number, and min gas settings.
func (cc *CardanoProvider) PrepareFactory(txf tx.Factory, signingKey string) (tx.Factory, error) {
	var (
		err error
	)
	// Get key address and retry if fail
	if err = retry.Do(func() error {
		_, err = cc.GetKeyAddressForKey(signingKey)
		if err != nil {
			return err
		}
		return err
	}, rtyAtt, rtyDel, rtyErr); err != nil {
		return tx.Factory{}, err
	}

	if cc.PCfg.MinGasAmount != 0 {
		txf = txf.WithGas(cc.PCfg.MinGasAmount)
	}

	return txf, nil
}

// SetWithExtensionOptions sets the dynamic fee extension options on the given
// transaction factory using the configuration options from the CosmosProvider.
// The function creates an extension option for each configuration option and
// serializes it into a byte slice before adding it to the list of extension
// options. The function returns the updated transaction factory with the new
// extension options or an error if the serialization fails or an invalid option
// value is encountered.
func (cc *CardanoProvider) SetWithExtensionOptions(txf tx.Factory) (tx.Factory, error) {
	// cardano doesn't support this feature
	return txf, nil
}

// TxFactory instantiates a new tx factory with the appropriate configuration settings for this chain.
func (cc *CardanoProvider) TxFactory() tx.Factory {
	return tx.Factory{}.
		WithAccountRetriever(cc).
		WithChainID(cc.PCfg.ChainID).
		WithTxConfig(cc.Cdc.TxConfig).
		WithGasAdjustment(cc.PCfg.GasAdjustment).
		WithGasPrices(cc.PCfg.GasPrices).
		WithKeybase(cc.Keybase)
}

// CalculateGas simulates a tx to generate the appropriate gas settings before broadcasting a tx.
func (cc *CardanoProvider) CalculateGas(ctx context.Context, txf tx.Factory, signingKey string, msgs ...sdk.Msg) (txtypes.SimulateResponse, uint64, error) {
	return txtypes.SimulateResponse{}, 0, nil
}

// BuildSimTx creates an unsigned tx with an empty single signature and returns
// the encoded transaction or an error if the unsigned transaction cannot be built.
func BuildSimTx(info *keyring.Record, txf tx.Factory, msgs ...sdk.Msg) ([]byte, error) {
	panic("")
}

// SignMode returns the SDK sign mode type reflective of the specified sign mode in the config file.
func (pc *CardanoProvider) SignMode() signing.SignMode {
	return 0
}

// AdjustEstimatedGas adjusts the estimated gas usage by multiplying it by the gas adjustment factor
// and return estimated gas is higher than max gas error. If the gas usage is zero, the adjusted gas
// is also zero.
func (cc *CardanoProvider) AdjustEstimatedGas(gasUsed uint64) (uint64, error) {
	return 0, nil
}

// protoTxProvider is a type which can provide a proto transaction. It is a
// workaround to get access to the wrapper TxBuilder's method GetProtoTx().
type protoTxProvider interface {
	GetProtoTx() *txtypes.Tx
}

func (cc *CardanoProvider) MsgTimeout(msgTransfer provider.PacketInfo, proof provider.PacketProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	assembled := &chantypes.MsgTimeout{
		Packet:           msgTransfer.Packet(),
		ProofUnreceived:  proof.Proof,
		ProofHeight:      proof.ProofHeight,
		NextSequenceRecv: msgTransfer.Sequence,
		Signer:           signer,
	}

	_, err = cc.GateWay.PacketTimeout(context.Background(), transformMsgTimeout(assembled))
	if err != nil {
		return nil, err
	}

	return NewCardanoMessage(assembled, func(signer string) {
		assembled.Signer = signer
	}), nil
}

func transformMsgTimeout(msg *chantypes.MsgTimeout) *pbchannel.MsgTimeout {
	return &pbchannel.MsgTimeout{
		Packet: &pbchannel.Packet{
			Sequence:           msg.Packet.Sequence,
			SourcePort:         msg.Packet.SourcePort,
			SourceChannel:      msg.Packet.SourceChannel,
			DestinationPort:    msg.Packet.DestinationPort,
			DestinationChannel: msg.Packet.DestinationChannel,
			Data:               msg.Packet.Data,
			TimeoutHeight: &clienttypes.Height{
				RevisionNumber: msg.Packet.TimeoutHeight.RevisionNumber,
				RevisionHeight: msg.Packet.TimeoutHeight.RevisionHeight,
			},
			TimeoutTimestamp: msg.Packet.TimeoutTimestamp,
		},
		ProofUnreceived: msg.ProofUnreceived,
		ProofHeight: &clienttypes.Height{
			RevisionNumber: msg.ProofHeight.RevisionNumber,
			RevisionHeight: msg.ProofHeight.RevisionHeight,
		},
		NextSequenceRecv: msg.NextSequenceRecv,
		Signer:           msg.Signer,
	}
}

func (cc *CardanoProvider) MsgTimeoutRefresh(channelId string) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	//todo: find a better solution for this msg
	msg := &chantypes.MsgChannelCloseInit{
		ChannelId: channelId,
		Signer:    signer,
	}

	return NewCardanoMessage(msg, func(signer string) {
	}), nil
}

func transformMsgTimeoutRefresh(msg *chantypes.MsgChannelCloseInit) *pbchannel.MsgTimeoutRefresh {
	return &pbchannel.MsgTimeoutRefresh{
		ChannelId: msg.ChannelId,
		Signer:    msg.Signer,
	}

}

func (cc *CardanoProvider) ChannelProof(
	ctx context.Context,
	msg provider.ChannelInfo,
	height uint64,
) (provider.ChannelProof, error) {
	channelRes, err := cc.QueryChannel(ctx, int64(height), msg.ChannelID, msg.PortID)
	if err != nil {
		return provider.ChannelProof{}, err
	}
	return provider.ChannelProof{
		Proof:       channelRes.Proof,
		ProofHeight: channelRes.ProofHeight,
		Version:     channelRes.Channel.Version,
		Ordering:    channelRes.Channel.Ordering,
	}, nil
}

func (cc *CardanoProvider) MsgCreateCosmosClient(clientState ibcexported.ClientState, consensusState ibcexported.ConsensusState) (provider.RelayerMessage, string, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, "", err
	}

	anyClientState, err := PackClientState(clientState)
	if err != nil {
		return nil, "", err
	}

	anyConsensusState, err := PackConsensusState(consensusState)
	if err != nil {
		return nil, "", err
	}

	msg := &clienttypes.MsgCreateClient{
		ClientState:    anyClientState,
		ConsensusState: anyConsensusState,
		Signer:         "",
	}

	res, err := cc.GateWay.CreateClient(context.Background(), msg.ClientState, msg.ConsensusState, signer)
	if err != nil {
		return nil, "", err
	}

	return NewCardanoMessage(msg, func(signer string) {
		msg.Signer = signer
	}), res.ClientId, nil
}

func (cc *CardanoProvider) MsgCreateCardanoClient(clientState *pbclientstruct.ClientState, consensusState *pbclientstruct.ConsensusState) (provider.RelayerMessage, error) {
	return nil, nil
}

func (cc *CardanoProvider) buildMsgViaGW(ctx context.Context, cardanoMsg CardanoMessage, signer string) ([]byte, error) {
	switch sdk.MsgTypeURL(cardanoMsg.Msg) {
	case constant.MsgCreateClient:
		if createClientMsg, ok := cardanoMsg.Msg.(*clienttypes.MsgCreateClient); !ok {
			return nil, fmt.Errorf("not a create client message")
		} else {
			res, err := cc.GateWay.CreateClient(ctx, createClientMsg.ClientState, createClientMsg.ConsensusState, signer)
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgUpdateClient:
		if updateClientMsg, ok := cardanoMsg.Msg.(*clienttypes.MsgUpdateClient); !ok {
			return nil, fmt.Errorf("not a update client message")
		} else {
			res, err := cc.GateWay.UpdateClient(ctx, transformStdUpdateClientToGwUpdateClient(updateClientMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgConnectionOpenInit:
		if connectionOpenInitMsg, ok := cardanoMsg.Msg.(*conntypes.MsgConnectionOpenInit); !ok {
			return nil, fmt.Errorf("not a connection open init message")
		} else {
			res, err := cc.GateWay.ConnectionOpenInit(ctx, transformMsgConnectionOpenInit(connectionOpenInitMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgConnectionOpenAck:
		if connectionOpenAckMsg, ok := cardanoMsg.Msg.(*conntypes.MsgConnectionOpenAck); !ok {
			return nil, fmt.Errorf("not a connection open ack message")
		} else {
			res, err := cc.GateWay.ConnectionOpenAck(ctx, transformMsgConnectionOpenAck(connectionOpenAckMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgChannelOpenInit:
		if channelOpenInitMsg, ok := cardanoMsg.Msg.(*chantypes.MsgChannelOpenInit); !ok {
			return nil, fmt.Errorf("not a channel open init message")
		} else {
			res, err := cc.GateWay.ChannelOpenInit(ctx, transformMsgChannelOpenInit(channelOpenInitMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgChannelOpenAck:
		if channelOpenAckMsg, ok := cardanoMsg.Msg.(*chantypes.MsgChannelOpenAck); !ok {
			return nil, fmt.Errorf("not a channel open ack message")
		} else {
			res, err := cc.GateWay.ChannelOpenAck(ctx, transformMsgChannelOpenAck(channelOpenAckMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgApplicationTransfer:
		if applicationTransferMsg, ok := cardanoMsg.Msg.(*transfertypes.MsgTransfer); !ok {
			return nil, fmt.Errorf("not an application transfer message")
		} else {
			res, err := cc.GateWay.Transfer(ctx, tranMsgTransferToGWMsgTransfer(applicationTransferMsg, signer))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}

	case constant.MsgRecvPacket:
		if recvPacketMsg, ok := cardanoMsg.Msg.(*chantypes.MsgRecvPacket); !ok {
			return nil, fmt.Errorf("not a recv packet message")
		} else {
			res, err := cc.GateWay.RecvPacket(ctx, transformMsgRecvPacket(recvPacketMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgAcknowledgement:
		if acknowledgementMsg, ok := cardanoMsg.Msg.(*chantypes.MsgAcknowledgement); !ok {
			return nil, fmt.Errorf("not an acknowledgement message")
		} else {
			res, err := cc.GateWay.PacketAcknowledgement(ctx, transferMsgAcknowledgement(acknowledgementMsg))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgTimeoutRefresh:
		if msgTimeoutRefresh, ok := cardanoMsg.Msg.(*chantypes.MsgChannelCloseInit); !ok {
			return nil, fmt.Errorf("not a msgTimeoutRefresh")
		} else {
			res, err := cc.GateWay.TimeoutRefresh(context.Background(), transformMsgTimeoutRefresh(msgTimeoutRefresh))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	case constant.MsgTimeOut:
		if msgTimeOut, ok := cardanoMsg.Msg.(*chantypes.MsgTimeout); !ok {
			return nil, fmt.Errorf("not a msgTimeOut")
		} else {
			res, err := cc.GateWay.PacketTimeout(ctx, transformMsgTimeout(msgTimeOut))
			if err != nil {
				return nil, err
			}
			return res.UnsignedTx.Value, nil
		}
	default:
		return nil, fmt.Errorf("not supported message")
	}
	return nil, fmt.Errorf("not supported message")
}
