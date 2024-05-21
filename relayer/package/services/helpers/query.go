package helpers

import (
	"github.com/cardano/relayer/v1/package/mithril/dtos"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
)

func ConvertMithrilStakeDistribution(stakeDistribution dtos.MithrilStakeDistribution, stakeDistributionCertificate dtos.CertificateDetail) *mithril.MithrilStakeDistribution {
	signerWithStake := make([]*mithril.SignerWithStake, 0)
	for _, signer := range stakeDistributionCertificate.Metadata.Signers {
		signerWithStake = append(signerWithStake, &mithril.SignerWithStake{
			Stake:   signer.Stake,
			PartyId: signer.PartyID,
		})
	}
	return &mithril.MithrilStakeDistribution{
		Epoch:            stakeDistribution.Epoch,
		SignersWithStake: signerWithStake,
		Hash:             stakeDistribution.Hash,
		CertificateHash:  stakeDistribution.CertificateHash,
		CreatedAt:        uint64(stakeDistribution.CreatedAt.UnixNano()),
		ProtocolParameter: &mithril.MithrilProtocolParameters{
			K: stakeDistributionCertificate.Metadata.Parameters.K,
			M: stakeDistributionCertificate.Metadata.Parameters.M,
			PhiF: mithril.Fraction{
				Numerator:   floatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Numerator,
				Denominator: floatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Denominator,
			},
		},
	}
}

func ConvertMithrilStakeDistributionCertificate(stakeDistribution dtos.MithrilStakeDistribution, stakeDistributionCertificate dtos.CertificateDetail) *mithril.MithrilCertificate {
	return &mithril.MithrilCertificate{
		Hash:         stakeDistributionCertificate.Hash,
		PreviousHash: stakeDistributionCertificate.PreviousHash,
		Epoch:        stakeDistributionCertificate.Epoch,
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
	}
}
