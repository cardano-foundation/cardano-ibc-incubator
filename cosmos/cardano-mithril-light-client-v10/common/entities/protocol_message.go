package entities

import (
	"crypto/sha256"
	"encoding/hex"
)

type ProtocolMessagePartKey string

const (
	SnapshotDigest                ProtocolMessagePartKey = "SnapshotDigest"
	CardanoTransactionsMerkleRoot ProtocolMessagePartKey = "CardanoTransactionsMerkleRoot"
	NextAggregateVerificationKey  ProtocolMessagePartKey = "NextAggregateVerificationKey"
	LatestImmutableFileNumber     ProtocolMessagePartKey = "LatestImmutableFileNumber"
)

func (k ProtocolMessagePartKey) String() string {
	switch k {
	case SnapshotDigest:
		return "snapshot_digest"
	case NextAggregateVerificationKey:
		return "next_aggregate_verification_key"
	case CardanoTransactionsMerkleRoot:
		return "cardano_transactions_merkle_root"
	case LatestImmutableFileNumber:
		return "latest_immutable_file_number"
	}
	return ""
}

type ProtocolMessagePartValue string

type ProtocolMessage struct {
	MessageParts map[ProtocolMessagePartKey]ProtocolMessagePartValue
}

func NewProtocolMessage() *ProtocolMessage {
	return &ProtocolMessage{
		MessageParts: make(map[ProtocolMessagePartKey]ProtocolMessagePartValue),
	}
}

func (pm *ProtocolMessage) SetMessagePart(
	key ProtocolMessagePartKey,
	value ProtocolMessagePartValue,
) *ProtocolMessagePartValue {
	if oldValue, exists := pm.MessageParts[key]; exists {
		pm.MessageParts[key] = value
		return &oldValue
	}
	pm.MessageParts[key] = value
	return nil
}

func (pm *ProtocolMessage) GetMessagePart(
	key ProtocolMessagePartKey,
) (ProtocolMessagePartValue, bool) {
	value, exists := pm.MessageParts[key]
	return value, exists
}

func (pm *ProtocolMessage) ComputeHash() string {
	hasher := sha256.New()
	for key, value := range pm.MessageParts {
		hasher.Write([]byte(key.String()))
		hasher.Write([]byte(value))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}
