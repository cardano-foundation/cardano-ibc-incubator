package services

import (
	"encoding/hex"
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/services/helpers"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/fxamacker/cbor/v2"
	"sort"
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

func (gw *Gateway) QueryChannels() ([]*chantypes.IdentifiedChannel, error) {
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	minChannelScriptHash := chainHandler.Validators.MintChannel.ScriptHash
	channelTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX, 0)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(minChannelScriptHash, channelTokenName[:20])
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", minChannelScriptHash, channelTokenName)
	}
	var identifiedChannels []*chantypes.IdentifiedChannel
	for _, utxo := range utxos {
		if utxo.Datum == nil {
			continue
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
		valueId, err := getChannelIdByTokenName(utxo.AssetsName[2:], helpers.AuthToken{
			PolicyId: chainHandler.HandlerAuthToken.PolicyID,
			Name:     chainHandler.HandlerAuthToken.Name,
		}, constant.CHANNEL_TOKEN_PREFIX)
		identifiedChannels = append(identifiedChannels, &chantypes.IdentifiedChannel{
			State:    chantypes.State(stateNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Ordering: chantypes.Order(orderNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Counterparty: chantypes.Counterparty{
				PortId:    string(channelDatumDecoded.State.Channel.Counterparty.PortId),
				ChannelId: string(channelDatumDecoded.State.Channel.Counterparty.ChannelId),
			},
			ConnectionHops: connectionHops,
			Version:        string(channelDatumDecoded.State.Channel.Version),
			PortId:         string(channelDatumDecoded.PortId),
			ChannelId:      fmt.Sprintf("channel-%s", valueId),
		})
	}
	channelFilters := make(map[string]*chantypes.IdentifiedChannel)

	// Reduce identifiedChannels into channelFilters
	for _, currentValue := range identifiedChannels {
		key := currentValue.ChannelId + "_" + currentValue.PortId
		if existing, found := channelFilters[key]; !found || existing.State < currentValue.State {
			channelFilters[key] = currentValue
		}
	}

	// Extract the values from the channelFilters map
	var channels []*chantypes.IdentifiedChannel
	for _, value := range channelFilters {
		channels = append(channels, value)
	}

	sort.Slice(channels, func(i, j int) bool {
		return i > j
	})
	return channels, nil
}

func getChannelIdByTokenName(tokenName string, baseToken helpers.AuthToken, prefix string) (string, error) {
	baseTokenPart := helpers.HashSha3_256(baseToken.PolicyId + baseToken.Name)[:40]
	prefixPart := helpers.HashSha3_256(prefix)[:8]
	prefixFull := baseTokenPart + prefixPart

	if !strings.Contains(tokenName, prefixFull) {
		return "", nil
	}
	connIdHex := strings.ReplaceAll(tokenName, prefixFull, "")
	res, err := hex.DecodeString(connIdHex)
	if err != nil {
		return "", err
	}
	return string(res), nil
}
