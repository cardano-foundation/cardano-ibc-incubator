package mithril

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"hash"
	"sidechain/x/clients/mithril/common/entities"
	"sidechain/x/clients/mithril/crypto"
	"time"

	errorsmod "cosmossdk.io/errors"
	"golang.org/x/crypto/blake2b"
)

const LayoutMicros = "2006-01-02T15:04:05.000000Z"
const Layout = "2006-01-02T15:04:05.000000000Z"

type FeedHasher interface {
	FeedHash(hasher hash.Hash)
}

type GenesisSignature struct {
	*entities.ProtocolGenesisSignature
}

type MultiSignature struct {
	SignedEntityType       *entities.SignedEntityType
	ProtocolMultiSignature *entities.ProtocolMultiSignature
}

type CertificateSignature struct {
	GenesisSignature *GenesisSignature
	MultiSignature   *MultiSignature
}

func (gs *GenesisSignature) ToBytesHex() string {
	return hex.EncodeToString(gs.ProtocolGenesisSignature.Key)
}

type Certificate struct {
	Hash                     string
	PreviousHash             string
	Epoch                    entities.Epoch
	Metadata                 entities.CertificateMetadata
	ProtocolMessage          entities.ProtocolMessage
	SignedMessage            string
	AggregateVerificationKey entities.ProtocolAggregateVerificationKey
	Signature                CertificateSignature
}

func NewCertificate(previousHash string, epoch entities.Epoch, metadata entities.CertificateMetadata, protocolMessage entities.ProtocolMessage, aggregateVerificationKey entities.ProtocolAggregateVerificationKey, signature CertificateSignature) Certificate {
	signedMessage := protocolMessage.ComputeHash()
	certificate := Certificate{
		Hash:                     "",
		PreviousHash:             previousHash,
		Epoch:                    epoch,
		Metadata:                 metadata,
		ProtocolMessage:          protocolMessage,
		SignedMessage:            signedMessage,
		AggregateVerificationKey: aggregateVerificationKey,
		Signature:                signature,
	}
	certificate.Hash = certificate.ComputeHash()
	return certificate
}

func (c *Certificate) ComputeHash() string {
	hasher := sha256.New()
	hasher.Write([]byte(c.PreviousHash))

	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, uint64(c.Epoch))
	hasher.Write(epochBytes)

	hasher.Write([]byte(c.Metadata.ComputeHash()))
	hasher.Write([]byte(c.ProtocolMessage.ComputeHash()))
	hasher.Write([]byte(c.SignedMessage))

	keyJSON, _ := json.Marshal(c.AggregateVerificationKey)
	hasher.Write([]byte(hex.EncodeToString(keyJSON)))

	if c.Signature.GenesisSignature != nil {
		hasher.Write([]byte(c.Signature.GenesisSignature.ToBytesHex()))
	} else {
		c.Signature.MultiSignature.SignedEntityType.FeedHash(hasher)
		if c.Signature.MultiSignature != nil {
			signatureJSON, err := json.Marshal(c.Signature.MultiSignature)
			if err != nil {
				// Handle error appropriately
				panic("Failed to marshal MultiSignature: " + err.Error())
			}
			hasher.Write([]byte(hex.EncodeToString(signatureJSON)))
		}
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func (c *Certificate) IsGenesis() bool {
	return c.Signature.GenesisSignature != nil
}

func (c *Certificate) IsChainingToItself() bool {
	return c.Hash == c.PreviousHash
}

func (c *Certificate) MatchMessage(message entities.ProtocolMessage) bool {
	return message.ComputeHash() == c.SignedMessage
}

func FromCertificateProto(mc *MithrilCertificate) (*Certificate, error) {
	metadata, err := FromCertificateMetadataProto(mc.Metadata)
	if err != nil {
		return nil, err
	}

	pm, err := FromProtocolMessageProto(mc.ProtocolMessage)
	if err != nil {
		return nil, err
	}

	avk, err := FromAvkProto(mc.AggregateVerificationKey)
	if err != nil {
		return nil, err
	}

	signature, err := FromCertificateSignatureProto(mc.SignedEntityType, mc.MultiSignature, mc.GenesisSignature)
	if err != nil {
		return nil, err
	}

	cert := &Certificate{
		Hash:                     mc.Hash,
		PreviousHash:             mc.PreviousHash,
		Epoch:                    entities.Epoch(mc.Epoch),
		Metadata:                 *metadata,
		ProtocolMessage:          *pm,
		SignedMessage:            mc.SignedMessage,
		AggregateVerificationKey: *avk,
		Signature:                *signature,
	}

	return cert, nil
}

func FromCertificateMetadataProto(metadata *CertificateMetadata) (*entities.CertificateMetadata, error) {
	pp, err := FromProtocolParametersProto(metadata.ProtocolParameters)
	if err != nil {
		return nil, err
	}

	initiatedAt, err := time.Parse(LayoutMicros, metadata.InitiatedAt)
	if err != nil {
		return nil, err
	}
	sealedAt, err := time.Parse(Layout, metadata.SealedAt)
	if err != nil {
		return nil, err
	}
	signers := []entities.StakeDistributionParty{}
	for _, signer := range metadata.Signers {
		signers = append(signers, entities.StakeDistributionParty{
			PartyId: signer.PartyId,
			Stake:   signer.Stake,
		})
	}
	return &entities.CertificateMetadata{
		Network:            metadata.Network,
		ProtocolVersion:    metadata.ProtocolVersion,
		ProtocolParameters: *pp,
		InitiatedAt:        initiatedAt,
		SealedAt:           sealedAt,
		Signers:            signers,
	}, nil
}

func FromProtocolParametersProto(pp *MithrilProtocolParameters) (*entities.ProtocolParameters, error) {
	if pp.K == 0 {
		return nil, errorsmod.Wrapf(ErrInvalidNumberRequiredSignatures, "number of required signatures should be greater than 0")
	}
	if pp.M == 0 {
		return nil, errorsmod.Wrapf(ErrInvalidNumberLotteries, "number of lotteries should be greater than 0")
	}

	if pp.PhiF.Numerator == 0 || pp.PhiF.Denominator == 0 || pp.PhiF.Numerator > pp.PhiF.Denominator {
		return nil, errorsmod.Wrapf(ErrInvalidChanceWinLottery, "chance of a signer to win a lottery should be greater than 0 and less than or equal to 1 (phiF/100)")
	}

	return &entities.ProtocolParameters{
		K:    pp.K,
		M:    pp.M,
		PhiF: float64(pp.PhiF.Numerator) / float64(pp.PhiF.Denominator),
	}, nil
}

func FromProtocolMessageProto(pmProto *ProtocolMessage) (*entities.ProtocolMessage, error) {
	pm := &entities.ProtocolMessage{
		MessageParts: map[entities.ProtocolMessagePartKey]entities.ProtocolMessagePartValue{},
	}

	for _, mp := range pmProto.MessageParts {
		switch mp.ProtocolMessagePartKey {
		case 0:
			return nil, errorsmod.Wrapf(ErrInvalidMessagePartKey, "message part key shouldn't be unspecified")
		case 1:
			pm.MessageParts["snapshot_digest"] = entities.ProtocolMessagePartValue(mp.ProtocolMessagePartValue)
		case 2:
			pm.MessageParts["cardano_transactions_merkle_root"] = entities.ProtocolMessagePartValue(mp.ProtocolMessagePartValue)
		case 3:
			pm.MessageParts["next_aggregate_verification_key"] = entities.ProtocolMessagePartValue(mp.ProtocolMessagePartValue)
		case 4:
			pm.MessageParts["latest_immutable_file_number"] = entities.ProtocolMessagePartValue(mp.ProtocolMessagePartValue)
		}
	}
	return pm, nil
}

func FromAvkProto(avkProto string) (*entities.ProtocolAggregateVerificationKey, error) {
	avkKey := &crypto.StmAggrVerificationKey{}
	avkKeyBytes, err := hex.DecodeString(avkProto)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(avkKeyBytes, avkKey)
	if err != nil {
		return nil, err
	}
	if avkKey.MTCommitment.Hasher == nil {
		hasher, err := blake2b.New256(nil)
		if err != nil {
			return nil, err
		}
		avkKey.MTCommitment.Hasher = hasher
	}
	return &entities.ProtocolAggregateVerificationKey{
		Key: avkKey,
	}, nil
}

func FromCertificateSignatureProto(setProto *SignedEntityType, multiSigProto string, genesisSigProto string) (*CertificateSignature, error) {
	if multiSigProto != "" {
		set := &entities.SignedEntityType{}
		switch s := setProto.Entity.(type) {
		case *SignedEntityType_MithrilStakeDistribution:
			set.MithrilStakeDistribution = &entities.MithrilStakeDistribution{
				Epoch: entities.Epoch(s.MithrilStakeDistribution.Epoch),
			}
		case *SignedEntityType_CardanoStakeDistribution:
			set.CardanoStakeDistribution = &entities.CardanoStakeDistribution{
				Epoch: entities.Epoch(s.CardanoStakeDistribution.Epoch),
			}
		case *SignedEntityType_CardanoImmutableFilesFull:
			set.CardanoImmutableFilesFull = &entities.CardanoImmutableFilesFull{
				CardanoDbBeacon: &entities.CardanoDbBeacon{
					Network:             s.CardanoImmutableFilesFull.Beacon.Network,
					Epoch:               entities.Epoch(s.CardanoImmutableFilesFull.Beacon.Epoch),
					ImmutableFileNumber: s.CardanoImmutableFilesFull.Beacon.ImmutableFileNumber,
				},
			}
		case *SignedEntityType_CardanoTransactions:
			set.CardanoTransactions = &entities.CardanoTransactions{
				Epoch:       entities.Epoch(s.CardanoTransactions.Epoch),
				BlockNumber: s.CardanoTransactions.BlockNumber,
			}
		}

		stmAggrSig := &crypto.StmAggrSig{}
		stmAggrSigBytes, err := hex.DecodeString(multiSigProto)
		if err != nil {
			return nil, err
		}
		err = json.Unmarshal(stmAggrSigBytes, stmAggrSig)
		if err != nil {
			return nil, err
		}
		if stmAggrSig.BatchProof.Hasher == nil {
			hasher, err := blake2b.New256(nil)
			if err != nil {
				return nil, err
			}
			stmAggrSig.BatchProof.Hasher = hasher
		}
		return &CertificateSignature{
			MultiSignature: &MultiSignature{
				SignedEntityType: set,
				ProtocolMultiSignature: &entities.ProtocolMultiSignature{
					Key: stmAggrSig,
				},
			},
		}, nil
	} else {
		// TO-DO: support genesis signature later
		return nil, errorsmod.Wrapf(ErrUnsupportedGenesisSignature, "genesis signature is not supported")
	}
}
