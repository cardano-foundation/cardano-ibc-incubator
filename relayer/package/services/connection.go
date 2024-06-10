package services

import (
	"encoding/hex"
	"fmt"
	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/services/helpers"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	"strconv"
	"strings"
)

func (gw *Gateway) QueryConnection(connectionId string) (*conntypes.QueryConnectionResponse, error) {
	//format connectionId to string
	connectionId = strings.Trim(connectionId, "connection-")
	connectionIdNum, err := strconv.ParseInt(connectionId, 10, 64)
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	policyId := chainHandler.Validators.MintConnection.ScriptHash
	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CONNECTION_TOKEN_PREFIX, connectionIdNum)
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
	connDatumDecoded, err := ibc_types.DecodeConnectionDatumSchema(dataString[2:])
	if err != nil {
		return nil, err
	}

	newVersions := []*conntypes.Version{}
	for _, version := range connDatumDecoded.State.Versions {
		newFeatures := []string{}
		for _, feature := range version.Features {
			newFeatures = append(newFeatures, string(feature))
		}
		newVersion := conntypes.Version{
			Identifier: string(version.Identifier),
			Features:   newFeatures,
		}
		newVersions = append(newVersions, &newVersion)
	}
	stateNum, ok := connDatumDecoded.State.State.(cbor.Tag)
	if !ok {
		return nil, fmt.Errorf("state is not cbor tag")
	}
	proof, err := gw.DBService.FindUtxoByPolicyAndTokenNameAndState(
		policyId,
		prefixTokenName,
		channeltypes.State_name[int32(stateNum.Number-constant.CBOR_TAG_MAGIC_NUMBER)],
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
	connectionProof := cardanoTxProof.CertifiedTransactions[0].Proof
	return &conntypes.QueryConnectionResponse{
		Connection: &conntypes.ConnectionEnd{
			ClientId: string(connDatumDecoded.State.ClientId),
			Versions: newVersions,
			State:    conntypes.State(stateNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Counterparty: conntypes.Counterparty{
				ClientId:     string(connDatumDecoded.State.Counterparty.ClientId),
				ConnectionId: string(connDatumDecoded.State.Counterparty.ConnectionId),
				Prefix: commitmenttypes.MerklePrefix{
					KeyPrefix: connDatumDecoded.State.Counterparty.Prefix.KeyPrefix,
				},
			},
			DelayPeriod: connDatumDecoded.State.DelayPeriod,
		},
		Proof: []byte(connectionProof),
		ProofHeight: clienttypes.Height{
			RevisionNumber: 0,
			RevisionHeight: uint64(proof.BlockNo),
		},
	}, nil
}

func (gw *Gateway) QueryConnections() ([]*conntypes.IdentifiedConnection, error) {
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}
	mintConnScriptHash := chainHandler.Validators.MintConnection.ScriptHash
	prefixTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CONNECTION_TOKEN_PREFIX, 0)
	if err != nil {
		return nil, err
	}
	utxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(mintConnScriptHash, prefixTokenName[:20])
	if err != nil {
		return nil, err
	}
	if len(utxos) == 0 {
		return nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", mintConnScriptHash, prefixTokenName)
	}
	var response []*conntypes.IdentifiedConnection
	for _, utxo := range utxos {
		if utxo.Datum == nil {
			continue
		}
		dataString := *utxo.Datum
		connDatumDecoded, err := ibc_types.DecodeConnectionDatumSchema(dataString[2:])
		if err != nil {
			return nil, err
		}
		newVersions := []*conntypes.Version{}
		for _, version := range connDatumDecoded.State.Versions {
			newFeatures := []string{}
			for _, feature := range version.Features {
				newFeatures = append(newFeatures, string(feature))
			}
			newVersion := conntypes.Version{
				Identifier: string(version.Identifier),
				Features:   newFeatures,
			}
			newVersions = append(newVersions, &newVersion)
		}
		stateNum, ok := connDatumDecoded.State.State.(cbor.Tag)
		if !ok {
			return nil, fmt.Errorf("state is not cbor tag")
		}
		valueId, err := getConnectionIdByTokenName(
			utxo.AssetsName[2:], helpers.AuthToken{
				PolicyId: chainHandler.HandlerAuthToken.PolicyID,
				Name:     chainHandler.HandlerAuthToken.Name,
			}, constant.CONNECTION_TOKEN_PREFIX)
		if err != nil {
			return nil, err
		}
		response = append(response, &conntypes.IdentifiedConnection{
			Id:       fmt.Sprintf("connection-%v", valueId),
			ClientId: string(connDatumDecoded.State.ClientId),
			Versions: newVersions,
			State:    conntypes.State(stateNum.Number - constant.CBOR_TAG_MAGIC_NUMBER),
			Counterparty: conntypes.Counterparty{
				ClientId:     string(connDatumDecoded.State.Counterparty.ClientId),
				ConnectionId: string(connDatumDecoded.State.Counterparty.ConnectionId),
				Prefix: commitmenttypes.MerklePrefix{
					KeyPrefix: connDatumDecoded.State.Counterparty.Prefix.KeyPrefix,
				},
			},
			DelayPeriod: connDatumDecoded.State.DelayPeriod,
		})
	}
	return response, nil
}

func getConnectionIdByTokenName(tokenName string, baseToken helpers.AuthToken, prefix string) (string, error) {
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
