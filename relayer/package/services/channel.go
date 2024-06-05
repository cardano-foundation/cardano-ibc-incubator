package services

import (
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/services/helpers"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/fxamacker/cbor/v2"
	"strconv"
	"strings"
)

func (gw *Gateway) QueryChannel(channelId string) (*chantypes.QueryChannelResponse, error) {
	channelId = strings.Trim(channelId, "channel-")
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
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumWithPort(dataString[2:])
	if err != nil {
		return nil, err
	}
	stateNum, ok := channelDatumDecoded.State.Channel.State.(cbor.Tag)
	if !ok {
		return nil, fmt.Errorf("state is not cbor tag")
	}
	orderNum, ok := channelDatumDecoded.State.Channel.Ordering.(cbor.Tag)
	if !ok {
		return nil, fmt.Errorf("order is not cbor tag")
	}
	connectionHops := make([]string, 0)
	for _, hop := range channelDatumDecoded.State.Channel.ConnectionHops {
		connectionHops = append(connectionHops, string(hop))
	}
	proof, err := gw.DBService.FindUtxoByPolicyAndTokenNameAndState(
		policyId,
		prefixTokenName,
		chantypes.State_name[int32(stateNum.Number-constant.CBOR_TAG_MAGIC_NUMBER)],
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
	channelProof := cardanoTxProof.CertifiedTransactions[0].Proof
	return &chantypes.QueryChannelResponse{
		Channel: &chantypes.Channel{
			State:    chantypes.State(stateNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Ordering: chantypes.Order(orderNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Counterparty: chantypes.Counterparty{
				PortId:    string(channelDatumDecoded.State.Channel.Counterparty.PortId),
				ChannelId: string(channelDatumDecoded.State.Channel.Counterparty.ChannelId),
			},
			ConnectionHops: connectionHops,
			Version:        string(channelDatumDecoded.State.Channel.Version),
		},
		Proof: []byte(channelProof),
		ProofHeight: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(proof.BlockNo),
		},
	}, nil
}
