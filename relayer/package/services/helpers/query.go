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
		SignersWithStake: convertSignerWithStake(stakeDistributionCertificate.Metadata.Signers),
		Hash:             stakeDistribution.Hash,
		CertificateHash:  stakeDistribution.CertificateHash,
		CreatedAt:        uint64(stakeDistribution.CreatedAt.UnixNano()),
		ProtocolParameter: &mithril.MithrilProtocolParameters{
			K: stakeDistributionCertificate.Metadata.Parameters.K,
			M: stakeDistributionCertificate.Metadata.Parameters.M,
			PhiF: mithril.Fraction{
				Numerator:   FloatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Numerator,
				Denominator: FloatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Denominator,
			},
		},
	}
}

func convertSignerWithStake(stake []*dtos.Signer) []*mithril.SignerWithStake {
	var signerWS []*mithril.SignerWithStake
	for _, signer := range stake {
		signerWS = append(signerWS, &mithril.SignerWithStake{
			PartyId: signer.PartyID,
			Stake:   signer.Stake,
		})

	}
	return signerWS
}

func convertSignedEntityType(req *dtos.SignedEntityType, stakeDistribution dtos.MithrilStakeDistribution, stakeDistributionCertificate dtos.CertificateDetail) *mithril.SignedEntityType {
	if req.MithrilStakeDistribution != nil {
		return &mithril.SignedEntityType{
			Entity: &mithril.SignedEntityType_MithrilStakeDistribution{
				MithrilStakeDistribution: ConvertMithrilStakeDistribution(stakeDistribution, stakeDistributionCertificate),
			},
		}
	}
	if req.CardanoStakeDistribution != nil {
		return &mithril.SignedEntityType{
			Entity: &mithril.SignedEntityType_CardanoStakeDistribution{
				CardanoStakeDistribution: &mithril.CardanoStakeDistribution{
					Epoch: stakeDistribution.Epoch,
				},
			},
		}
	}

	if req.CardanoImmutableFilesFull != nil {
		return &mithril.SignedEntityType{
			Entity: &mithril.SignedEntityType_CardanoImmutableFilesFull{
				CardanoImmutableFilesFull: &mithril.CardanoImmutableFilesFull{
					Beacon: &mithril.CardanoDbBeacon{
						Network:             req.CardanoImmutableFilesFull.Network,
						Epoch:               req.CardanoImmutableFilesFull.Epoch,
						ImmutableFileNumber: req.CardanoImmutableFilesFull.ImmutableFileNumber,
					},
				},
			},
		}
	}

	if req.CardanoTransactions != nil {
		return &mithril.SignedEntityType{
			Entity: &mithril.SignedEntityType_CardanoTransactions{
				CardanoTransactions: &mithril.CardanoTransactions{
					Beacon: &mithril.CardanoDbBeacon{
						Network:             req.CardanoTransactions.Network,
						Epoch:               req.CardanoTransactions.Epoch,
						ImmutableFileNumber: req.CardanoTransactions.ImmutableFileNumber,
					},
				},
			},
		}
	}

	return nil
}

//func convertCertificateSignatureSigType(stakeDistribution dtos.MithrilStakeDistribution, stakeDistributionCertificate dtos.CertificateDetail) *mithril.CertificateSignature {
//	if stakeDistributionCertificate.GenesisSignature != "" {
//		signature, _ := hex.DecodeString(stakeDistributionCertificate.GenesisSignature)
//
//		return &mithril.CertificateSignature{
//			SigType: &mithril.CertificateSignature_GenesisSignature{
//				GenesisSignature: &mithril.GenesisSignature{
//					ProtocolGenesisSignature: &mithril.ProtocolGenesisSignature{
//						Signature: signature,
//					},
//				},
//			},
//		}
//	}
//
//	if stakeDistributionCertificate.MultiSignature != "" {
//		var multiSignature dtos.CertificateMultiSignature
//		json.Unmarshal([]byte(stakeDistributionCertificate.MultiSignature), &multiSignature)
//
//		batchProofBytes, err1 := json.Marshal(multiSignature.BatchProof)
//		if err1 != nil {
//			return nil
//		}
//
//		signatures := make([][]byte, 0)
//		for _, signature := range multiSignature.Signatures {
//			sigBytes, _ := json.Marshal(signature)
//			signatures = append(signatures, sigBytes)
//		}
//
//		return &mithril.CertificateSignature{
//			SigType: &mithril.CertificateSignature_MultiSignature{
//				MultiSignature: &mithril.MultiSignature{
//					EntityType: convertSignedEntityType(&stakeDistributionCertificate.SignedEntityType, stakeDistribution, stakeDistributionCertificate),
//					Signature: &mithril.ProtocolMultiSignature{
//						Signatures: signatures,
//						BatchProof: batchProofBytes,
//					},
//				},
//			},
//		}
//	}
//
//	return nil
//}

func convertMessageParts(messagePart dtos.MessageParts) []*mithril.MessagePart {
	var messageParts []*mithril.MessagePart

	if messagePart.NextAggregateVerificationKey != nil {
		element := &mithril.MessagePart{
			ProtocolMessagePartKey:   mithril.PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY,
			ProtocolMessagePartValue: *messagePart.NextAggregateVerificationKey,
		}
		messageParts = append(messageParts, element)
	}
	if messagePart.SnapshotDigest != nil {
		element := &mithril.MessagePart{
			ProtocolMessagePartKey:   mithril.PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST,
			ProtocolMessagePartValue: *messagePart.SnapshotDigest,
		}
		messageParts = append(messageParts, element)
	}
	if messagePart.CardanoTransactionsMerkleRoot != nil {
		element := &mithril.MessagePart{
			ProtocolMessagePartKey:   mithril.PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT,
			ProtocolMessagePartValue: *messagePart.CardanoTransactionsMerkleRoot,
		}
		messageParts = append(messageParts, element)
	}
	if messagePart.LatestImmutableFileNumber != nil {
		element := &mithril.MessagePart{
			ProtocolMessagePartKey:   mithril.PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER,
			ProtocolMessagePartValue: *messagePart.LatestImmutableFileNumber,
		}
		messageParts = append(messageParts, element)
	}

	return messageParts
}

func ConvertMithrilStakeDistributionCertificate(stakeDistribution dtos.MithrilStakeDistribution, stakeDistributionCertificate dtos.CertificateDetail) *mithril.MithrilCertificate {
	return &mithril.MithrilCertificate{
		Hash:             stakeDistributionCertificate.Hash,
		PreviousHash:     stakeDistributionCertificate.PreviousHash,
		Epoch:            stakeDistributionCertificate.Epoch,
		SignedEntityType: convertSignedEntityType(&stakeDistributionCertificate.SignedEntityType, stakeDistribution, stakeDistributionCertificate),
		Metadata: &mithril.CertificateMetadata{
			ProtocolVersion: stakeDistributionCertificate.Metadata.Version,
			ProtocolParameters: &mithril.MithrilProtocolParameters{
				K: stakeDistributionCertificate.Metadata.Parameters.K,
				M: stakeDistributionCertificate.Metadata.Parameters.M,
				PhiF: mithril.Fraction{
					Numerator:   FloatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Numerator,
					Denominator: FloatToFraction(stakeDistributionCertificate.Metadata.Parameters.PhiF).Denominator,
				},
			},
			InitiatedAt: stakeDistributionCertificate.Metadata.InitiatedAt,
			SealedAt:    stakeDistributionCertificate.Metadata.SealedAt,
			Signers:     convertSignerWithStake(stakeDistributionCertificate.Metadata.Signers),
		},
		ProtocolMessage: &mithril.ProtocolMessage{
			MessageParts: convertMessageParts(stakeDistributionCertificate.ProtocolMessage.MessageParts),
		},
		SignedMessage:            stakeDistributionCertificate.SignedMessage,
		AggregateVerificationKey: stakeDistributionCertificate.AggregateVerificationKey,
		MultiSignature:           stakeDistributionCertificate.MultiSignature,
		GenesisSignature:         stakeDistributionCertificate.GenesisSignature,
	}
}
