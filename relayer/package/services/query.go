package services

import (
	"context"
	"errors"
	"fmt"
	"github.com/cardano/relayer/v1/package/mithril/dtos"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
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
