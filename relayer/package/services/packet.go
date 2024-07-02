package services

import (
	"fmt"
	"github.com/avast/retry-go/v4"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/services/helpers"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/cosmos-sdk/types/query"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"golang.org/x/exp/maps"
	"slices"
	"strconv"
	"strings"
	"time"
)

func (gw *Gateway) QueryPacketCommitment(req *channeltypes.QueryPacketCommitmentRequest) (*channeltypes.QueryPacketCommitmentResponse, error) {
	req, err := helpers.ValidQueryPacketCommitmentParam(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}
	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetCommitment := channelDatumDecoded.State.PacketCommitment[req.Sequence]
	if packetCommitment == nil {
		return nil, sdkerrors.Wrapf(channeltypes.ErrPacketCommitmentNotFound, "portID (%s), channelID (%s), sequence (%d)", req.PortId, req.ChannelId, req.Sequence)
	}

	stateNum := int32(channelDatumDecoded.State.Channel.State)
	proof, err := gw.DBService.FindUtxoByPolicyAndTokenNameAndState(
		policyId,
		prefixTokenName,
		channeltypes.State_name[stateNum],
		chainHandler.Validators.MintConnection.ScriptHash,
		chainHandler.Validators.MintChannel.ScriptHash)
	if err != nil {
		return nil, err
	}
	hash := proof.TxHash[2:]
	cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
	if err != nil {
		return nil, err
	}
	commitmentProof := cardanoTxProof.CertifiedTransactions[0].Proof

	return &channeltypes.QueryPacketCommitmentResponse{
		Commitment: packetCommitment,
		Proof:      []byte(commitmentProof),
		ProofHeight: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(proof.BlockNo),
		},
	}, nil
}

func (gw *Gateway) QueryPacketCommitments(req *channeltypes.QueryPacketCommitmentsRequest) (*channeltypes.QueryPacketCommitmentsResponse, error) {
	req, err := helpers.ValidQueryPacketCommitmentsParam(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}

	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetCommitmentSeqs := maps.Keys(channelDatumDecoded.State.PacketCommitment)

	if req.Pagination.Reverse == true {
		slices.Reverse(packetCommitmentSeqs)
	}
	if req.Pagination.Key != nil {
		offset, err := helpers.DecodePaginationKey(req.Pagination.Key)
		if err != nil {
			return nil, err
		}
		req.Pagination.Offset = offset
	}
	var nextKey []byte
	var total uint64
	if req.Pagination.CountTotal {
		total = uint64(len(packetCommitmentSeqs))
	} else {
		total = 0
	}

	if len(packetCommitmentSeqs) > int(req.Pagination.Limit) {
		from := req.Pagination.Offset
		to := req.Pagination.Offset + req.Pagination.Limit
		packetCommitmentSeqs = packetCommitmentSeqs[from:to]
		pageKeyDto := helpers.PaginationKeyDto{
			Offset: to,
		}

		if int(to) < len(packetCommitmentSeqs) {
			nextKey = helpers.GeneratePaginationKey(pageKeyDto)
		} else {
			nextKey = nil
		}
	}
	var commitments []*channeltypes.PacketState
	for _, packetSeqs := range packetCommitmentSeqs {
		temp := &channeltypes.PacketState{
			PortId:    string(channelDatumDecoded.PortId),
			ChannelId: req.ChannelId,
			Sequence:  packetSeqs,
			Data:      channelDatumDecoded.State.PacketCommitment[packetSeqs],
		}
		commitments = append(commitments, temp)
	}

	return &channeltypes.QueryPacketCommitmentsResponse{
		Commitments: commitments,
		Pagination: &query.PageResponse{
			NextKey: nextKey,
			Total:   total,
		},
		Height: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: 0,
		},
	}, nil
}

func (gw *Gateway) QueryPacketAck(req *channeltypes.QueryPacketAcknowledgementRequest) (*channeltypes.QueryPacketAcknowledgementResponse, error) {
	req, err := helpers.ValidQueryPacketAckParam(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetAcknowledgement := channelDatumDecoded.State.PacketAcknowledgement[req.Sequence]
	if packetAcknowledgement == nil {
		return nil, sdkerrors.Wrapf(channeltypes.ErrInvalidAcknowledgement, "portID (%s), channelID (%s), sequence (%d)", req.PortId, req.ChannelId, req.Sequence)
	}

	stateNum := int32(channelDatumDecoded.State.Channel.State)

	proof, err := gw.DBService.FindUtxoByPolicyAndTokenNameAndState(
		policyId,
		prefixTokenName,
		channeltypes.State_name[stateNum],
		chainHandler.Validators.MintConnection.ScriptHash,
		chainHandler.Validators.MintChannel.ScriptHash)
	if err != nil {
		return nil, err
	}

	hash := proof.TxHash[2:]
	var acknowledgementProof string
	err = retry.Do(func() error {
		cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
		if err != nil {
			return err
		}
		if len(cardanoTxProof.CertifiedTransactions) == 0 {
			return fmt.Errorf("no certified transactions with proof found for packet acknowledgement")
		}
		acknowledgementProof = cardanoTxProof.CertifiedTransactions[0].Proof
		return nil
	}, retry.Attempts(5), retry.Delay(5*time.Second), retry.LastErrorOnly(true))
	if err != nil {
		return nil, err
	}

	return &channeltypes.QueryPacketAcknowledgementResponse{
		Acknowledgement: packetAcknowledgement,
		Proof:           []byte(acknowledgementProof),
		ProofHeight: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(proof.BlockNo),
		},
	}, nil
}

func (gw *Gateway) QueryPacketAcks(req *channeltypes.QueryPacketAcknowledgementsRequest) (*channeltypes.QueryPacketAcknowledgementsResponse, error) {
	req, err := helpers.ValidQueryPacketAcksParam(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetReceiptSeqs := maps.Keys(channelDatumDecoded.State.PacketReceipt)

	if req.Pagination.Reverse {
		slices.Reverse(packetReceiptSeqs)
	}
	if req.Pagination.Key != nil {
		offset, err := helpers.DecodePaginationKey(req.Pagination.Key)
		if err != nil {
			return nil, err
		}
		req.Pagination.Offset = offset
	}
	var nextKey []byte
	var total uint64
	if req.Pagination.CountTotal {
		total = uint64(len(packetReceiptSeqs))
	} else {
		total = 0
	}

	if len(packetReceiptSeqs) > int(req.Pagination.Limit) {
		from := req.Pagination.Offset
		to := req.Pagination.Offset + req.Pagination.Limit
		packetReceiptSeqs = packetReceiptSeqs[from:to]
		pageKeyDto := helpers.PaginationKeyDto{
			Offset: to,
		}

		if int(to) < len(packetReceiptSeqs) {
			nextKey = helpers.GeneratePaginationKey(pageKeyDto)
		} else {
			nextKey = nil
		}
	}
	var acknowledgements []*channeltypes.PacketState
	for _, packetSeqs := range packetReceiptSeqs {
		temp := &channeltypes.PacketState{
			PortId:    string(channelDatumDecoded.PortId),
			ChannelId: req.ChannelId,
			Sequence:  packetSeqs,
			Data:      channelDatumDecoded.State.PacketCommitment[packetSeqs],
		}
		acknowledgements = append(acknowledgements, temp)
	}

	return &channeltypes.QueryPacketAcknowledgementsResponse{
		Acknowledgements: acknowledgements,
		Pagination: &query.PageResponse{
			NextKey: nextKey,
			Total:   total,
		},
		Height: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: 0,
		},
	}, nil
}

func (gw *Gateway) QueryPacketReceipt(req *channeltypes.QueryPacketReceiptRequest) (*channeltypes.QueryPacketReceiptResponse, error) {
	req, err := helpers.ValidQueryPacketReceipt(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetReceipt := channelDatumDecoded.State.PacketReceipt[req.Sequence]
	received := false
	if packetReceipt != nil {
		received = true
	}

	stateNum := int32(channelDatumDecoded.State.Channel.State)

	proof, err := gw.DBService.FindUtxoByPolicyAndTokenNameAndState(
		policyId,
		prefixTokenName,
		channeltypes.State_name[stateNum],
		chainHandler.Validators.MintConnection.ScriptHash,
		chainHandler.Validators.MintChannel.ScriptHash)
	if err != nil {
		return nil, err
	}

	hash := proof.TxHash[2:]
	cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
	if err != nil {
		return nil, err
	}

	acknowledgementProof := cardanoTxProof.CertifiedTransactions[0].Proof

	return &channeltypes.QueryPacketReceiptResponse{
		Received: received,
		Proof:    []byte(acknowledgementProof),
		ProofHeight: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(proof.BlockNo),
		},
	}, nil
}

func (gw *Gateway) QueryUnrecvPackets(req *channeltypes.QueryUnreceivedPacketsRequest) (*channeltypes.QueryUnreceivedPacketsResponse, error) {
	req, err := helpers.ValidQueryUnrecvPackets(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetReceipts := channelDatumDecoded.State.PacketReceipt
	var sequences []uint64
	for _, seq := range req.PacketCommitmentSequences {
		if _, exist := packetReceipts[seq]; !exist {
			sequences = append(sequences, seq)
		}
	}
	return &channeltypes.QueryUnreceivedPacketsResponse{
		Sequences: sequences,
		Height: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: 0,
		},
	}, nil
}

func (gw *Gateway) QueryUnrecvAcks(req *channeltypes.QueryUnreceivedAcksRequest) (*channeltypes.QueryUnreceivedAcksResponse, error) {
	req, err := helpers.ValidQueryUnrecvAcks(req)
	if err != nil {
		return nil, err
	}
	channelId := strings.Trim(req.ChannelId, "channel-")
	channelIdNum, err := strconv.ParseInt(channelId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintChannel.ScriptHash

	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, channelIdNum)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(policyId, prefixTokenName)
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", policyId, prefixTokenName)
	}
	if utxos[0].Datum == nil {

		return nil, fmt.Errorf("datum is nil")
	}

	dataString := *utxos[0].Datum
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	packetCommitmentSeqs := channelDatumDecoded.State.PacketCommitment
	var sequences []uint64
	for _, seq := range req.PacketAckSequences {
		if _, exist := packetCommitmentSeqs[seq]; !exist {
			sequences = append(sequences, seq)
		}
	}
	return &channeltypes.QueryUnreceivedAcksResponse{
		Sequences: sequences,
		Height: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: 0,
		},
	}, nil
}
