package services

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/avast/retry-go/v4"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	abci "github.com/cometbft/cometbft/abci/types"
	ctypes "github.com/cometbft/cometbft/rpc/core/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"

	"github.com/cardano/relayer/v1/constant"

	"os"

	"github.com/cardano/relayer/v1/package/mithril/dtos"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
)

func (gw *Gateway) QueryIBCHeader(ctx context.Context, h int64, cs *mithril.ClientState) (*mithril.MithrilHeader, error) {
	cardanoTxsSetSnapshot, err := gw.MithrilService.GetCardanoTransactionsSetSnapshot()
	if err != nil {
		return nil, err
	}
	cardanoTxsSetSnapshotReverse := slices.Clone(cardanoTxsSetSnapshot)
	slices.Reverse(cardanoTxsSetSnapshotReverse)
	snapshotIdx := slices.IndexFunc(cardanoTxsSetSnapshotReverse, func(c dtos.CardanoTransactionSetSnapshot) bool { return c.BlockNumber >= uint64(h) })
	if snapshotIdx == -1 {
		latestHeight := cardanoTxsSetSnapshot[0].BlockNumber
		if h < int64(latestHeight) {
			return nil, errors.New(fmt.Sprintf("BlockNumber: Missing mithril height %d", h))
		}
		return nil, errors.New(fmt.Sprintf("Could not find snapshot with height %d", h))
	}

	snapshot := &cardanoTxsSetSnapshotReverse[snapshotIdx]
	snapshotCertificate, err := gw.MithrilService.GetCertificateByHash(snapshot.CertificateHash)
	if err != nil {
		return nil, err
	}
	if cs.CurrentEpoch < snapshot.Epoch {
		//fmt.Printf("Client State has Current epoch: %v, ", cs.CurrentEpoch)
		//fmt.Printf("Snapshot has epoch: %v \n", snapshot.Beacon.Epoch)
		return gw.QueryIBCGenesisCertHeader(ctx, int64(cs.CurrentEpoch+1))
	}

	mithrilStakeDistributionList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, err
	}

	mithrilStakeDistributionIdx := slices.IndexFunc(mithrilStakeDistributionList, func(c dtos.MithrilStakeDistribution) bool { return c.Epoch == snapshot.Epoch })
	if mithrilStakeDistributionIdx == -1 {
		return nil, errors.New(fmt.Sprintf("Could not find stake distribution with epoch %d", snapshot.Epoch))
	}
	mithrilStakeDistribution := mithrilStakeDistributionList[mithrilStakeDistributionIdx]
	mithrilDistributionCertificate, err := gw.MithrilService.GetCertificateByHash(mithrilStakeDistribution.CertificateHash)
	if err != nil {
		return nil, err
	}

	mithrilHeader := mithril.MithrilHeader{
		MithrilStakeDistribution:            helpers.ConvertMithrilStakeDistribution(mithrilStakeDistribution, *mithrilDistributionCertificate),
		MithrilStakeDistributionCertificate: helpers.ConvertMithrilStakeDistributionCertificate(mithrilStakeDistribution, *mithrilDistributionCertificate),
		TransactionSnapshot: &mithril.CardanoTransactionSnapshot{
			MerkleRoot:      snapshot.MerkleRoot,
			Epoch:           snapshot.Epoch,
			BlockNumber:     snapshot.BlockNumber,
			Hash:            snapshot.Hash,
			CertificateHash: snapshot.CertificateHash,
			CreatedAt:       snapshot.CreatedAt.String(),
		},
		TransactionSnapshotCertificate: helpers.ConvertMithrilStakeDistributionCertificate(dtos.MithrilStakeDistribution{
			Hash:            snapshot.Hash,
			Epoch:           snapshot.Epoch,
			CertificateHash: snapshot.CertificateHash,
			CreatedAt:       snapshot.CreatedAt,
		}, *snapshotCertificate),
	}

	return &mithrilHeader, nil
}

func (gw *Gateway) QueryNewMithrilClient() (*mithril.ClientState, *mithril.ConsensusState, error) {
	currentEpochSettings, err := gw.MithrilService.GetEpochSetting()
	if err != nil {
		return nil, nil, err
	}
	mithrilStakeDistributionsList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, nil, err
	}
	if len(mithrilStakeDistributionsList) == 0 {
		return nil, nil, fmt.Errorf("GetListMithrilStakeDistributions returned empty list")
	}
	mithrilDistribution := mithrilStakeDistributionsList[0]
	fcCertificateMsd, err := gw.MithrilService.GetCertificateByHash(mithrilDistribution.CertificateHash)
	if err != nil {
		return nil, nil, err
	}
	certificateList, err := gw.MithrilService.GetListCertificates()
	if err != nil {
		return nil, nil, err
	}
	// latestCertificateMsd := dtos.CertificateOverall{}
	idx := slices.IndexFunc(certificateList, func(c dtos.CertificateOverall) bool { return c.Epoch == mithrilDistribution.Epoch })
	if idx == -1 {
		return nil, nil, fmt.Errorf("could not find certificate with epoch %d", mithrilDistribution.Epoch)
	}
	// latestCertificateMsd = certificateList[idx]

	listSnapshots, err := gw.MithrilService.GetCardanoTransactionsSetSnapshot()
	if err != nil {
		return nil, nil, err
	}
	if len(listSnapshots) == 0 {
		return nil, nil, fmt.Errorf("GetListSnapshots returned empty list")
	}
	latestSnapshot := listSnapshots[0]
	//latestSnapshotCertificate, err := gw.MithrilService.GetCertificateByHash(latestSnapshot.CertificateHash)
	//if err != nil {
	//	return nil, nil, err
	//}

	phifFraction := helpers.FloatToFraction(currentEpochSettings.Protocol.PhiF)
	clientState := &mithril.ClientState{
		ChainId: os.Getenv(constant.CardanoChainNetworkMagic),
		LatestHeight: &mithril.Height{
			RevisionNumber: 0,
			RevisionHeight: latestSnapshot.BlockNumber,
		},
		FrozenHeight: &mithril.Height{
			RevisionNumber: 0,
			RevisionHeight: 0,
		},
		CurrentEpoch:   currentEpochSettings.Epoch,
		TrustingPeriod: 0,
		ProtocolParameters: &mithril.MithrilProtocolParameters{
			K: currentEpochSettings.Protocol.K,
			M: currentEpochSettings.Protocol.M,
			PhiF: mithril.Fraction{
				Numerator:   phifFraction.Numerator,
				Denominator: phifFraction.Denominator,
			},
		},
		UpgradePath: nil,
	}

	layout := "2006-01-02T15:04:05.000000000Z"
	if len(fcCertificateMsd.Metadata.SealedAt) < len(layout) {
		fcCertificateMsd.Metadata.SealedAt = fcCertificateMsd.Metadata.SealedAt[:len(fcCertificateMsd.Metadata.SealedAt)-1] + strings.Repeat("0", len(layout)-len(fcCertificateMsd.Metadata.SealedAt)) + "Z"
	}
	tt, err := time.Parse(layout, fcCertificateMsd.Metadata.SealedAt)
	if err != nil {
		return nil, nil, err

	}
	consensusState := &mithril.ConsensusState{
		Timestamp:                uint64(tt.UnixNano()),
		FirstCertHashLatestEpoch: mithrilDistribution.CertificateHash,
		LatestCertHashTxSnapshot: latestSnapshot.CertificateHash,
	}
	return clientState, consensusState, nil
}

func (gw *Gateway) QueryIBCGenesisCertHeader(ctx context.Context, epoch int64) (*mithril.MithrilHeader, error) {
	mithrilStakeDistributionList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, err
	}

	mithrilStakeDistributionIdx := slices.IndexFunc(mithrilStakeDistributionList, func(c dtos.MithrilStakeDistribution) bool { return c.Epoch == uint64(epoch) })
	if mithrilStakeDistributionIdx == -1 {
		return nil, errors.New(fmt.Sprintf("Could not find stake distribution with epoch %d", epoch))
	}
	mithrilStakeDistribution := mithrilStakeDistributionList[mithrilStakeDistributionIdx]
	mithrilDistributionCertificate, err := gw.MithrilService.GetCertificateByHash(mithrilStakeDistribution.CertificateHash)
	if err != nil {
		return nil, err
	}

	cardanoTxsSetSnapshot, err := gw.MithrilService.GetCardanoTransactionsSetSnapshot()
	if err != nil {
		return nil, err
	}

	cardanoTxsSetSnapshotReverse := slices.Clone(cardanoTxsSetSnapshot)
	slices.Reverse(cardanoTxsSetSnapshotReverse)
	firstSnapshotIdx := slices.IndexFunc(cardanoTxsSetSnapshotReverse, func(c dtos.CardanoTransactionSetSnapshot) bool { return c.Epoch == uint64(epoch) })
	if firstSnapshotIdx == -1 {
		return nil, errors.New(fmt.Sprintf("Could not find snapshot with epoch %d", epoch))
	}
	firstSnapshot := &cardanoTxsSetSnapshotReverse[firstSnapshotIdx]
	snapshotCertificate, _ := gw.MithrilService.GetCertificateByHash(firstSnapshot.CertificateHash)
	// TODO: There is an issue that cannot get first trx snapshots with epoch if there are too many tx snapshots
	mithrilHeader := mithril.MithrilHeader{
		MithrilStakeDistribution:            helpers.ConvertMithrilStakeDistribution(mithrilStakeDistribution, *mithrilDistributionCertificate),
		MithrilStakeDistributionCertificate: helpers.ConvertMithrilStakeDistributionCertificate(mithrilStakeDistribution, *mithrilDistributionCertificate),
		TransactionSnapshot: &mithril.CardanoTransactionSnapshot{
			MerkleRoot:      firstSnapshot.MerkleRoot,
			Epoch:           firstSnapshot.Epoch,
			BlockNumber:     firstSnapshot.BlockNumber,
			Hash:            firstSnapshot.Hash,
			CertificateHash: firstSnapshot.CertificateHash,
			CreatedAt:       firstSnapshot.CreatedAt.String(),
		},
		TransactionSnapshotCertificate: helpers.ConvertMithrilStakeDistributionCertificate(dtos.MithrilStakeDistribution{
			Hash:            firstSnapshot.Hash,
			Epoch:           firstSnapshot.Epoch,
			CertificateHash: firstSnapshot.CertificateHash,
			CreatedAt:       firstSnapshot.CreatedAt,
		}, *snapshotCertificate),
	}

	return &mithrilHeader, nil
}

func (gw *Gateway) QueryBlockResults(height uint64) (*ctypes.ResultBlockResults, error) {
	var txsResults []*abci.ResponseDeliverTx
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}

	// get connection and channel UTxOs
	connAndChannelUTxOs, err := gw.DBService.QueryConnectionAndChannelUTxOs([]uint64{height}, chainHandler.Validators.MintConnection.ScriptHash, chainHandler.Validators.MintChannel.ScriptHash)
	if err != nil {
		return nil, err
	}

	for _, utxo := range connAndChannelUTxOs {
		switch utxo.AssetsPolicy {
		case chainHandler.Validators.MintConnection.ScriptHash:
			connEvent, err := gw.unmarshalConnectionEvent(utxo)
			if err != nil {
				return nil, err
			}
			txsResults = append(txsResults, connEvent)
		case chainHandler.Validators.MintChannel.ScriptHash:
			channEvent, err := gw.unmarshalChannelEvent(utxo)
			if err != nil {
				return nil, err
			}
			txsResults = append(txsResults, channEvent)
		}
	}
	// get client UTxOs
	clientTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CLIENT_PREFIX, 0)
	authOrClientUTxos, err := gw.DBService.QueryClientOrAuthHandlerUTxOsByHeight(
		chainHandler.HandlerAuthToken.PolicyID,
		chainHandler.Validators.MintClient.ScriptHash,
		clientTokenName[0:40],
		height)
	clientEvent, err := gw.unmarshalClientEvents(authOrClientUTxos)
	if err != nil {
		return nil, err
	}
	if clientEvent != nil {
		txsResults = append(txsResults, clientEvent)
	}

	return &ctypes.ResultBlockResults{
		Height:     int64(height),
		TxsResults: txsResults,
	}, nil
}

func (gw *Gateway) unmarshalConnectionEvent(connUTxO dto.UtxoDto) (*abci.ResponseDeliverTx, error) {
	chainHandler, _ := helpers.GetChainHandler()
	// decode connection datum
	connDatumDecoded, err := ibc_types.DecodeConnectionDatumSchema(*connUTxO.Datum)
	if err != nil {
		return nil, err
	}
	// query redeemer of connection
	redeemers, err := gw.DBService.QueryRedeemersByTransactionId(connUTxO.TxId, chainHandler.Validators.MintConnection.ScriptHash, chainHandler.Validators.SpendConnection.Address)
	if err != nil {
		return nil, err
	}
	// decode redeemer connection
	connId := helpers.GetEntityIdFromTokenName(connUTxO.AssetsName, helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	},
		constant.CONNECTION_TOKEN_PREFIX,
	)
	var event abci.Event
	for _, redeemer := range redeemers {
		switch redeemer.Type {
		case "mint":
			mintConnRedeemer, err := ibc_types.DecodeMintConnectionRedeemerSchema(hex.EncodeToString(redeemer.Data))
			if err != nil {
				return nil, err
			}

			eventType := connectiontypes.EventTypeConnectionOpenInit
			if mintConnRedeemer.Type == ibc_types.ConnOpenTry {
				eventType = connectiontypes.EventTypeConnectionOpenTry
			}
			event, err = helpers.NormalizeEventFromConnDatum(*connDatumDecoded, connId, eventType)
		case "spend":
			spendConnRedeemer, err := ibc_types.DecodeSpendConnectionRedeemerSchema(hex.EncodeToString(redeemer.Data))
			if err != nil {
				return nil, err
			}
			eventType := connectiontypes.EventTypeConnectionOpenAck
			if spendConnRedeemer.Type == ibc_types.ConnOpenConfirm {
				eventType = connectiontypes.EventTypeConnectionOpenConfirm
			}
			event, err = helpers.NormalizeEventFromConnDatum(*connDatumDecoded, connId, eventType)
		}
	}

	return &abci.ResponseDeliverTx{
		Code: 0,
		Events: []abci.Event{
			event,
		},
	}, nil
}

func (gw *Gateway) unmarshalChannelEvent(channUTxO dto.UtxoDto) (*abci.ResponseDeliverTx, error) {
	chainHandler, _ := helpers.GetChainHandler()
	// decode channel datum
	channDatumDecoded, err := ibc_types.DecodeChannelDatumSchema(*channUTxO.Datum)
	if err != nil {
		return nil, err
	}
	// query redeemer of channel
	redeemers, err := gw.DBService.QueryRedeemersByTransactionId(channUTxO.TxId, chainHandler.Validators.MintChannel.ScriptHash, chainHandler.Validators.SpendChannel.Address)
	if err != nil {
		return nil, err
	}

	channelId := helpers.GetEntityIdFromTokenName(channUTxO.AssetsName, helpers.AuthToken{
		chainHandler.HandlerAuthToken.PolicyID,
		chainHandler.HandlerAuthToken.Name,
	}, constant.CHANNEL_TOKEN_PREFIX)
	connId := string(channDatumDecoded.State.Channel.ConnectionHops[0])
	// decode redeemer channel
	var event abci.Event
	for _, redeemer := range redeemers {
		switch redeemer.Type {
		case "mint":
			mintChannRedeemer, err := ibc_types.DecodeMintChannelRedeemerSchema(hex.EncodeToString(redeemer.Data))
			if err != nil {
				return nil, err
			}

			eventType := channeltypes.EventTypeChannelOpenInit
			if mintChannRedeemer.Type == ibc_types.ChanOpenInit {
				eventType = channeltypes.EventTypeChannelOpenInit
			}
			event, err = helpers.NormalizeEventFromChannelDatum(*channDatumDecoded, connId, channelId, eventType)
		case "spend":
			spendChannelRedeemer, err := ibc_types.DecodeSpendChannelRedeemerSchema(hex.EncodeToString(redeemer.Data))
			if err != nil {
				return nil, err
			}
			eventType := channeltypes.EventTypeChannelOpenAck
			switch spendChannelRedeemer.Type {
			case ibc_types.ChanOpenAck:
				eventType = channeltypes.EventTypeChannelOpenAck
				event, err = helpers.NormalizeEventFromChannelDatum(*channDatumDecoded, connId, channelId, eventType)
			case ibc_types.ChanOpenConfirm:
				eventType = channeltypes.EventTypeChannelOpenConfirm
				event, err = helpers.NormalizeEventFromChannelDatum(*channDatumDecoded, connId, channelId, eventType)
			case ibc_types.ChanCloseInit:
				eventType = channeltypes.EventTypeChannelCloseInit
				event, err = helpers.NormalizeEventFromChannelDatum(*channDatumDecoded, connId, channelId, eventType)
			case ibc_types.ChanCloseConfirm:
				eventType = channeltypes.EventTypeChannelCloseConfirm
				event, err = helpers.NormalizeEventFromChannelDatum(*channDatumDecoded, connId, channelId, eventType)
			case ibc_types.AcknowledgePacket:
			case ibc_types.TimeoutPacket:
			case ibc_types.SendPacket:
				event, err = helpers.NormalizeEventPacketFromChannelRedeemer(spendChannelRedeemer, *channDatumDecoded)
			case ibc_types.RecvPacket:
				ibcModuleRedeemers, err := gw.DBService.QueryRedeemersByTransactionId(channUTxO.TxId, "", chainHandler.Modules.Transfer.Address)
				if err != nil {
					return nil, err
				}
				if len(ibcModuleRedeemers) > 0 {
					ibcModuleRedeemer, err := ibc_types.DecodeIBCModuleRedeemerSchema(hex.EncodeToString(ibcModuleRedeemers[0].Data))
					if err != nil {
						return nil, err
					}
					recvPacketEvents, err := helpers.NormalizeEventRecvPacketFromIBCModuleRedeemer(spendChannelRedeemer, *channDatumDecoded, *ibcModuleRedeemer)
					if err != nil {
						return nil, err
					}

					return &abci.ResponseDeliverTx{
						Code:   0,
						Events: recvPacketEvents,
					}, nil
				}
			}

		}
	}
	return &abci.ResponseDeliverTx{
		Code: 0,
		Events: []abci.Event{
			event,
		},
	}, nil
}

func (gw *Gateway) unmarshalClientEvents(clientUTxOs []dto.UtxoRawDto) (*abci.ResponseDeliverTx, error) {
	chainHandler, _ := helpers.GetChainHandler()
	var event abci.Event
	firstSnapshotIdx := slices.IndexFunc(clientUTxOs, func(c dto.UtxoRawDto) bool {
		return hex.EncodeToString(c.AssetsPolicy) == chainHandler.HandlerAuthToken.PolicyID
	})
	for _, utxo := range clientUTxOs {
		if hex.EncodeToString(utxo.AssetsPolicy) != chainHandler.Validators.MintClient.ScriptHash {
			continue
		}
		clientId := helpers.GetEntityIdFromTokenName(hex.EncodeToString(utxo.AssetsName), helpers.AuthToken{
			chainHandler.HandlerAuthToken.PolicyID,
			chainHandler.HandlerAuthToken.Name,
		}, constant.CLIENT_PREFIX)
		clientDatum, err := ibc_types.DecodeClientDatumSchema(hex.EncodeToString(utxo.Datum))
		if err != nil {
			return nil, err
		}
		clientRedeemers, err := gw.DBService.QueryRedeemersByTransactionId(utxo.TxId, chainHandler.Validators.MintClient.ScriptHash, chainHandler.Validators.SpendClient.Address)
		if err != nil {
			return nil, err
		}
		spendClientIdx := slices.IndexFunc(clientRedeemers, func(c dto.RedeemerDto) bool { return c.Type == "spend" })
		var spendClientRedeemer *ibc_types.SpendClientRedeemerSchema
		if spendClientIdx != -1 {
			spendClient := clientRedeemers[spendClientIdx]
			spendClientRD, _ := ibc_types.DecodeSpendClientRedeemerSchema(hex.EncodeToString(spendClient.Data))
			spendClientRedeemer = &spendClientRD
		}

		if err != nil {
			return nil, err
		}
		eventClient := clienttypes.EventTypeCreateClient
		if firstSnapshotIdx == -1 {
			eventClient = clienttypes.EventTypeUpdateClient
		}
		event, err = helpers.NormalizeEventFromClientDatum(*clientDatum, spendClientRedeemer, clientId, eventClient)
		if err != nil {
			return nil, err
		}
	}

	if event.Type == "" {
		return nil, nil
	}
	return &abci.ResponseDeliverTx{
		Code: 0,
		Events: []abci.Event{
			event,
		},
	}, nil
}

func (gw *Gateway) QueryClientState(clientId string, height uint64) (ibcexported.ClientState, []byte, *clienttypes.Height, error) {
	clientDatum, spendClientUTXO, err := gw.GetClientDatum(clientId, height)
	if err != nil {
		return nil, nil, nil, err
	}
	clientState := &tmclient.ClientState{
		ChainId: string(clientDatum.State.ClientState.ChainId),
		TrustLevel: tmclient.Fraction{
			Numerator:   clientDatum.State.ClientState.TrustLevel.Numerator,
			Denominator: clientDatum.State.ClientState.TrustLevel.Denominator,
		},
		TrustingPeriod:  time.Duration(clientDatum.State.ClientState.TrustingPeriod),
		UnbondingPeriod: time.Duration(clientDatum.State.ClientState.UnbondingPeriod),
		MaxClockDrift:   time.Duration(clientDatum.State.ClientState.MaxClockDrift),
		FrozenHeight: clienttypes.Height{
			RevisionNumber: clientDatum.State.ClientState.FrozenHeight.RevisionNumber,
			RevisionHeight: clientDatum.State.ClientState.FrozenHeight.RevisionHeight,
		},
		LatestHeight: clienttypes.Height{
			RevisionNumber: clientDatum.State.ClientState.LatestHeight.RevisionNumber,
			RevisionHeight: clientDatum.State.ClientState.LatestHeight.RevisionHeight,
		},
		ProofSpecs:                   types.GetSDKSpecs(),
		UpgradePath:                  nil,
		AllowUpdateAfterExpiry:       false,
		AllowUpdateAfterMisbehaviour: false,
	}

	hash := spendClientUTXO.TxHash[2:]
	proof := ""

	err = retry.Do(func() error {
		cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
		if err != nil {
			return err
		}
		if len(cardanoTxProof.CertifiedTransactions) == 0 {
			return fmt.Errorf("no certified transactions found")
		}
		proof = cardanoTxProof.CertifiedTransactions[0].Proof
		return nil
	}, retry.Attempts(5), retry.Delay(10*time.Second), retry.LastErrorOnly(true))

	if err != nil {
		return nil, nil, nil, err
	}

	return clientState, []byte(proof), &clienttypes.Height{
		RevisionNumber: 0,
		RevisionHeight: spendClientUTXO.BlockNo,
	}, nil

}

func (gw *Gateway) GetClientDatum(clientId string, height uint64) (*ibc_types.ClientDatumSchema, *dto.UtxoDto, error) {
	clientId = strings.Trim(clientId, "ibc_client-")
	clientIdNum, err := strconv.ParseInt(clientId, 10, 64)
	if err != nil {
		return nil, nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, nil, err

	}
	clientTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: chainHandler.HandlerAuthToken.PolicyID,
		Name:     chainHandler.HandlerAuthToken.Name,
	}, constant.CLIENT_PREFIX, clientIdNum)
	if err != nil {
		return nil, nil, err
	}
	handlerUtxos, err := gw.DBService.QueryClientOrAuthHandlerUTxOs(
		chainHandler.HandlerAuthToken.PolicyID,
		chainHandler.Validators.MintClient.ScriptHash,
		clientTokenName)
	if err != nil {
		return nil, nil, err
	}
	if len(handlerUtxos) == 0 {
		return nil, nil, fmt.Errorf("no utxos found for policyId %s and prefixTokenName %s", chainHandler.Validators.MintClient.ScriptHash, clientTokenName)
	}
	if handlerUtxos[0].Datum == nil {
		return nil, nil, fmt.Errorf("datum is nil")
	}
	dataString := hex.EncodeToString(handlerUtxos[0].Datum)
	handlerDatum, err := ibc_types.DecodeHandlerDatumSchema(dataString)
	if err != nil {
		return nil, nil, err
	}
	clientStateTokenName, err := helpers.GenerateTokenName(helpers.AuthToken{
		PolicyId: hex.EncodeToString(handlerDatum.Token.PolicyId),
		Name:     hex.EncodeToString(handlerDatum.Token.Name),
	}, constant.CLIENT_PREFIX, clientIdNum)
	if err != nil {
		return nil, nil, err
	}
	clientUtxos, err := gw.DBService.FindUtxosByPolicyIdAndPrefixTokenName(
		chainHandler.Validators.MintClient.ScriptHash,
		clientStateTokenName)
	if err != nil {
		return nil, nil, err
	}
	if clientUtxos[0].Datum == nil {
		return nil, nil, fmt.Errorf("datum is nil")
	}
	dataString = *clientUtxos[0].Datum
	clientDatum, err := ibc_types.DecodeClientDatumSchema(dataString[2:])
	if err != nil {
		return nil, nil, err
	}
	return clientDatum, &clientUtxos[0], nil
}
