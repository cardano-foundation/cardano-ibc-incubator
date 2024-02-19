package cardano

import (
	"context"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	tendermint "git02.smartosc.com/cardano/ibc-sidechain/relayer/proto/cardano/gateway/github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/chains/cosmos/module"

	pbclientstruct "git02.smartosc.com/cardano/ibc-sidechain/relayer/proto/cardano/gateway/sidechain/x/clients/cardano"
	"git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/chains"
	"git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/provider"
	abci "github.com/cometbft/cometbft/abci/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	tmtypes "github.com/cometbft/cometbft/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	querytypes "github.com/cosmos/cosmos-sdk/types/query"
	bankTypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	"github.com/cosmos/cosmos-sdk/x/params/types/proposal"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	upgradetypes "github.com/cosmos/cosmos-sdk/x/upgrade/types"
	transfertypes "github.com/cosmos/ibc-go/v7/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	host "github.com/cosmos/ibc-go/v7/modules/core/24-host"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

const PaginationDelay = 10 * time.Millisecond

// queryIBCMessages returns an array of IBC messages given a tag
func (cc *CardanoProvider) queryIBCMessages(ctx context.Context, log *zap.Logger, page, limit int, query string, base64Encoded bool) ([]chains.IbcMessage, error) {
	var ibcMsgs []chains.IbcMessage
	return ibcMsgs, nil
}

// QueryChannel returns the channel associated with a channelID
func (cc *CardanoProvider) QueryChannel(ctx context.Context, height int64, channelid, portid string) (chanRes *chantypes.QueryChannelResponse, err error) {
	res, err := cc.queryChannelABCI(ctx, height, portid, channelid)
	if err != nil && strings.Contains(err.Error(), "not found") {
		return &chantypes.QueryChannelResponse{
			Channel: &chantypes.Channel{
				State:    chantypes.UNINITIALIZED,
				Ordering: chantypes.UNORDERED,
				Counterparty: chantypes.Counterparty{
					PortId:    "port",
					ChannelId: "channel",
				},
				ConnectionHops: []string{},
				Version:        "version",
			},
			Proof: []byte{},
			ProofHeight: clienttypes.Height{
				RevisionNumber: 0,
				RevisionHeight: 0,
			},
		}, nil
	} else if err != nil {
		return nil, err
	}
	return res, nil
}

func (cc *CardanoProvider) queryChannelABCI(ctx context.Context, height int64, portID, channelID string) (*chantypes.QueryChannelResponse, error) {
	key := host.ChannelKey(portID, channelID)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if channel exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrapf(chantypes.ErrChannelNotFound, "portID (%s), channelID (%s)", portID, channelID)
	}

	cdc := codec.NewProtoCodec(cc.Cdc.InterfaceRegistry)

	var channel chantypes.Channel
	if err := cdc.Unmarshal(value, &channel); err != nil {
		return nil, err
	}

	return &chantypes.QueryChannelResponse{
		Channel:     &channel,
		Proof:       proofBz,
		ProofHeight: proofHeight,
	}, nil
}

// QueryTendermintProof performs an ABCI query with the given key and returns
// the value of the query, the proto encoded merkle proof, and the height of
// the Tendermint block containing the state root. The desired tendermint height
// to perform the query should be set in the client context. The query will be
// performed at one below this height (at the IAVL version) in order to obtain
// the correct merkle proof. Proof queries at height less than or equal to 2 are
// not supported. Queries with a client context height of 0 will perform a query
// at the latest state available.
// Issue: https://github.com/cosmos/cosmos-sdk/issues/6567
func (cc *CardanoProvider) QueryTendermintProof(ctx context.Context, height int64, key []byte) ([]byte, []byte, clienttypes.Height, error) {
	// ABCI queries at heights 1, 2 or less than or equal to 0 are not supported.
	// Base app does not support queries for height less than or equal to 1.
	// Therefore, a query at height 2 would be equivalent to a query at height 3.
	// A height of 0 will query with the lastest state.
	if height != 0 && height <= 2 {
		return nil, nil, clienttypes.Height{}, fmt.Errorf("proof queries at height <= 2 are not supported")
	}

	// Use the IAVL height if a valid tendermint height is passed in.
	// A height of 0 will query with the latest state.
	if height != 0 {
		height--
	}

	req := abci.RequestQuery{
		Path:   fmt.Sprintf("store/%s/key", ibcexported.StoreKey),
		Height: height,
		Data:   key,
		Prove:  true,
	}

	res, err := cc.QueryABCI(ctx, req)
	if err != nil {
		return nil, nil, clienttypes.Height{}, err
	}

	merkleProof, err := commitmenttypes.ConvertProofs(res.ProofOps)
	if err != nil {
		return nil, nil, clienttypes.Height{}, err
	}

	cdc := codec.NewProtoCodec(cc.Cdc.InterfaceRegistry)

	proofBz, err := cdc.Marshal(&merkleProof)
	if err != nil {
		return nil, nil, clienttypes.Height{}, err
	}

	revision := clienttypes.ParseChainID(cc.PCfg.ChainID)
	return res.Value, proofBz, clienttypes.NewHeight(revision, uint64(res.Height)+1), nil
}

// GenerateConnHandshakeProof generates all the proofs needed to prove the existence of the
// connection state on this chain. A counterparty should use these generated proofs.
func (cc *CardanoProvider) GenerateConnHandshakeProof(ctx context.Context, height int64, clientId, connId string) (clientState ibcexported.ClientState, clientStateProof []byte, consensusProof []byte, connectionProof []byte, connectionProofHeight ibcexported.Height, err error) {
	var (
		clientStateRes     *clienttypes.QueryClientStateResponse
		consensusStateRes  *clienttypes.QueryConsensusStateResponse
		connectionStateRes *conntypes.QueryConnectionResponse
		eg                 = new(errgroup.Group)
	)

	// query for the client state for the proof and get the height to query the consensus state at.
	clientStateRes, err = cc.QueryClientStateResponse(ctx, height, clientId)
	if err != nil {
		return nil, nil, nil, nil, clienttypes.Height{}, err
	}

	clientState, err = clienttypes.UnpackClientState(clientStateRes.ClientState)
	if err != nil {
		return nil, nil, nil, nil, clienttypes.Height{}, err
	}

	eg.Go(func() error {
		var err error
		consensusStateRes, err = cc.QueryClientConsensusState(ctx, height, clientId, clientState.GetLatestHeight())
		return err
	})
	eg.Go(func() error {
		var err error
		connectionStateRes, err = cc.QueryConnection(ctx, height, connId)
		return err
	})

	if err := eg.Wait(); err != nil {
		return nil, nil, nil, nil, clienttypes.Height{}, err
	}

	return clientState, clientStateRes.Proof, consensusStateRes.Proof, connectionStateRes.Proof, connectionStateRes.ProofHeight, nil
}

// QueryClientStateResponse retrieves the latest consensus state for a client in state at a given height
func (cc *CardanoProvider) QueryClientStateResponse(ctx context.Context, height int64, srcClientId string) (*clienttypes.QueryClientStateResponse, error) {
	key := host.FullClientStateKey(srcClientId)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if client exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrap(clienttypes.ErrClientNotFound, srcClientId)
	}

	cdc := codec.NewProtoCodec(cc.Cdc.InterfaceRegistry)

	clientState, err := clienttypes.UnmarshalClientState(cdc, value)
	if err != nil {
		return nil, err
	}

	anyClientState, err := clienttypes.PackClientState(clientState)
	if err != nil {
		return nil, err
	}

	return &clienttypes.QueryClientStateResponse{
		ClientState: anyClientState,
		Proof:       proofBz,
		ProofHeight: proofHeight,
	}, nil
}

// QueryClientConsensusState retrieves the latest consensus state for a client in state at a given height
func (cc *CardanoProvider) QueryClientConsensusState(ctx context.Context, chainHeight int64, clientid string, clientHeight ibcexported.Height) (*clienttypes.QueryConsensusStateResponse, error) {
	key := host.FullConsensusStateKey(clientid, clientHeight)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, chainHeight, key)
	if err != nil {
		return nil, err
	}

	// check if consensus state exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrap(clienttypes.ErrConsensusStateNotFound, clientid)
	}

	cdc := codec.NewProtoCodec(cc.Cdc.InterfaceRegistry)

	cs, err := clienttypes.UnmarshalConsensusState(cdc, value)
	if err != nil {
		return nil, err
	}

	anyConsensusState, err := clienttypes.PackConsensusState(cs)
	if err != nil {
		return nil, err
	}

	return &clienttypes.QueryConsensusStateResponse{
		ConsensusState: anyConsensusState,
		Proof:          proofBz,
		ProofHeight:    proofHeight,
	}, nil
}

// QueryConnection returns the remote end of a given connection
func (cc *CardanoProvider) QueryConnection(ctx context.Context, height int64, connectionid string) (*conntypes.QueryConnectionResponse, error) {
	res, err := cc.queryConnectionABCI(ctx, height, connectionid)
	if err != nil && strings.Contains(err.Error(), "not found") {
		return &conntypes.QueryConnectionResponse{
			Connection: &conntypes.ConnectionEnd{
				ClientId: "client",
				Versions: []*conntypes.Version{},
				State:    conntypes.UNINITIALIZED,
				Counterparty: conntypes.Counterparty{
					ClientId:     "client",
					ConnectionId: "connection",
					Prefix:       commitmenttypes.MerklePrefix{KeyPrefix: []byte{}},
				},
				DelayPeriod: 0,
			},
			Proof:       []byte{},
			ProofHeight: clienttypes.Height{RevisionNumber: 0, RevisionHeight: 0},
		}, nil
	} else if err != nil {
		return nil, err
	}
	return res, nil
}

func (cc *CardanoProvider) queryConnectionABCI(ctx context.Context, height int64, connectionID string) (*conntypes.QueryConnectionResponse, error) {
	key := host.ConnectionKey(connectionID)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if connection exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrap(conntypes.ErrConnectionNotFound, connectionID)
	}

	cdc := codec.NewProtoCodec(cc.Cdc.InterfaceRegistry)

	var connection conntypes.ConnectionEnd
	if err := cdc.Unmarshal(value, &connection); err != nil {
		return nil, err
	}

	return &conntypes.QueryConnectionResponse{
		Connection:  &connection,
		Proof:       proofBz,
		ProofHeight: proofHeight,
	}, nil
}

// QueryBalance returns the amount of coins in the relayer account
func (cc *CardanoProvider) QueryBalance(ctx context.Context, keyName string) (sdk.Coins, error) {
	addr, err := cc.ShowAddress(keyName)
	if err != nil {
		return nil, err
	}

	return cc.QueryBalanceWithAddress(ctx, addr)
}

// QueryBalanceWithAddress returns the amount of coins in the relayer account with address as input
func (cc *CardanoProvider) QueryBalanceWithAddress(ctx context.Context, address string) (sdk.Coins, error) {
	qc := bankTypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	coins := sdk.Coins{}

	for {
		res, err := qc.AllBalances(ctx, &bankTypes.QueryAllBalancesRequest{
			Address:    address,
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		coins = append(coins, res.Balances...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return coins, nil
}

func DefaultPageRequest() *querytypes.PageRequest {
	return &querytypes.PageRequest{
		Key:        []byte(""),
		Offset:     0,
		Limit:      1000,
		CountTotal: true,
	}
}

// QueryChannelClient returns the client state of the client supporting a given channel
func (cc *CardanoProvider) QueryChannelClient(ctx context.Context, height int64, channelid, portid string) (*clienttypes.IdentifiedClientState, error) {
	qc := chantypes.NewQueryClient(cc)
	cState, err := qc.ChannelClientState(ctx, &chantypes.QueryChannelClientStateRequest{
		PortId:    portid,
		ChannelId: channelid,
	})
	if err != nil {
		return nil, err
	}
	return cState.IdentifiedClientState, nil
}

// QueryChannels returns all the channels that are registered on a chain
func (cc *CardanoProvider) QueryChannels(ctx context.Context) ([]*chantypes.IdentifiedChannel, error) {
	qc := chantypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	chans := []*chantypes.IdentifiedChannel{}

	for {
		res, err := qc.Channels(ctx, &chantypes.QueryChannelsRequest{
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		chans = append(chans, res.Channels...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return chans, nil
}

// QueryClientState retrieves the latest consensus state for a client in state at a given height
// and unpacks it to exported client state interface
func (cc *CardanoProvider) QueryClientState(ctx context.Context, height int64, clientid string) (ibcexported.ClientState, error) {
	clientStateRes, err := cc.GateWay.QueryClientState(uint64(height))
	if err != nil {
		return nil, err
	}
	var clientState = tendermint.ClientState{}
	err = clientStateRes.GetClientState().UnmarshalTo(&clientState)
	if err != nil {
		return nil, err
	}
	clientStateExported := &tmclient.ClientState{
		ChainId: clientState.ChainId,
		TrustLevel: tmclient.Fraction{
			Numerator:   clientState.TrustLevel.Numerator,
			Denominator: clientState.TrustLevel.Denominator,
		},
		TrustingPeriod:  clientState.TrustingPeriod.AsDuration(),
		UnbondingPeriod: clientState.UnbondingPeriod.AsDuration(),
		MaxClockDrift:   clientState.MaxClockDrift.AsDuration(),
		FrozenHeight: clienttypes.Height{
			RevisionNumber: clientState.FrozenHeight.RevisionNumber,
			RevisionHeight: clientState.FrozenHeight.RevisionHeight,
		},
		LatestHeight: clienttypes.Height{
			RevisionNumber: clientState.LatestHeight.RevisionNumber,
			RevisionHeight: clientState.LatestHeight.RevisionHeight,
		},
		ProofSpecs:                   clientState.ProofSpecs,
		UpgradePath:                  clientState.UpgradePath,
		AllowUpdateAfterExpiry:       clientState.AllowUpdateAfterExpiry,
		AllowUpdateAfterMisbehaviour: clientState.AllowUpdateAfterMisbehaviour,
	}
	return clientStateExported, nil
}

// QueryUnbondingPeriod returns the unbonding period of the chain
func (cc *CardanoProvider) QueryUnbondingPeriod(ctx context.Context) (time.Duration, error) {

	// Attempt ICS query
	consumerUnbondingPeriod, consumerErr := cc.queryParamsSubspaceTime(ctx, "ccvconsumer", "UnbondingPeriod")
	if consumerErr == nil {
		return consumerUnbondingPeriod, nil
	}

	//Attempt Staking query.
	unbondingPeriod, stakingParamsErr := cc.queryParamsSubspaceTime(ctx, "staking", "UnbondingTime")
	if stakingParamsErr == nil {
		return unbondingPeriod, nil
	}

	// Fallback
	req := stakingtypes.QueryParamsRequest{}
	queryClient := stakingtypes.NewQueryClient(cc)
	res, err := queryClient.Params(ctx, &req)
	if err == nil {
		return res.Params.UnbondingTime, nil

	}

	return 0,
		fmt.Errorf("failed to query unbonding period from ccvconsumer, staking & fallback : %w: %s : %s", consumerErr, stakingParamsErr.Error(), err.Error())
}

func (cc *CardanoProvider) queryParamsSubspaceTime(ctx context.Context, subspace string, key string) (time.Duration, error) {
	queryClient := proposal.NewQueryClient(cc)

	params := proposal.QueryParamsRequest{Subspace: subspace, Key: key}

	res, err := queryClient.Params(ctx, &params)

	if err != nil {
		return 0, fmt.Errorf("failed to make %s params request: %w", subspace, err)
	}

	if res.Param.Value == "" {
		return 0, fmt.Errorf("%s %s is empty", subspace, key)
	}

	unbondingValue, err := strconv.ParseUint(strings.ReplaceAll(res.Param.Value, `"`, ""), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse %s from %s param: %w", key, subspace, err)
	}

	return time.Duration(unbondingValue), nil
}

// Query current node status
func (cc *CardanoProvider) QueryStatus(ctx context.Context) (*coretypes.ResultStatus, error) {
	status, err := cc.RPCClient.Status(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to query node status: %w", err)
	}
	return status, nil
}

// QueryClients queries all the clients!
func (cc *CardanoProvider) QueryClients(ctx context.Context) (clienttypes.IdentifiedClientStates, error) {
	qc := clienttypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	clients := clienttypes.IdentifiedClientStates{}

	for {
		res, err := qc.ClientStates(ctx, &clienttypes.QueryClientStatesRequest{
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		clients = append(clients, res.ClientStates...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return clients, nil
}

// QueryConnectionChannels queries the channels associated with a connection
func (cc *CardanoProvider) QueryConnectionChannels(ctx context.Context, height int64, connectionid string) ([]*chantypes.IdentifiedChannel, error) {
	qc := chantypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	channels := []*chantypes.IdentifiedChannel{}

	for {
		res, err := qc.ConnectionChannels(ctx, &chantypes.QueryConnectionChannelsRequest{
			Connection: connectionid,
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		channels = append(channels, res.Channels...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return channels, nil
}

// QueryConnections gets any connections on a chain
func (cc *CardanoProvider) QueryConnections(ctx context.Context) ([]*conntypes.IdentifiedConnection, error) {
	qc := conntypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	conns := []*conntypes.IdentifiedConnection{}

	for {
		res, err := qc.Connections(ctx, &conntypes.QueryConnectionsRequest{
			Pagination: p,
		})
		if err != nil || res == nil {
			return nil, err
		}

		conns = append(conns, res.Connections...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return conns, nil
}

// QueryConnectionsUsingClient gets any connections that exist between chain and counterparty
func (cc *CardanoProvider) QueryConnectionsUsingClient(ctx context.Context, height int64, clientid string) (*conntypes.QueryConnectionsResponse, error) {
	qc := conntypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	connections := &conntypes.QueryConnectionsResponse{}

	for {
		res, err := qc.Connections(ctx, &conntypes.QueryConnectionsRequest{
			Pagination: p,
		})
		if err != nil || res == nil {
			return nil, err
		}

		for _, conn := range res.Connections {
			if conn.ClientId == clientid {
				connections.Connections = append(connections.Connections, conn)
			}
		}

		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return connections, nil
}

// QueryConsensusState returns a consensus state for a given chain to be used as a
// client in another chain, fetches latest height when passed 0 as arg
func (cc *CardanoProvider) QueryConsensusState(ctx context.Context, height int64) (ibcexported.ConsensusState, int64, error) {
	commit, err := cc.RPCClient.Commit(ctx, &height)
	if err != nil {
		return &tmclient.ConsensusState{}, 0, err
	}

	page := 1
	count := 10_000

	nextHeight := height + 1
	nextVals, err := cc.RPCClient.Validators(ctx, &nextHeight, &page, &count)
	if err != nil {
		return &tmclient.ConsensusState{}, 0, err
	}

	state := &tmclient.ConsensusState{
		Timestamp:          commit.Time,
		Root:               commitmenttypes.NewMerkleRoot(commit.AppHash),
		NextValidatorsHash: tmtypes.NewValidatorSet(nextVals.Validators).Hash(),
	}

	return state, height, nil
}

// QueryDenomTrace takes a denom from IBC and queries the information about it
func (cc *CardanoProvider) QueryDenomTrace(ctx context.Context, denom string) (*transfertypes.DenomTrace, error) {
	transfers, err := transfertypes.NewQueryClient(cc).DenomTrace(ctx,
		&transfertypes.QueryDenomTraceRequest{
			Hash: denom,
		})
	if err != nil {
		return nil, err
	}
	return transfers.DenomTrace, nil
}

// QueryDenomTraces returns all the denom traces from a given chain
func (cc *CardanoProvider) QueryDenomTraces(ctx context.Context, offset, limit uint64, height int64) ([]transfertypes.DenomTrace, error) {
	qc := transfertypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	transfers := []transfertypes.DenomTrace{}
	for {
		res, err := qc.DenomTraces(ctx,
			&transfertypes.QueryDenomTracesRequest{
				Pagination: p,
			})

		if err != nil || res == nil {
			return nil, err
		}

		transfers = append(transfers, res.DenomTraces...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return transfers, nil
}

func (cc *CardanoProvider) QueryLatestHeight(ctx context.Context) (int64, error) {
	height, err := cc.GateWay.GetLastHeight()

	if err != nil {
		return -1, err
	}
	//} else if stat.SyncInfo.CatchingUp {
	//	return -1, fmt.Errorf("node at %s running chain %s not caught up", cc.PCfg.RPCAddr, cc.PCfg.ChainID)
	//}
	return int64(height), nil
}

// QueryNextSeqAck returns the next seqAck for a configured channel
func (cc *CardanoProvider) QueryNextSeqAck(ctx context.Context, height int64, channelid, portid string) (recvRes *chantypes.QueryNextSequenceReceiveResponse, err error) {
	key := host.NextSequenceAckKey(portid, channelid)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if next sequence receive exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrapf(chantypes.ErrChannelNotFound, "portID (%s), channelID (%s)", portid, channelid)
	}

	sequence := binary.BigEndian.Uint64(value)

	return &chantypes.QueryNextSequenceReceiveResponse{
		NextSequenceReceive: sequence,
		Proof:               proofBz,
		ProofHeight:         proofHeight,
	}, nil
}

// QueryNextSeqRecv returns the next seqRecv for a configured channel
func (cc *CardanoProvider) QueryNextSeqRecv(ctx context.Context, height int64, channelid, portid string) (recvRes *chantypes.QueryNextSequenceReceiveResponse, err error) {
	key := host.NextSequenceRecvKey(portid, channelid)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if next sequence receive exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrapf(chantypes.ErrChannelNotFound, "portID (%s), channelID (%s)", portid, channelid)
	}

	sequence := binary.BigEndian.Uint64(value)

	return &chantypes.QueryNextSequenceReceiveResponse{
		NextSequenceReceive: sequence,
		Proof:               proofBz,
		ProofHeight:         proofHeight,
	}, nil
}

// QueryPacketAcknowledgement returns the packet ack proof at a given height
func (cc *CardanoProvider) QueryPacketAcknowledgement(ctx context.Context, height int64, channelid, portid string, seq uint64) (ackRes *chantypes.QueryPacketAcknowledgementResponse, err error) {
	key := host.PacketAcknowledgementKey(portid, channelid, seq)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	if len(value) == 0 {
		return nil, sdkerrors.Wrapf(chantypes.ErrInvalidAcknowledgement, "portID (%s), channelID (%s), sequence (%d)", portid, channelid, seq)
	}

	return &chantypes.QueryPacketAcknowledgementResponse{
		Acknowledgement: value,
		Proof:           proofBz,
		ProofHeight:     proofHeight,
	}, nil
}

// QueryPacketAcknowledgements returns an array of packet acks
func (cc *CardanoProvider) QueryPacketAcknowledgements(ctx context.Context, height uint64, channelid, portid string) ([]*chantypes.PacketState, error) {
	qc := chantypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	acknowledgements := []*chantypes.PacketState{}
	for {
		res, err := qc.PacketAcknowledgements(ctx, &chantypes.QueryPacketAcknowledgementsRequest{
			PortId:     portid,
			ChannelId:  channelid,
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		acknowledgements = append(acknowledgements, res.Acknowledgements...)
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}

	return acknowledgements, nil
}

// QueryPacketCommitment returns the packet commitment proof at a given height
func (cc *CardanoProvider) QueryPacketCommitment(ctx context.Context, height int64, channelid, portid string, seq uint64) (comRes *chantypes.QueryPacketCommitmentResponse, err error) {
	key := host.PacketCommitmentKey(portid, channelid, seq)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	// check if packet commitment exists
	if len(value) == 0 {
		return nil, sdkerrors.Wrapf(chantypes.ErrPacketCommitmentNotFound, "portID (%s), channelID (%s), sequence (%d)", portid, channelid, seq)
	}

	return &chantypes.QueryPacketCommitmentResponse{
		Commitment:  value,
		Proof:       proofBz,
		ProofHeight: proofHeight,
	}, nil
}

// QueryPacketCommitments returns an array of packet commitments
func (cc *CardanoProvider) QueryPacketCommitments(ctx context.Context, height uint64, channelid, portid string) (*chantypes.QueryPacketCommitmentsResponse, error) {
	qc := chantypes.NewQueryClient(cc)
	p := DefaultPageRequest()
	commitments := &chantypes.QueryPacketCommitmentsResponse{}

	for {
		res, err := qc.PacketCommitments(ctx, &chantypes.QueryPacketCommitmentsRequest{
			PortId:     portid,
			ChannelId:  channelid,
			Pagination: p,
		})
		if err != nil {
			return nil, err
		}

		commitments.Commitments = append(commitments.Commitments, res.Commitments...)
		commitments.Height = res.Height
		next := res.GetPagination().GetNextKey()
		if len(next) == 0 {
			break
		}

		time.Sleep(PaginationDelay)
		p.Key = next
	}
	return commitments, nil
}

// QueryPacketReceipt returns the packet receipt proof at a given height
func (cc *CardanoProvider) QueryPacketReceipt(ctx context.Context, height int64, channelid, portid string, seq uint64) (recRes *chantypes.QueryPacketReceiptResponse, err error) {
	key := host.PacketReceiptKey(portid, channelid, seq)

	value, proofBz, proofHeight, err := cc.QueryTendermintProof(ctx, height, key)
	if err != nil {
		return nil, err
	}

	return &chantypes.QueryPacketReceiptResponse{
		Received:    value != nil,
		Proof:       proofBz,
		ProofHeight: proofHeight,
	}, nil
}

func (cc *CardanoProvider) QueryRecvPacket(
	ctx context.Context,
	dstChanID,
	dstPortID string,
	sequence uint64,
) (provider.PacketInfo, error) {
	status, err := cc.QueryStatus(ctx)
	if err != nil {
		return provider.PacketInfo{}, err
	}

	q := writeAcknowledgementQuery(dstChanID, dstPortID, sequence)
	ibcMsgs, err := cc.queryIBCMessages(ctx, cc.log, 1, 1000, q, cc.legacyEncodedEvents(zap.NewNop(), status.NodeInfo.Version))
	if err != nil {
		return provider.PacketInfo{}, err
	}
	for _, msg := range ibcMsgs {
		if msg.EventType != chantypes.EventTypeWriteAck {
			continue
		}
		if pi, ok := msg.Info.(*chains.PacketInfo); ok {
			if pi.DestChannel == dstChanID && pi.DestPort == dstPortID && pi.Sequence == sequence {
				return provider.PacketInfo(*pi), nil
			}
		}
	}
	return provider.PacketInfo{}, fmt.Errorf("no ibc messages found for write_acknowledgement query: %s", q)
}

func writeAcknowledgementQuery(channelID string, portID string, seq uint64) string {
	x := []string{
		fmt.Sprintf("%s.packet_dst_channel='%s'", waTag, channelID),
		fmt.Sprintf("%s.packet_sequence='%d'", waTag, seq),
	}
	return strings.Join(x, " AND ")
}

func (cc *CardanoProvider) QuerySendPacket(
	ctx context.Context,
	srcChanID,
	srcPortID string,
	sequence uint64,
) (provider.PacketInfo, error) {
	status, err := cc.QueryStatus(ctx)
	if err != nil {
		return provider.PacketInfo{}, err
	}

	q := sendPacketQuery(srcChanID, srcPortID, sequence)
	ibcMsgs, err := cc.queryIBCMessages(ctx, cc.log, 1, 1000, q, cc.legacyEncodedEvents(zap.NewNop(), status.NodeInfo.Version))
	if err != nil {
		return provider.PacketInfo{}, err
	}
	for _, msg := range ibcMsgs {
		if msg.EventType != chantypes.EventTypeSendPacket {
			continue
		}
		if pi, ok := msg.Info.(*chains.PacketInfo); ok {
			if pi.SourceChannel == srcChanID && pi.SourcePort == srcPortID && pi.Sequence == sequence {
				return provider.PacketInfo(*pi), nil
			}
		}
	}
	return provider.PacketInfo{}, fmt.Errorf("no ibc messages found for send_packet query: %s", q)
}

func sendPacketQuery(channelID string, portID string, seq uint64) string {
	x := []string{
		fmt.Sprintf("%s.packet_src_channel='%s'", spTag, channelID),
		fmt.Sprintf("%s.packet_sequence='%d'", spTag, seq),
	}
	return strings.Join(x, " AND ")
}

// QueryTx takes a transaction hash and returns the transaction
func (cc *CardanoProvider) QueryTx(ctx context.Context, hashHex string) (*provider.RelayerTxResponse, error) {
	hash, err := hex.DecodeString(hashHex)
	if err != nil {
		return nil, err
	}

	resp, err := cc.RPCClient.Tx(ctx, hash, true)
	if err != nil {
		return nil, err
	}

	events := parseEventsFromResponseDeliverTx(resp.TxResult)

	return &provider.RelayerTxResponse{
		Height: resp.Height,
		TxHash: string(hash),
		Code:   resp.TxResult.Code,
		Data:   string(resp.TxResult.Data),
		Events: events,
	}, nil
}

// parseEventsFromResponseDeliverTx parses the events from a ResponseDeliverTx and builds a slice
// of provider.RelayerEvent's.
func parseEventsFromResponseDeliverTx(resp abci.ResponseDeliverTx) []provider.RelayerEvent {
	var events []provider.RelayerEvent

	for _, event := range resp.Events {
		attributes := make(map[string]string)
		for _, attribute := range event.Attributes {
			attributes[string(attribute.Key)] = string(attribute.Value)
		}
		events = append(events, provider.RelayerEvent{
			EventType:  event.Type,
			Attributes: attributes,
		})
	}
	return events
}

// QueryTxs returns an array of transactions given a tag
func (cc *CardanoProvider) QueryTxs(ctx context.Context, page, limit int, events []string) ([]*provider.RelayerTxResponse, error) {
	if len(events) == 0 {
		return nil, errors.New("must declare at least one event to search")
	}

	if page <= 0 {
		return nil, errors.New("page must greater than 0")
	}

	if limit <= 0 {
		return nil, errors.New("limit must greater than 0")
	}

	res, err := cc.RPCClient.TxSearch(ctx, strings.Join(events, " AND "), true, &page, &limit, "")
	if err != nil {
		return nil, err
	}

	// Currently, we only call QueryTxs() in two spots and in both of them we are expecting there to only be,
	// at most, one tx in the response. Because of this we don't want to initialize the slice with an initial size.
	var txResps []*provider.RelayerTxResponse
	for _, tx := range res.Txs {
		relayerEvents := parseEventsFromResponseDeliverTx(tx.TxResult)
		txResps = append(txResps, &provider.RelayerTxResponse{
			Height: tx.Height,
			TxHash: string(tx.Hash),
			Code:   tx.TxResult.Code,
			Data:   string(tx.TxResult.Data),
			Events: relayerEvents,
		})
	}
	return txResps, nil
}

// QueryUnreceivedAcknowledgements returns a list of unrelayed packet acks
func (cc *CardanoProvider) QueryUnreceivedAcknowledgements(ctx context.Context, height uint64, channelid, portid string, seqs []uint64) ([]uint64, error) {
	qc := chantypes.NewQueryClient(cc)
	res, err := qc.UnreceivedAcks(ctx, &chantypes.QueryUnreceivedAcksRequest{
		PortId:             portid,
		ChannelId:          channelid,
		PacketAckSequences: seqs,
	})
	if err != nil {
		return nil, err
	}
	return res.Sequences, nil
}

// QueryUnreceivedPackets returns a list of unrelayed packet commitments
func (cc *CardanoProvider) QueryUnreceivedPackets(ctx context.Context, height uint64, channelid, portid string, seqs []uint64) ([]uint64, error) {
	qc := chantypes.NewQueryClient(cc)
	res, err := qc.UnreceivedPackets(ctx, &chantypes.QueryUnreceivedPacketsRequest{
		PortId:                    portid,
		ChannelId:                 channelid,
		PacketCommitmentSequences: seqs,
	})
	if err != nil {
		return nil, err
	}
	return res.Sequences, nil
}

// QueryUpgradedClient returns upgraded client info
func (cc *CardanoProvider) QueryUpgradedClient(ctx context.Context, height int64) (*clienttypes.QueryClientStateResponse, error) {
	req := clienttypes.QueryUpgradedClientStateRequest{}

	queryClient := clienttypes.NewQueryClient(cc)

	res, err := queryClient.UpgradedClientState(ctx, &req)
	if err != nil {
		return nil, err
	}

	if res == nil || res.UpgradedClientState == nil {
		return nil, fmt.Errorf("upgraded client state plan does not exist at height %d", height)
	}

	proof, proofHeight, err := cc.QueryUpgradeProof(ctx, upgradetypes.UpgradedClientKey(height), uint64(height))
	if err != nil {
		return nil, err
	}

	return &clienttypes.QueryClientStateResponse{
		ClientState: res.UpgradedClientState,
		Proof:       proof,
		ProofHeight: proofHeight,
	}, nil
}

// QueryUpgradeProof performs an abci query with the given key and returns the proto encoded merkle proof
// for the query and the height at which the proof will succeed on a tendermint verifier.
func (cc *CardanoProvider) QueryUpgradeProof(ctx context.Context, key []byte, height uint64) ([]byte, clienttypes.Height, error) {
	res, err := cc.QueryABCI(ctx, abci.RequestQuery{
		Path:   "store/upgrade/key",
		Height: int64(height - 1),
		Data:   key,
		Prove:  true,
	})
	if err != nil {
		return nil, clienttypes.Height{}, err
	}

	merkleProof, err := commitmenttypes.ConvertProofs(res.ProofOps)
	if err != nil {
		return nil, clienttypes.Height{}, err
	}

	proof, err := cc.Cdc.Marshaler.Marshal(&merkleProof)
	if err != nil {
		return nil, clienttypes.Height{}, err
	}

	revision := clienttypes.ParseChainID(cc.PCfg.ChainID)

	// proof height + 1 is returned as the proof created corresponds to the height the proof
	// was created in the IAVL tree. Tendermint and subsequently the clients that rely on it
	// have heights 1 above the IAVL tree. Thus we return proof height + 1
	return proof, clienttypes.Height{
		RevisionNumber: revision,
		RevisionHeight: uint64(res.Height + 1),
	}, nil
}

// QueryUpgradedConsState returns upgraded consensus state and height of client
func (cc *CardanoProvider) QueryUpgradedConsState(ctx context.Context, height int64) (*clienttypes.QueryConsensusStateResponse, error) {
	req := clienttypes.QueryUpgradedConsensusStateRequest{}

	queryClient := clienttypes.NewQueryClient(cc)

	res, err := queryClient.UpgradedConsensusState(ctx, &req)
	if err != nil {
		return nil, err
	}

	if res == nil || res.UpgradedConsensusState == nil {
		return nil, fmt.Errorf("upgraded consensus state plan does not exist at height %d", height)
	}

	proof, proofHeight, err := cc.QueryUpgradeProof(ctx, upgradetypes.UpgradedConsStateKey(height), uint64(height))
	if err != nil {
		return nil, err
	}

	return &clienttypes.QueryConsensusStateResponse{
		ConsensusState: res.UpgradedConsensusState,
		Proof:          proof,
		ProofHeight:    proofHeight,
	}, nil
}

func (cc *CardanoProvider) QueryCardanoLatestHeight(ctx context.Context) (int64, error) {
	res, _ := cc.GateWay.GetLastHeight()
	return int64(res), nil
}

func (cc *CardanoProvider) QueryCardanoState(ctx context.Context, height int64) (*pbclientstruct.ClientState, *pbclientstruct.ConsensusState, error) {
	res, _ := cc.GateWay.QueryCardanoState(uint64(height))
	var clientState = pbclientstruct.ClientState{}
	var consensusState = pbclientstruct.ConsensusState{}
	_ = res.GetClientState().UnmarshalTo(&clientState)
	_ = res.GetConsensusState().UnmarshalTo(&consensusState)
	clientState.TrustingPeriod = 1200
	return &clientState, &consensusState, nil
}

func (cc *CardanoProvider) QueryBlockData(ctx context.Context, h int64) (*module.BlockData, error) {
	res, err := cc.GateWay.QueryBlockData(ctx, uint64(h))
	if err != nil {
		return nil, err
	}
	var blockData = pbclientstruct.BlockData{}
	_ = res.GetBlockData().UnmarshalTo(&blockData)

	return &module.BlockData{
		Height: &module.Height{
			RevisionNumber: blockData.Height.RevisionNumber,
			RevisionHeight: blockData.Height.RevisionHeight,
		},
		Slot:       blockData.Slot,
		Hash:       blockData.Hash,
		PrevHash:   blockData.PrevHash,
		EpochNo:    blockData.EpochNo,
		HeaderCbor: blockData.HeaderCbor,
		BodyCbor:   blockData.BodyCbor,
		EpochNonce: blockData.EpochNonce,
		Timestamp:  blockData.Timestamp,
		ChainId:    blockData.ChainId,
	}, nil
}
