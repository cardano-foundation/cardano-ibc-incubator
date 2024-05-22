package entities

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sidechain/x/clients/mithril/crypto"
)

type ed25519Signature = []byte

type ProtocolGenesisSignature struct {
	Key ed25519Signature
}

func (s *ProtocolGenesisSignature) FromByteHex(hexString string) (*ProtocolGenesisSignature, error) {
	hexBytes, err := hex.DecodeString(hexString)
	if err != nil {
		return nil, fmt.Errorf("could not deserialize a ProtocolGenesisSignature from bytes hex string: could not convert the encoded string to bytes: %w", err)
	}

	return s.FromBytes(hexBytes)
}

func (s *ProtocolGenesisSignature) FromBytes(bytes []byte) (*ProtocolGenesisSignature, error) {
	if len(bytes) != ed25519.SignatureSize {
		return nil, errors.New("could not deserialize a ProtocolGenesisSignature from bytes hex string: invalid bytes")
	}

	var key ed25519Signature
	copy(key[:], bytes)

	s.Key = key

	return s, nil
}

func (s *ProtocolGenesisSignature) ToBytesHex() string {
	return s.KeyToBytesHex(s.Key)
}

func (s *ProtocolGenesisSignature) KeyToBytesHex(key ed25519Signature) string {
	return hex.EncodeToString(key[:])
}

type ProtocolAggregateVerificationKey struct {
	Key *crypto.StmAggrVerificationKey
}

func (k *ProtocolAggregateVerificationKey) ToJsonHex() (string, error) {
	keyBytes, err := json.Marshal(k)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(keyBytes), nil
}
