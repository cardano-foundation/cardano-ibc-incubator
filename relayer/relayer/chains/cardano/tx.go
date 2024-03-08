package cardano

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	pbclient "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	any1 "github.com/golang/protobuf/ptypes/any"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/avast/retry-go/v4"
	pbconnection "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	pbchannel "github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	pbclientstruct "github.com/cardano/relayer/v1/cosmjs-types/go/sidechain/x/clients/cardano"
	strideicqtypes "github.com/cardano/relayer/v1/relayer/chains/cosmos/stride"
	"github.com/cardano/relayer/v1/relayer/ethermint"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/light"
	rpcclient "github.com/cometbft/cometbft/rpc/client"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/client/tx"
	"github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keyring"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	"github.com/cosmos/cosmos-sdk/store/rootmulti"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	txtypes "github.com/cosmos/cosmos-sdk/types/tx"
	"github.com/cosmos/cosmos-sdk/types/tx/signing"
	feetypes "github.com/cosmos/ibc-go/v7/modules/apps/29-fee/types"
	transfertypes "github.com/cosmos/ibc-go/v7/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	host "github.com/cosmos/ibc-go/v7/modules/core/24-host"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"

	"github.com/cardano/relayer/v1/relayer/provider"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
func (cc *CardanoProvider) AcknowledgementFromSequence(ctx context.Context, dst provider.ChainProvider, dsth, seq uint64, dstChanId, dstPortId, srcChanId, srcPortId string) (provider.RelayerMessage, error) {
	msgRecvPacket, err := dst.QueryRecvPacket(ctx, dstChanId, dstPortId, seq)
	if err != nil {
		return nil, err
	}

	pp, err := dst.PacketAcknowledgement(ctx, msgRecvPacket, dsth)
	if err != nil {
		return nil, err
	}
	msg, err := cc.MsgAcknowledgement(msgRecvPacket, pp)
	if err != nil {
		return nil, err
	}
	return msg, nil
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

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

// QueryABCI performs an ABCI query and returns the appropriate response and error sdk error code.
func (cc *CardanoProvider) QueryABCI(ctx context.Context, req abci.RequestQuery) (abci.ResponseQuery, error) {
	opts := rpcclient.ABCIQueryOptions{
		Height: req.Height,
		Prove:  req.Prove,
	}
	result, err := cc.RPCClient.ABCIQueryWithOptions(ctx, req.Path, req.Data, opts)
	if err != nil {
		return abci.ResponseQuery{}, err
	}

	if !result.Response.IsOK() {
		return abci.ResponseQuery{}, sdkErrorToGRPCError(result.Response)
	}

	// data from trusted node or subspace query doesn't need verification
	if !opts.Prove || !isQueryStoreWithProof(req.Path) {
		return result.Response, nil
	}

	return result.Response, nil
}

func sdkErrorToGRPCError(resp abci.ResponseQuery) error {
	switch resp.Code {
	case sdkerrors.ErrInvalidRequest.ABCICode():
		return status.Error(codes.InvalidArgument, resp.Log)
	case sdkerrors.ErrUnauthorized.ABCICode():
		return status.Error(codes.Unauthenticated, resp.Log)
	case sdkerrors.ErrKeyNotFound.ABCICode():
		return status.Error(codes.NotFound, resp.Log)
	default:
		return status.Error(codes.Unknown, resp.Log)
	}
}

// isQueryStoreWithProof expects a format like /<queryType>/<storeName>/<subpath>
// queryType must be "store" and subpath must be "key" to require a proof.
func isQueryStoreWithProof(path string) bool {
	if !strings.HasPrefix(path, "/") {
		return false
	}

	paths := strings.SplitN(path[1:], "/", 3)

	switch {
	case len(paths) != 3:
		return false
	case paths[0] != "store":
		return false
	case rootmulti.RequireProof("/" + paths[2]):
		return true
	}

	return false
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
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgChannelCloseInit{
		PortId:    info.PortID,
		ChannelId: info.ChannelID,
		Signer:    signer,
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgChannelCloseConfirm(msgCloseInit provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgChannelCloseConfirm{
		PortId:      msgCloseInit.CounterpartyPortID,
		ChannelId:   msgCloseInit.CounterpartyChannelID,
		ProofInit:   proof.Proof,
		ProofHeight: proof.ProofHeight,
		Signer:      signer,
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgChannelOpenAck(msgOpenTry provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
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

	chanOpenAckRes, err := cc.GateWay.ChannelOpenAck(
		context.Background(),
		transformMsgChannelOpenAck(msg),
	)
	if err != nil {
		return nil, err
	}

	return NewCardanoMessage(msg, chanOpenAckRes.UnsignedTx, func(signer string) {
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
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgChannelOpenConfirm{
		PortId:      msgOpenAck.CounterpartyPortID,
		ChannelId:   msgOpenAck.CounterpartyChannelID,
		ProofAck:    proof.Proof,
		ProofHeight: proof.ProofHeight,
		Signer:      signer,
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgChannelOpenInit(info provider.ChannelInfo, proof provider.ChannelProof) (provider.RelayerMessage, error) {
	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
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

	chanOpenInitRes, err := cc.GateWay.ChannelOpenInit(
		context.Background(),
		transformMsgChannelOpenInit(msg))
	if err != nil {
		return nil, err
	}

	return NewCardanoMessage(msg, chanOpenInitRes.UnsignedTx, func(signer string) {
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
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgChannelOpenTry{
		PortId:            msgOpenInit.CounterpartyPortID,
		PreviousChannelId: msgOpenInit.CounterpartyChannelID,
		Channel: chantypes.Channel{
			State:    chantypes.TRYOPEN,
			Ordering: proof.Ordering,
			Counterparty: chantypes.Counterparty{
				PortId:    msgOpenInit.PortID,
				ChannelId: msgOpenInit.ChannelID,
			},
			ConnectionHops: []string{msgOpenInit.CounterpartyConnID},
			// In the future, may need to separate this from the CounterpartyVersion.
			// https://github.com/cosmos/ibc/tree/master/spec/core/ics-004-channel-and-packet-semantics#definitions
			// Using same version as counterparty for now.
			Version: proof.Version,
		},
		CounterpartyVersion: proof.Version,
		ProofInit:           proof.Proof,
		ProofHeight:         proof.ProofHeight,
		Signer:              signer,
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgConnectionOpenAck(msgOpenTry provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
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

	res, err := cc.GateWay.ConnectionOpenAck(context.Background(), transformMsgConnectionOpenAck(msg))
	if err != nil {
		return nil, err
	}

	return NewCardanoMessage(msg, res.UnsignedTx, func(signer string) {
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
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &conntypes.MsgConnectionOpenConfirm{
		ConnectionId: msgOpenAck.CounterpartyConnID,
		ProofAck:     proof.ConnectionStateProof,
		ProofHeight:  proof.ProofHeight,
		Signer:       signer,
	}

	_, err = cc.GateWay.ConnectionOpenConfirm(context.Background(), msg)
	if err != nil {
		return nil, err
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgConnectionOpenInit(info provider.ConnectionInfo, proof provider.ConnectionProof) (provider.RelayerMessage, error) {
	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
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

	connOpenInitRes, err := cc.GateWay.ConnectionOpenInit(context.Background(), transformMsgConnectionOpenInit(msg))
	if err != nil {
		return nil, err
	}

	return NewCardanoMessage(msg, connOpenInitRes.UnsignedTx, func(signer string) {
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
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	csAny, err := clienttypes.PackClientState(proof.ClientState)
	if err != nil {
		return nil, err
	}

	counterparty := conntypes.Counterparty{
		ClientId:     msgOpenInit.ClientID,
		ConnectionId: msgOpenInit.ConnID,
		Prefix:       defaultChainPrefix,
	}

	msg := &conntypes.MsgConnectionOpenTry{
		ClientId:             msgOpenInit.CounterpartyClientID,
		PreviousConnectionId: msgOpenInit.CounterpartyConnID,
		ClientState:          csAny,
		Counterparty:         counterparty,
		DelayPeriod:          defaultDelayPeriod,
		CounterpartyVersions: conntypes.ExportedVersionsToProto(conntypes.GetCompatibleVersions()),
		ProofHeight:          proof.ProofHeight,
		ProofInit:            proof.ConnectionStateProof,
		ProofClient:          proof.ClientStateProof,
		ProofConsensus:       proof.ConsensusStateProof,
		ConsensusHeight:      proof.ClientState.GetLatestHeight().(clienttypes.Height),
		Signer:               signer,
	}

	//res, err := cc.GateWay.ConnectionOpenTry(context.Background(), msg)
	_, err = cc.GateWay.ConnectionOpenTry(context.Background(), msg)
	if err != nil {
		return nil, err
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

// MsgCreateClient creates an sdk.Msg to update the client on src with consensus state from dst
func (cc *CardanoProvider) MsgCreateClient(
	clientState ibcexported.ClientState,
	consensusState ibcexported.ConsensusState,
) (provider.RelayerMessage, error) {
	//signer, err := cc.Address()
	//if err != nil {
	//	return nil, err
	//}

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
		Signer:         "signer",
	}

	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
	if err != nil {
		return nil, err
	}
	res, err := cc.GateWay.CreateClient(context.Background(), msg.ClientState, msg.ConsensusState, signer)
	if err != nil {
		return nil, err
	}

	_, err = cc.TxCardano.SignAndSubmitTx(context.Background(), cc.ChainId(), res.UnsignedTx.GetValue())
	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgRecvPacket(
	msgTransfer provider.PacketInfo,
	proof provider.PacketProof,
) (provider.RelayerMessage, error) {
	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
	if err != nil {
		return nil, err
	}
	msg := &chantypes.MsgRecvPacket{
		Packet:          msgTransfer.Packet(),
		ProofCommitment: proof.Proof,
		ProofHeight:     proof.ProofHeight,
		Signer:          signer,
	}

	res, err := cc.GateWay.RecvPacket(context.Background(), transformMsgRecvPacket(msg))
	if err != nil {
		return nil, err
	}
	return NewCardanoMessage(msg, res.UnsignedTx, func(signer string) {
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
		Signer: msg.Signer,
	}
}

// MsgRegisterCounterpartyPayee creates an sdk.Msg to broadcast the counterparty address
func (cc *CardanoProvider) MsgRegisterCounterpartyPayee(portID, channelID, relayerAddr, counterpartyPayee string) (provider.RelayerMessage, error) {
	msg := feetypes.NewMsgRegisterCounterpartyPayee(portID, channelID, relayerAddr, counterpartyPayee)
	return NewCardanoMessage(msg, nil, nil), nil
}

func (cc *CardanoProvider) MsgSubmitMisbehaviour(clientID string, misbehaviour ibcexported.ClientMessage) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}

	msg, err := clienttypes.NewMsgSubmitMisbehaviour(clientID, misbehaviour, signer)
	if err != nil {
		return nil, err
	}

	anynil := anypb.Any{}
	return NewCardanoMessage(msg, &anynil, func(signer string) {
		msg.Signer = signer
	}), nil
}

func (cc *CardanoProvider) MsgSubmitQueryResponse(chainID string, queryID provider.ClientICQQueryID, proof provider.ICQProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &strideicqtypes.MsgSubmitQueryResponse{
		ChainId:     chainID,
		QueryId:     string(queryID),
		Result:      proof.Result,
		ProofOps:    proof.ProofOps,
		Height:      proof.Height,
		FromAddress: signer,
	}

	submitQueryRespMsg := NewCardanoMessage(msg, nil, nil).(CardanoMessage)
	submitQueryRespMsg.FeegrantDisabled = true
	return submitQueryRespMsg, nil
}

func (cc *CardanoProvider) MsgTimeoutOnClose(msgTransfer provider.PacketInfo, proof provider.PacketProof) (provider.RelayerMessage, error) {
	signer, err := cc.Address()
	if err != nil {
		return nil, err
	}
	assembled := &chantypes.MsgTimeoutOnClose{
		Packet:           msgTransfer.Packet(),
		ProofUnreceived:  proof.Proof,
		ProofHeight:      proof.ProofHeight,
		NextSequenceRecv: msgTransfer.Sequence,
		Signer:           signer,
	}

	return NewCardanoMessage(assembled, nil, func(signer string) {
		assembled.Signer = signer
	}), nil
}

// MsgTransfer creates a new transfer message
func (cc *CardanoProvider) MsgTransfer(
	dstAddr string,
	amount sdk.Coin,
	info provider.PacketInfo,
) (provider.RelayerMessage, error) {
	acc, err := cc.Address()
	if err != nil {
		return nil, err
	}
	msg := &transfertypes.MsgTransfer{
		SourcePort:       info.SourcePort,
		SourceChannel:    info.SourceChannel,
		Token:            amount,
		Sender:           acc,
		Receiver:         dstAddr,
		TimeoutTimestamp: info.TimeoutTimestamp,
	}

	// If the timeoutHeight is 0 then we don't need to explicitly set it on the MsgTransfer
	if info.TimeoutHeight.RevisionHeight != 0 {
		msg.TimeoutHeight = info.TimeoutHeight
	}

	msgTransfer := NewCardanoMessage(msg, nil, nil).(CardanoMessage)
	msgTransfer.FeegrantDisabled = true
	return msgTransfer, nil
}

func (cc *CardanoProvider) MsgUpdateClient(srcClientID string, dstHeader ibcexported.ClientMessage) (provider.RelayerMessage, error) {
	clientMsg, err := clienttypes.PackClientMessage(dstHeader)
	if err != nil {
		return nil, err
	}

	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
	if err != nil {
		return nil, err
	}

	msg := &clienttypes.MsgUpdateClient{
		ClientId:      srcClientID,
		ClientMessage: clientMsg,
		Signer:        signer,
	}

	res, err := cc.GateWay.UpdateClient(context.Background(), transformStdUpdateClientToGwUpdateClient(msg))
	if err != nil {
		return nil, err
	}
	return NewCardanoMessage(msg, res.UnsignedTx, func(signer string) {
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
	var (
		acc string
		err error
	)
	if acc, err = cc.Address(); err != nil {
		return nil, err
	}

	msgUpgradeClient := &clienttypes.MsgUpgradeClient{
		ClientId:                   srcClientId,
		ClientState:                clientRes.ClientState,
		ConsensusState:             consRes.ConsensusState,
		ProofUpgradeClient:         consRes.GetProof(),
		ProofUpgradeConsensusState: consRes.ConsensusState.Value,
		Signer:                     acc}

	return NewCardanoMessage(msgUpgradeClient, nil, func(signer string) {
		msgUpgradeClient.Signer = signer
	}), nil
}

// DefaultUpgradePath is the default IBC upgrade path set for an on-chain light client
var defaultUpgradePath = []string{"upgrade", "upgradedIBCState"}

// NewClientState creates a new tendermint client state tracking the dst chain.
func (cc *CardanoProvider) NewClientState(
	dstChainID string,
	dstUpdateHeader provider.IBCHeader,
	dstTrustingPeriod,
	dstUbdPeriod time.Duration,
	allowUpdateAfterExpiry,
	allowUpdateAfterMisbehaviour bool,
) (ibcexported.ClientState, error) {
	revisionNumber := clienttypes.ParseChainID(dstChainID)

	// Create the ClientState we want on 'c' tracking 'dst'
	return &tmclient.ClientState{
		ChainId:         dstChainID,
		TrustLevel:      tmclient.NewFractionFromTm(light.DefaultTrustLevel),
		TrustingPeriod:  dstTrustingPeriod,
		UnbondingPeriod: dstUbdPeriod,
		MaxClockDrift:   time.Minute * 10,
		FrozenHeight:    clienttypes.ZeroHeight(),
		LatestHeight: clienttypes.Height{
			RevisionNumber: revisionNumber,
			RevisionHeight: dstUpdateHeader.Height(),
		},
		ProofSpecs:                   commitmenttypes.GetSDKSpecs(),
		UpgradePath:                  defaultUpgradePath,
		AllowUpdateAfterExpiry:       allowUpdateAfterExpiry,
		AllowUpdateAfterMisbehaviour: allowUpdateAfterMisbehaviour,
	}, nil
}

// NextSeqRecv queries for the appropriate Tendermint proof required to prove the next expected packet sequence number
// for a given counterparty channel. This is used in ORDERED channels to ensure packets are being delivered in the
// exact same order as they were sent over the wire.
func (cc *CardanoProvider) NextSeqRecv(
	ctx context.Context,
	msgTransfer provider.PacketInfo,
	height uint64,
) (provider.PacketProof, error) {
	key := host.NextSequenceRecvKey(msgTransfer.DestPort, msgTransfer.DestChannel)
	_, proof, proofHeight, err := cc.QueryTendermintProof(ctx, int64(height), key)
	if err != nil {
		return provider.PacketProof{}, fmt.Errorf("error querying comet proof for next sequence receive: %w", err)
	}

	return provider.PacketProof{
		Proof:       proof,
		ProofHeight: proofHeight,
	}, nil
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
	key := host.PacketCommitmentKey(msgTransfer.SourcePort, msgTransfer.SourceChannel, msgTransfer.Sequence)
	commitment, proof, proofHeight, err := cc.QueryTendermintProof(ctx, int64(height), key)
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
	key := host.PacketReceiptKey(msgTransfer.DestPort, msgTransfer.DestChannel, msgTransfer.Sequence)
	_, proof, proofHeight, err := cc.QueryTendermintProof(ctx, int64(height), key)
	if err != nil {
		return provider.PacketProof{}, fmt.Errorf("error querying comet proof for packet receipt: %w", err)
	}

	return provider.PacketProof{
		Proof:       proof,
		ProofHeight: proofHeight,
	}, nil
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
	res, err := cc.RPCClient.BroadcastTxSync(ctx, tx)
	isErr := err != nil
	isFailed := res != nil && res.Code != 0
	if isErr || isFailed {
		if isErr && res == nil {
			// There are some cases where BroadcastTxSync will return an error but the associated
			// ResultBroadcastTx will be nil.
			return err
		}
		rlyResp := &provider.RelayerTxResponse{
			TxHash:    res.Hash.String(),
			Codespace: res.Codespace,
			Code:      res.Code,
			Data:      res.Data.String(),
		}
		if isFailed {
			err = cc.sdkError(res.Codespace, res.Code)
			if err == nil {
				err = fmt.Errorf("transaction failed to execute")
			}
		}
		cc.LogFailedTx(rlyResp, err, msgs)
		return err
	}
	address, err := cc.Address()
	if err != nil {
		cc.log.Error(
			"failed to get relayer bech32 wallet addresss",
			zap.Error(err),
		)
	}
	cc.UpdateFeesSpent(cc.ChainId(), cc.Key(), address, fees)

	// TODO: maybe we need to check if the node has tx indexing enabled?
	// if not, we need to find a new way to block until inclusion in a block

	go cc.waitForTx(asyncCtx, res.Hash, msgs, asyncTimeout, asyncCallbacks)

	return nil
}

// sdkError will return the Cosmos SDK registered error for a given codespace/code combo if registered, otherwise nil.
func (cc *CardanoProvider) sdkError(codespace string, code uint32) error {
	// ABCIError will return an error other than "unknown" if syncRes.Code is a registered error in syncRes.Codespace
	// This catches all of the sdk errors https://github.com/cosmos/cosmos-sdk/blob/f10f5e5974d2ecbf9efc05bc0bfe1c99fdeed4b6/types/errors/errors.go
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
	// Don't set the metrics in testing
	if cc.metrics == nil {
		return
	}

	cc.totalFeesMu.Lock()
	cc.TotalFees = cc.TotalFees.Add(fees...)
	cc.totalFeesMu.Unlock()

	for _, fee := range cc.TotalFees {
		// Convert to a big float to get a float64 for metrics
		f, _ := big.NewFloat(0.0).SetInt(fee.Amount.BigInt()).Float64()
		cc.metrics.SetFeesSpent(chain, cc.PCfg.GasPrices, key, address, fee.GetDenom(), f)
	}
}

// waitForTx waits for a transaction to be included in a block, logs success/fail, then invokes callback.
// This is intended to be called as an async goroutine.
func (cc *CardanoProvider) waitForTx(
	ctx context.Context,
	txHash []byte,
	msgs []provider.RelayerMessage, // used for logging only
	waitTimeout time.Duration,
	callbacks []func(*provider.RelayerTxResponse, error),
) {
	_, err := cc.waitForBlockInclusion(ctx, txHash, waitTimeout)
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

	rlyResp := &provider.RelayerTxResponse{}

	if len(callbacks) > 0 {
		for _, cb := range callbacks {
			//Call each callback in order since waitForTx is already invoked asyncronously
			cb(rlyResp, nil)
		}
	}

}

// waitForBlockInclusion will wait for a transaction to be included in a block, up to waitTimeout or context cancellation.
func (cc *CardanoProvider) waitForBlockInclusion(
	ctx context.Context,
	txHash []byte,
	waitTimeout time.Duration,
) (*sdk.TxResponse, error) {
	exitAfter := time.After(waitTimeout)
	for {
		select {
		case <-exitAfter:
			return nil, fmt.Errorf("timed out after: %d; %w", waitTimeout, ErrTimeoutAfterWaitingForTxBroadcast)
		// This fixed poll is fine because it's only for logging and updating prometheus metrics currently.
		case <-time.After(time.Millisecond * 100):
			return nil, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

// mkTxResult decodes a comet transaction into an SDK TxResponse.
func (cc *CardanoProvider) mkTxResult(resTx *coretypes.ResultTx) (*sdk.TxResponse, error) {
	txbz, err := cc.Cdc.TxConfig.TxDecoder()(resTx.Tx)
	if err != nil {
		return nil, err
	}
	p, ok := txbz.(intoAny)
	if !ok {
		return nil, fmt.Errorf("expecting a type implementing intoAny, got: %T", txbz)
	}
	any := p.AsAny()
	return sdk.NewResponseResultTx(resTx, any, ""), nil
}

// QueryIBCHeader returns the IBC compatible block header (TendermintIBCHeader) at a specific height.
func (cc *CardanoProvider) QueryIBCHeader(ctx context.Context, h int64) (provider.IBCHeader, error) {
	if h == 0 {
		return nil, fmt.Errorf("height cannot be 0")
	}

	lightBlock, err := cc.LightProvider.LightBlock(ctx, h)
	if err != nil {
		return nil, err
	}

	return provider.TendermintIBCHeader{
		SignedHeader: lightBlock.SignedHeader,
		ValidatorSet: lightBlock.ValidatorSet,
	}, nil
}

func (cc *CardanoProvider) QueryICQWithProof(ctx context.Context, path string, request []byte, height uint64) (provider.ICQProof, error) {
	slashSplit := strings.Split(path, "/")
	req := abci.RequestQuery{
		Path:   path,
		Height: int64(height),
		Data:   request,
		Prove:  slashSplit[len(slashSplit)-1] == "key",
	}

	res, err := cc.QueryABCI(ctx, req)
	if err != nil {
		return provider.ICQProof{}, fmt.Errorf("failed to execute interchain query: %w", err)
	}
	return provider.ICQProof{
		Result:   res.Value,
		ProofOps: res.ProofOps,
		Height:   res.Height,
	}, nil
}

// RelayPacketFromSequence relays a packet with a given seq on src and returns recvPacket msgs, timeoutPacketmsgs and error
func (cc *CardanoProvider) RelayPacketFromSequence(
	ctx context.Context,
	src provider.ChainProvider,
	srch, dsth, seq uint64,
	srcChanID, srcPortID string,
	order chantypes.Order,
) (provider.RelayerMessage, provider.RelayerMessage, error) {
	msgTransfer, err := src.QuerySendPacket(ctx, srcChanID, srcPortID, seq)
	if err != nil {
		return nil, nil, err
	}

	dstTime, err := cc.BlockTime(ctx, int64(dsth))
	if err != nil {
		return nil, nil, err
	}

	if err := cc.ValidatePacket(msgTransfer, provider.LatestBlock{
		Height: dsth,
		Time:   dstTime,
	}); err != nil {
		switch err.(type) {
		case *provider.TimeoutHeightError, *provider.TimeoutTimestampError, *provider.TimeoutOnCloseError:
			var pp provider.PacketProof
			switch order {
			case chantypes.UNORDERED:
				pp, err = cc.PacketReceipt(ctx, msgTransfer, dsth)
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
	for _, msg := range msgs {
		if msg == nil {
			continue
		}
		txData, err := msg.MsgBytes()
		if err != nil {
			return err
		}
		txHash, err := cc.TxCardano.SignAndSubmitTx(ctx, cc.ChainId(), txData)
		if err != nil {
			rlyResp := &provider.RelayerTxResponse{
				TxHash: txHash,
			}
			cc.LogFailedTx(rlyResp, err, msgs)
			return err
		}

		txResp := &sdk.TxResponse{
			TxHash: txHash,
		}

		cc.LogSuccessTx(txResp, []provider.RelayerMessage{msg})
	}

	go cc.waitForTx(asyncCtx, []byte{}, msgs, defaultBroadcastWaitTimeout, asyncCallbacks)

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
	done := cc.SetSDKContext()
	defer done()

	cMsgs := CosmosMsgs(msgs...)

	txf, err := cc.PrepareFactory(cc.TxFactory(), txSignerKey)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	if memo != "" {
		txf = txf.WithMemo(memo)
	}

	sequence = txf.Sequence()
	cc.updateNextAccountSequence(sequenceGuard, sequence)
	if sequence < sequenceGuard.NextAccountSequence {
		sequence = sequenceGuard.NextAccountSequence
		txf = txf.WithSequence(sequence)
	}

	adjusted := gas

	if gas == 0 {
		_, adjusted, err = cc.CalculateGas(ctx, txf, txSignerKey, cMsgs...)

		if err != nil {
			return nil, 0, sdk.Coins{}, err
		}
	}

	//Cannot feegrant your own TX
	if txSignerKey != feegranterKey && feegranterKey != "" {
		granterAddr, err := cc.GetKeyAddressForKey(feegranterKey)
		if err != nil {
			return nil, 0, sdk.Coins{}, err
		}

		txf = txf.WithFeeGranter(granterAddr)
	}

	// Set the gas amount on the transaction factory
	txf = txf.WithGas(adjusted)

	// Build the transaction builder
	txb, err := txf.BuildUnsignedTx(cMsgs...)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	if err = tx.Sign(txf, txSignerKey, txb, false); err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	tx := txb.GetTx()
	fees = tx.GetFee()

	// Generate the transaction bytes
	txBytes, err = cc.Cdc.TxConfig.TxEncoder()(tx)
	if err != nil {
		return nil, 0, sdk.Coins{}, err
	}

	return txBytes, txf.Sequence(), fees, nil
}

// handleAccountSequenceMismatchError will parse the error string, e.g.:
// "account sequence mismatch, expected 10, got 9: incorrect account sequence"
// and update the next account sequence with the expected value.
func (cc *CardanoProvider) handleAccountSequenceMismatchError(sequenceGuard *WalletState, err error) {
	if sequenceGuard == nil {
		panic("sequence guard not configured")
	}

	matches := accountSeqRegex.FindStringSubmatch(err.Error())
	if len(matches) == 0 {
		return
	}
	nextSeq, err := strconv.ParseUint(matches[1], 10, 64)
	if err != nil {
		return
	}
	sequenceGuard.NextAccountSequence = nextSeq
}

// PrepareFactory mutates the tx factory with the appropriate account number, sequence number, and min gas settings.
func (cc *CardanoProvider) PrepareFactory(txf tx.Factory, signingKey string) (tx.Factory, error) {
	var (
		err      error
		from     sdk.AccAddress
		num, seq uint64
	)

	// Get key address and retry if fail
	if err = retry.Do(func() error {
		from, err = cc.GetKeyAddressForKey(signingKey)
		if err != nil {
			return err
		}
		return err
	}, rtyAtt, rtyDel, rtyErr); err != nil {
		return tx.Factory{}, err
	}

	cliCtx := client.Context{}.WithClient(cc.RPCClient).
		WithInterfaceRegistry(cc.Cdc.InterfaceRegistry).
		WithChainID(cc.PCfg.ChainID).
		WithCodec(cc.Cdc.Marshaler).
		WithFromAddress(from)

	// Set the account number and sequence on the transaction factory and retry if fail
	if err = retry.Do(func() error {
		if err = txf.AccountRetriever().EnsureExists(cliCtx, from); err != nil {
			return err
		}
		return err
	}, rtyAtt, rtyDel, rtyErr); err != nil {
		return txf, err
	}

	// TODO: why this code? this may potentially require another query when we don't want one
	initNum, initSeq := txf.AccountNumber(), txf.Sequence()
	if initNum == 0 || initSeq == 0 {
		if err = retry.Do(func() error {
			num, seq, err = txf.AccountRetriever().GetAccountNumberSequence(cliCtx, from)
			if err != nil {
				return err
			}
			return err
		}, rtyAtt, rtyDel, rtyErr); err != nil {
			return txf, err
		}

		if initNum == 0 {
			txf = txf.WithAccountNumber(num)
		}

		if initSeq == 0 {
			txf = txf.WithSequence(seq)
		}
	}

	if cc.PCfg.MinGasAmount != 0 {
		txf = txf.WithGas(cc.PCfg.MinGasAmount)
	}

	if cc.PCfg.MaxGasAmount != 0 {
		txf = txf.WithGas(cc.PCfg.MaxGasAmount)
	}
	txf, err = cc.SetWithExtensionOptions(txf)
	if err != nil {
		return tx.Factory{}, err
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
	extOpts := make([]*types.Any, 0, len(cc.PCfg.ExtensionOptions))
	for _, opt := range cc.PCfg.ExtensionOptions {
		max, ok := sdk.NewIntFromString(opt.Value)
		if !ok {
			return txf, fmt.Errorf("invalid opt value")
		}
		extensionOption := ethermint.ExtensionOptionDynamicFeeTx{
			MaxPriorityPrice: max,
		}
		extBytes, err := extensionOption.Marshal()
		if err != nil {
			return txf, err
		}
		extOpts = append(extOpts, &types.Any{
			TypeUrl: "/ethermint.types.v1.ExtensionOptionDynamicFeeTx",
			Value:   extBytes,
		})
	}
	return txf.WithExtensionOptions(extOpts...), nil
}

// TxFactory instantiates a new tx factory with the appropriate configuration settings for this chain.
func (cc *CardanoProvider) TxFactory() tx.Factory {
	return tx.Factory{}.
		WithAccountRetriever(cc).
		WithChainID(cc.PCfg.ChainID).
		WithTxConfig(cc.Cdc.TxConfig).
		WithGasAdjustment(cc.PCfg.GasAdjustment).
		WithGasPrices(cc.PCfg.GasPrices).
		WithKeybase(cc.Keybase).
		WithSignMode(cc.PCfg.SignMode())
}

// CalculateGas simulates a tx to generate the appropriate gas settings before broadcasting a tx.
func (cc *CardanoProvider) CalculateGas(ctx context.Context, txf tx.Factory, signingKey string, msgs ...sdk.Msg) (txtypes.SimulateResponse, uint64, error) {
	keyInfo, err := cc.Keybase.Key(signingKey)
	if err != nil {
		return txtypes.SimulateResponse{}, 0, err
	}

	var txBytes []byte
	if err := retry.Do(func() error {
		var err error
		txBytes, err = BuildSimTx(keyInfo, txf, msgs...)
		if err != nil {
			return err
		}
		return nil
	}, retry.Context(ctx), rtyAtt, rtyDel, rtyErr); err != nil {
		return txtypes.SimulateResponse{}, 0, err
	}

	simQuery := abci.RequestQuery{
		Path: "/cosmos.tx.v1beta1.Service/Simulate",
		Data: txBytes,
	}

	var res abci.ResponseQuery
	if err := retry.Do(func() error {
		var err error
		res, err = cc.QueryABCI(ctx, simQuery)
		if err != nil {
			return err
		}
		return nil
	}, retry.Context(ctx), rtyAtt, rtyDel, rtyErr); err != nil {
		return txtypes.SimulateResponse{}, 0, err
	}

	var simRes txtypes.SimulateResponse
	if err := simRes.Unmarshal(res.Value); err != nil {
		return txtypes.SimulateResponse{}, 0, err
	}
	gas, err := cc.AdjustEstimatedGas(simRes.GasInfo.GasUsed)
	return simRes, gas, err
}

// BuildSimTx creates an unsigned tx with an empty single signature and returns
// the encoded transaction or an error if the unsigned transaction cannot be built.
func BuildSimTx(info *keyring.Record, txf tx.Factory, msgs ...sdk.Msg) ([]byte, error) {
	txb, err := txf.BuildUnsignedTx(msgs...)
	if err != nil {
		return nil, err
	}

	var pk cryptotypes.PubKey = &secp256k1.PubKey{} // use default public key type

	pk, err = info.GetPubKey()
	if err != nil {
		return nil, err
	}

	// Create an empty signature literal as the ante handler will populate with a
	// sentinel pubkey.
	sig := signing.SignatureV2{
		PubKey: pk,
		Data: &signing.SingleSignatureData{
			SignMode: txf.SignMode(),
		},
		Sequence: txf.Sequence(),
	}
	if err := txb.SetSignatures(sig); err != nil {
		return nil, err
	}

	protoProvider, ok := txb.(protoTxProvider)
	if !ok {
		return nil, fmt.Errorf("cannot simulate amino tx")
	}

	simReq := txtypes.SimulateRequest{Tx: protoProvider.GetProtoTx()}
	return simReq.Marshal()
}

// SignMode returns the SDK sign mode type reflective of the specified sign mode in the config file.
func (pc *CardanoProviderConfig) SignMode() signing.SignMode {
	signMode := signing.SignMode_SIGN_MODE_UNSPECIFIED
	switch pc.SignModeStr {
	case "direct":
		signMode = signing.SignMode_SIGN_MODE_DIRECT
	case "amino-json":
		signMode = signing.SignMode_SIGN_MODE_LEGACY_AMINO_JSON
	}
	return signMode
}

// AdjustEstimatedGas adjusts the estimated gas usage by multiplying it by the gas adjustment factor
// and return estimated gas is higher than max gas error. If the gas usage is zero, the adjusted gas
// is also zero.
func (cc *CardanoProvider) AdjustEstimatedGas(gasUsed uint64) (uint64, error) {
	if gasUsed == 0 {
		return gasUsed, nil
	}
	if cc.PCfg.MaxGasAmount > 0 && gasUsed > cc.PCfg.MaxGasAmount {
		return 0, fmt.Errorf("estimated gas %d is higher than max gas %d", gasUsed, cc.PCfg.MaxGasAmount)
	}
	gas := cc.PCfg.GasAdjustment * float64(gasUsed)
	if math.IsInf(gas, 1) {
		return 0, fmt.Errorf("infinite gas used")
	}
	return uint64(gas), nil
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

	return NewCardanoMessage(assembled, nil, func(signer string) {
		assembled.Signer = signer
	}), nil
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
	anyClientState, err := PackClientState(clientState)
	if err != nil {
		return nil, "", err
	}

	anyConsensusState, err := PackConsensusState(consensusState)
	if err != nil {
		return nil, "", err
	}

	signer, err := cc.TxCardano.ShowAddress(context.Background(), cc.Key(), cc.ChainId())
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
	tx_id, err := cc.TxCardano.SignAndSubmitTx(context.Background(), cc.ChainId(), res.UnsignedTx.GetValue())
	if err != nil {
		return nil, "", err
	}

	return NewCardanoMessage(msg, nil, func(signer string) {
		msg.Signer = tx_id
	}), res.ClientId, nil
}

func (cc *CardanoProvider) MsgCreateCardanoClient(clientState *pbclientstruct.ClientState, consensusState *pbclientstruct.ConsensusState) (provider.RelayerMessage, error) {
	//TODO implement me
	panic("implement me")
}
