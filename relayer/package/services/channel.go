package services

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/avast/retry-go/v4"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/services/helpers"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
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
	channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}
	stateNum := int32(channelDatumDecoded.State.Channel.State)
	orderNum := int32(channelDatumDecoded.State.Channel.Ordering)
	connectionHops := make([]string, 0)
	for _, hop := range channelDatumDecoded.State.Channel.ConnectionHops {
		connectionHops = append(connectionHops, string(hop))
	}
	hash := utxos[0].TxHash[2:]
	var channelProof string
	err = retry.Do(func() error {
		cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
		if err != nil {
			return err
		}
		if len(cardanoTxProof.CertifiedTransactions) == 0 {
			return fmt.Errorf("no certified transactions found")
		}
		channelProof = cardanoTxProof.CertifiedTransactions[0].Proof
		return nil
	}, retry.Attempts(5), retry.Delay(10*time.Second), retry.LastErrorOnly(true))
	if err != nil {
		return nil, err
	}

	return &chantypes.QueryChannelResponse{
		Channel: &chantypes.Channel{
			State:    chantypes.State(stateNum),
			Ordering: chantypes.Order(orderNum),
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
			RevisionHeight: uint64(utxos[0].BlockNo),
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
		channelDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(dataString[2:])
		if err != nil {
			return nil, err
		}
		stateNum := int32(channelDatumDecoded.State.Channel.State)
		orderNum := int32(channelDatumDecoded.State.Channel.Ordering)
		connectionHops := make([]string, 0)
		for _, hop := range channelDatumDecoded.State.Channel.ConnectionHops {
			connectionHops = append(connectionHops, string(hop))
		}
		valueId, err := getChannelIdByTokenName(utxo.AssetsName[2:], helpers.AuthToken{
			PolicyId: chainHandler.HandlerAuthToken.PolicyID,
			Name:     chainHandler.HandlerAuthToken.Name,
		}, constant.CHANNEL_TOKEN_PREFIX)
		identifiedChannels = append(identifiedChannels, &chantypes.IdentifiedChannel{
			State:    chantypes.State(stateNum),
			Ordering: chantypes.Order(orderNum),
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

func (gw *Gateway) QueryConnectionChannels(connectionId string) ([]*chantypes.IdentifiedChannel, error) {
	if !strings.Contains(connectionId, "connection-") {
		return nil, fmt.Errorf("connectionId should start with connection-")
	}
	channels, err := gw.QueryChannels()
	if err != nil {
		return nil, err
	}
	var connectionChannels []*chantypes.IdentifiedChannel
	for _, channel := range channels {
		if channel.ConnectionHops[0] == connectionId {
			connectionChannels = append(connectionChannels, channel)
		}
	}
	return connectionChannels, nil
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
