package services

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	ibc_types "github.com/cardano/relayer/v1/package/services/ibc-types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v7/modules/core/23-commitment/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	ibcclient "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/types"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	"slices"
	"strconv"
	"strings"
	"time"

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
	snapshotIdx := slices.IndexFunc(cardanoTxsSetSnapshot, func(c dtos.CardanoTransactionSetSnapshot) bool { return c.Beacon.ImmutableFileNumber == uint64(h) })
	if snapshotIdx == -1 {
		latestHeight := cardanoTxsSetSnapshot[0].Beacon.ImmutableFileNumber
		if h < int64(latestHeight) {
			return nil, errors.New(fmt.Sprintf("SkipImmutableFile: Missing mithril height %d", h))
		}
		return nil, errors.New(fmt.Sprintf("Could not find snapshot with height %d", h))
	}

	snapshot := &cardanoTxsSetSnapshot[snapshotIdx]
	snapshotCertificate, err := gw.MithrilService.GetCertificateByHash(snapshot.CertificateHash)
	if err != nil {
		return nil, err
	}
	if cs.CurrentEpoch < snapshot.Beacon.Epoch {
		//fmt.Printf("Client State has Current epoch: %v, ", cs.CurrentEpoch)
		//fmt.Printf("Snapshot has epoch: %v \n", snapshot.Beacon.Epoch)
		return gw.QueryIBCGenesisCertHeader(ctx, int64(cs.CurrentEpoch+1))
	}

	mithrilStakeDistributionList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, err
	}

	mithrilStakeDistributionIdx := slices.IndexFunc(mithrilStakeDistributionList, func(c dtos.MithrilStakeDistribution) bool { return c.Epoch == snapshot.Beacon.Epoch })
	if mithrilStakeDistributionIdx == -1 {
		return nil, errors.New(fmt.Sprintf("Could not find stake distribution with epoch %d", snapshot.Beacon.Epoch))
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
			SnapshotHash:    snapshot.Hash,
			MerkleRoot:      snapshot.MerkleRoot,
			CertificateHash: snapshot.CertificateHash,
			Epoch:           snapshot.Beacon.Epoch,
			Height: &mithril.Height{
				MithrilHeight: snapshot.Beacon.ImmutableFileNumber,
			},
		},
		TransactionSnapshotCertificate: helpers.ConvertMithrilStakeDistributionCertificate(dtos.MithrilStakeDistribution{
			Hash:            snapshot.Hash,
			Epoch:           snapshot.Beacon.Epoch,
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
	latestSnapshotCertificate, err := gw.MithrilService.GetCertificateByHash(latestSnapshot.CertificateHash)
	if err != nil {
		return nil, nil, err
	}

	phifFraction := helpers.FloatToFraction(currentEpochSettings.Protocol.PhiF)
	clientState := &mithril.ClientState{
		ChainId: os.Getenv(constant.CardanoChainNetworkMagic),
		LatestHeight: &mithril.Height{
			MithrilHeight: latestSnapshotCertificate.Beacon.ImmutableFileNumber,
		},
		FrozenHeight: &mithril.Height{
			MithrilHeight: 0,
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
	firstSnapshotIdx := slices.IndexFunc(cardanoTxsSetSnapshotReverse, func(c dtos.CardanoTransactionSetSnapshot) bool { return c.Beacon.Epoch == uint64(epoch) })
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
			SnapshotHash:    firstSnapshot.Hash,
			MerkleRoot:      firstSnapshot.MerkleRoot,
			CertificateHash: firstSnapshot.CertificateHash,
			Epoch:           firstSnapshot.Beacon.Epoch,
			Height: &mithril.Height{
				MithrilHeight: firstSnapshot.Beacon.ImmutableFileNumber,
			},
		},
		TransactionSnapshotCertificate: helpers.ConvertMithrilStakeDistributionCertificate(dtos.MithrilStakeDistribution{
			Hash:            firstSnapshot.Hash,
			Epoch:           firstSnapshot.Beacon.Epoch,
			CertificateHash: firstSnapshot.CertificateHash,
			CreatedAt:       firstSnapshot.CreatedAt,
		}, *snapshotCertificate),
	}

	return &mithrilHeader, nil
}

func (gw *Gateway) QueryBlockResultsDraft(ctx context.Context, height uint64) (*ibcclient.QueryBlockResultsResponse, error) {
	//req := ibcclient.QueryBlockResultsRequest{Height: height}
	var txsResults []*ibcclient.ResponseDeliverTx
	//res, err := gw.TypeProvider.BlockResults(ctx, &req)
	//if err != nil {
	//	return nil, err
	//}

	// get connection and channel UTxOs
	connAndChannelUTxOs, err := gw.DBService.QueryConnectionAndChannelUTxOs([]uint64{1}, "", "")
	if err != nil {
		return nil, err
	}
	chainHandler, err := helpers.GetChainHandler()
	if err != nil {
		return nil, err
	}

	for _, utxo := range connAndChannelUTxOs {
		switch utxo.AssetsPolicy {
		case chainHandler.Validators.MintConnection.ScriptHash:
			connEvents, err := gw.unmarshalConnectionEvent(utxo)
			if err != nil {
				return nil, err
			}
			txsResults = append(txsResults, connEvents...)
		case chainHandler.Validators.MintChannel.ScriptHash:
			channEvents, err := gw.unmarshalChannelEvent(utxo)
			if err != nil {
				return nil, err
			}
			txsResults = append(txsResults, channEvents...)
		}
	}
	// get client UTxOs
	return &ibcclient.QueryBlockResultsResponse{
		BlockResults: &ibcclient.ResultBlockResults{
			Height:     nil,
			TxsResults: txsResults,
		},
	}, nil
}

func (gw *Gateway) unmarshalConnectionEvent(connUTxO dto.UtxoDto) ([]*ibcclient.ResponseDeliverTx, error) {
	chainHandler, _ := helpers.GetChainHandler()
	// query redeemer of connection
	redeemers, err := gw.DBService.QueryRedeemersByTransactionId(string(connUTxO.TxId), chainHandler.Validators.MintConnection.ScriptHash, chainHandler.Validators.SpendConnection.Address)
	if err != nil {
		return nil, err
	}
	// decode redeemer connection
	for _, redeemer := range redeemers {
		fmt.Println(redeemer)
	}

	return nil, nil
}

func (gw *Gateway) unmarshalChannelEvent(channUTxO dto.UtxoDto) ([]*ibcclient.ResponseDeliverTx, error) {
	// query redeemer of connection
	// decode redeemer connection
	return nil, nil
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

	//hash := spendClientUTXO.TxHash[2:]
	//cardanoTxProof, err := gw.MithrilService.GetProofOfACardanoTransactionList(hash)
	//if err != nil {
	//	return nil, nil, nil, err
	//}
	//connectionProof := cardanoTxProof.CertifiedTransactions[0].Proof
	return clientState, []byte(""), &clienttypes.Height{
		RevisionNumber: 0,
		RevisionHeight: uint64(spendClientUTXO.BlockNo),
	}, nil

}

func (gw *Gateway) GetClientDatum(clientId string, height uint64) (*ibc_types.ClientDatum, *dto.UtxoDto, error) {
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

	handlerUtxos, err := gw.DBService.FindUtxoClientOrAuthHandler(
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
	dataString := *handlerUtxos[0].Datum
	handlerDatum, err := ibc_types.DecodeHandlerDatumSchema(dataString[2:])
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
