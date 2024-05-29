package mithril

import (
	"fmt"
	"sidechain/x/clients/mithril/common/entities"
	"sidechain/x/clients/mithril/crypto"

	errorsmod "cosmossdk.io/errors"
)

type MithrilCertificateRetriever interface {
	GetCertificateDetails(hash string) (*Certificate, error)
}

type MithrilCertificateVerifier struct {
	CertificateRetriever MithrilCertificateRetriever
}

func (v *MithrilCertificateVerifier) VerifyMultiSignature(
	message []byte,
	multiSignature *entities.ProtocolMultiSignature,
	aggreagateVerificationKey entities.ProtocolAggregateVerificationKey,
	protocolParameters entities.ProtocolParameters,
) error {
	return multiSignature.Key.Verify(
		message,
		aggreagateVerificationKey.Key,
		&crypto.StmParameters{
			M:    protocolParameters.M,
			K:    protocolParameters.K,
			PhiF: protocolParameters.PhiF,
		},
	)
}

func (v *MithrilCertificateVerifier) VerifyStandardCertificate(
	certificate *Certificate,
	signature *entities.ProtocolMultiSignature,
) (*Certificate, error) {
	if err := v.VerifyMultiSignature(
		[]byte(certificate.SignedMessage),
		signature,
		certificate.AggregateVerificationKey,
		certificate.Metadata.ProtocolParameters); err != nil {
		return nil, err
	}

	previousCertificate, err := v.CertificateRetriever.GetCertificateDetails(certificate.PreviousHash)
	if err != nil {
		return nil, err
	}

	if previousCertificate.Hash != certificate.PreviousHash {
		return nil, fmt.Errorf("certificate chain previous hash unmatch")
	}

	currentCertificateAVK, err := certificate.AggregateVerificationKey.ToJsonHex()
	if err != nil {
		return nil, err
	}
	previousCertificateAVK, err := certificate.AggregateVerificationKey.ToJsonHex()
	if err != nil {
		return nil, err
	}

	validCertificateHasDifferentEpochAsPrevious := func(nextAggregateVerificationKey string) bool {
		return nextAggregateVerificationKey == currentCertificateAVK && previousCertificate.Epoch != certificate.Epoch
	}
	validCertificateHasSameEpochAsPrevious := func() bool {
		return previousCertificateAVK == currentCertificateAVK && previousCertificate.Epoch == certificate.Epoch
	}

	nextAggregateVerificationKey, ok := previousCertificate.ProtocolMessage.GetMessagePart("next_aggregate_verification_key")
	if ok {
		nextAvk, err := FromAvkProto(string(nextAggregateVerificationKey))
		if err != nil {
			return nil, err
		}
		nextAvkJson, err := nextAvk.ToJsonHex()
		if err != nil {
			return nil, err
		}

		if validCertificateHasDifferentEpochAsPrevious(nextAvkJson) {
			return previousCertificate, nil
		}
		if validCertificateHasSameEpochAsPrevious() {
			return previousCertificate, nil
		}
		return nil, errorsmod.Wrapf(ErrInvalidCertificate, "currentAvk and nextAvk are not match")
	}
	return nil, errorsmod.Wrapf(ErrInvalidCertificate, "can not get nextAvk from previous certificate")
}
