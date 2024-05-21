package services

import (
	"context"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
)

func (gw *Gateway) QueryIBCHeader(ctx context.Context, h int64) (*mithril.MithrilHeader, error) {
	//res, err := gw.TypeProvider.IBCHeader(ctx, &ibcclient.QueryIBCHeaderRequest{Height: uint64(h)})
	//if err != nil {
	//	return nil, err
	//}

	mithrilStakeDistributionList, err := gw.MithrilService.GetListMithrilStakeDistributions()
	if err != nil {
		return nil, err
	}
	mithrilStakeDistribution := mithrilStakeDistributionList[0]
	mithrilDistributionCertificate, err := gw.MithrilService.GetCertificateByHash(mithrilStakeDistribution.CertificateHash)
	if err != nil {
		return nil, err
	}

	mithrilHeader := mithril.MithrilHeader{
		MithrilStakeDistribution: helpers.ConvertMithrilStakeDistribution(mithrilStakeDistribution, *mithrilDistributionCertificate),
		MithrilStakeDistributionCertificate: &mithril.MithrilCertificate{
			Hash:         "",
			PreviousHash: "",
			Epoch:        0,
			SignedEntityType: &mithril.SignedEntityType{
				Entity: nil,
			},
			Metadata: &mithril.CertificateMetadata{
				ProtocolVersion: "",
				ProtocolParameters: &mithril.MithrilProtocolParameters{
					K: 0,
					M: 0,
					PhiF: mithril.Fraction{
						Numerator:   0,
						Denominator: 0,
					},
				},
				InitiatedAt: 0,
				SealedAt:    0,
				Signers:     nil,
			},
			ProtocolMessage: &mithril.ProtocolMessage{
				MessageParts: nil,
			},
			SignedMessage:            "",
			AggregateVerificationKey: "",
			Signature: &mithril.CertificateSignature{
				SigType: nil,
			},
		},
		TransactionSnapshot: &mithril.CardanoTransactionSnapshot{
			SnapshotHash:    "",
			MerkleRoot:      "",
			CertificateHash: "",
			Epoch:           0,
			Height: &mithril.Height{
				MithrilHeight: 0,
			},
		},
		TransactionSnapshotCertificate: &mithril.MithrilCertificate{
			Hash:         "",
			PreviousHash: "",
			Epoch:        0,
			SignedEntityType: &mithril.SignedEntityType{
				Entity: nil,
			},
			Metadata: &mithril.CertificateMetadata{
				ProtocolVersion: "",
				ProtocolParameters: &mithril.MithrilProtocolParameters{
					K: 0,
					M: 0,
					PhiF: mithril.Fraction{
						Numerator:   0,
						Denominator: 0,
					},
				},
				InitiatedAt: 0,
				SealedAt:    0,
				Signers:     nil,
			},
			ProtocolMessage: &mithril.ProtocolMessage{
				MessageParts: nil,
			},
			SignedMessage:            "",
			AggregateVerificationKey: "",
			Signature: &mithril.CertificateSignature{
				SigType: nil,
			},
		},
	}

	return &mithrilHeader, nil

}
