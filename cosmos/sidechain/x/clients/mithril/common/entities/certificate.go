package entities

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"hash"
	"sidechain/x/clients/mithril"
)

type CertificateSignature = mithril.CertificateSignature

type FeedHasher interface {
	FeedHash(hasher hash.Hash)
}

type Certificate struct {
	Hash                     string
	PreviousHash             string
	Epoch                    Epoch
	Metadata                 CertificateMetadata
	ProtocolMessage          ProtocolMessage
	SignedMessage            string
	AggregateVerificationKey ProtocolAggregateVerificationKey
	Signature                CertificateSignature
}

func NewCertificate(previousHash string, epoch Epoch, metadata CertificateMetadata, protocolMessage ProtocolMessage, aggregateVerificationKey ProtocolAggregateVerificationKey, signature CertificateSignature) Certificate {
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

	switch s := c.Signature.SigType.(type) {
	case *mithril.CertificateSignature_GenesisSignature:
		hasher.Write([]byte(s.GenesisSignature.ToBytesHex()))
	case *mithril.CertificateSignature_MultiSignature:
		if entity, ok := s.MultiSignature.EntityType.Entity.(FeedHasher); ok {
			entity.FeedHash(hasher)
		}
		if s.MultiSignature.Signature != nil {
			signatureJSON, err := json.Marshal(s.MultiSignature.Signature)
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
	switch c.Signature.SigType.(type) {
	case *mithril.CertificateSignature_GenesisSignature:
		return true
	default:
		return false
	}
}

func (c *Certificate) IsChainingToItself() bool {
	return c.Hash == c.PreviousHash
}

func (c *Certificate) MatchMessage(message ProtocolMessage) bool {
	return message.ComputeHash() == c.SignedMessage
}
