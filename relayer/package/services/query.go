package services

import (
	"context"
	"errors"
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"github.com/cardano/relayer/v1/package/mithril/dtos"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
	"os"
	"slices"
)

func (gw *Gateway) QueryIBCHeader(ctx context.Context, h int64) (*mithril.MithrilHeader, error) {
	mithrilStakeDistributionList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, err
	}
	mithrilStakeDistribution := mithrilStakeDistributionList[0]
	mithrilDistributionCertificate, err := gw.MithrilService.GetCertificateByHash(mithrilStakeDistribution.CertificateHash)
	if err != nil {
		return nil, err
	}

	cardanoTxsSetSnapshot, err := gw.MithrilService.GetCardanoTransactionsSetSnapshot()
	if err != nil {
		return nil, err
	}
	var snapshot *dtos.CardanoTransactionSetSnapshot
	for idx, cardanoTx := range cardanoTxsSetSnapshot {
		if cardanoTx.Beacon.ImmutableFileNumber == uint64(h) {
			snapshot = &cardanoTxsSetSnapshot[idx]
		}
	}
	if snapshot == nil {
		return nil, errors.New(fmt.Sprintf("Could not find snapshot with height %d", h))
	}
	snapshotCertificate, err := gw.MithrilService.GetCertificateByHash(snapshot.CertificateHash)
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
	latestCertificateMsd := dtos.CertificateOverall{}
	idx := slices.IndexFunc(certificateList, func(c dtos.CertificateOverall) bool { return c.Epoch == mithrilDistribution.Epoch })
	if idx == -1 {
		return nil, nil, fmt.Errorf("could not find certificate with epoch %d", mithrilDistribution.Epoch)
	}
	latestCertificateMsd = certificateList[idx]

	listSnapshots, err := gw.MithrilService.GetListSnapshots()
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
	timestamp := fcCertificateMsd.Metadata.SealedAt.UnixNano()
	consensusState := &mithril.ConsensusState{
		Timestamp:            uint64(timestamp),
		FcHashLatestEpochMsd: mithrilDistribution.CertificateHash,
		LatestCertHashMsd:    latestCertificateMsd.Hash,
		FcHashLatestEpochTs:  mithrilDistribution.CertificateHash,
		LatestCertHashTs:     latestSnapshot.CertificateHash,
	}
	return clientState, consensusState, nil
}
