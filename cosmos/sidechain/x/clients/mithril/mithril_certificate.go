package mithril

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"hash"
	math "math"
)

type FeedHasher interface {
	FeedHash(hasher hash.Hash)
}

type MithrilCertificateVerifier struct{}

func (v *MithrilCertificateVerifier) VerifyMultiSignature(message []byte, multiSignature *ProtocolMultiSignature, aggregateVerificationKey []byte, protocolParameters *MithrilProtocolParameters) (bool, error) {
	return multiSignature.Verify(
		message,
		aggregateVerificationKey,
		protocolParameters,
	)
}

func (pms *ProtocolMultiSignature) Verify(message []byte, avk []byte, parameters *MithrilProtocolParameters) (bool, error)

func (c *MithrilCertificate) ComputeHash() string {
	hasher := sha256.New()

	// Updating hasher with previous hash.
	hasher.Write([]byte(c.PreviousHash))

	// Updating hasher with epoch in big-endian bytes.
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, c.Epoch)
	hasher.Write(epochBytes)

	// Updating hasher with hashes of metadata, protocol message.
	hasher.Write([]byte(c.Metadata.ComputeHash()))
	hasher.Write([]byte(c.ProtocolMessage.ComputeHash()))

	// Updating hasher with signed message.
	hasher.Write([]byte(c.SignedMessage))

	// Updating hasher with aggregate verification key in JSON hex.
	keyJSON, _ := json.Marshal(c.AggregateVerificationKey)
	hasher.Write([]byte(hex.EncodeToString(keyJSON)))

	// Updating hasher based on the type of signature.
	switch s := c.Signature.SigType.(type) {
	case *CertificateSignature_GenesisSignature:
		hasher.Write([]byte(s.GenesisSignature.ToBytesHex()))
	case *CertificateSignature_MultiSignature:
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

	// Finalize hashing and return hex encoded string.
	return hex.EncodeToString(hasher.Sum(nil))
}

// ComputeHash computes the hash of the CertificateMetadata.
func (m *CertificateMetadata) ComputeHash() string {
	hasher := sha256.New()

	// Update hasher with protocol version.
	hasher.Write([]byte(m.ProtocolVersion))

	// Update hasher with protocol parameters hash.
	if m.ProtocolParameters != nil {
		hasher.Write([]byte(m.ProtocolParameters.ComputeHash()))
	}

	// Update hasher with initiated at and sealed at times.
	initiatedBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(initiatedBytes, m.InitiatedAt)
	hasher.Write(initiatedBytes)

	sealedBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(sealedBytes, m.SealedAt)
	hasher.Write(sealedBytes)

	// Update hasher with hashes of each signer.
	for _, signer := range m.Signers {
		if signer != nil {
			hasher.Write([]byte(signer.ComputeHash()))
		}
	}

	// Finalize hashing and return hex encoded string.
	return hex.EncodeToString(hasher.Sum(nil))
}

// PhiFFixed provides a fixed-point representation of PhiF suitable for hashing.
func (mpp *MithrilProtocolParameters) PhiFFixed() uint64 {
	phi_f := (float64)(mpp.PhiF.Numerator) / (float64)(mpp.PhiF.Denominator)
	return uint64(math.Round(phi_f * 1e6)) // Adjust the multiplier to match the precision used in Rust.
}

// ComputeHash computes the hash of the MithrilProtocolParameters.
func (mpp *MithrilProtocolParameters) ComputeHash() string {
	hasher := sha256.New()

	// Convert K, M, and PhiF to bytes and update the hasher.
	kBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(kBytes, mpp.K)
	hasher.Write(kBytes)

	mBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(mBytes, mpp.M)
	hasher.Write(mBytes)

	phiFBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(phiFBytes, mpp.PhiFFixed())
	hasher.Write(phiFBytes)

	// Finalize hashing and return hex encoded string.
	return hex.EncodeToString(hasher.Sum(nil))
}

// ComputeHash computes the hash of a SignerWithStake.
func (s *SignerWithStake) ComputeHash() string {
	hasher := sha256.New()

	// Update the hasher with the PartyId as bytes.
	hasher.Write([]byte(s.PartyId))

	// Convert Stake to bytes and update the hasher.
	stakeBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(stakeBytes, s.Stake)
	hasher.Write(stakeBytes)

	// Finalize hashing and return hex encoded string.
	return hex.EncodeToString(hasher.Sum(nil))
}

// computeHash computes the hash of the ProtocolMessage.
func (pm *ProtocolMessage) ComputeHash() string {
	hasher := sha256.New()

	for _, part := range pm.MessageParts {
		// Convert the key (enum) to its string representation
		keyString := protocolMessagePartKeyToString(part.ProtocolMessagePartKey)
		hasher.Write([]byte(keyString))
		hasher.Write([]byte(part.ProtocolMessagePartValue))
	}

	return hex.EncodeToString(hasher.Sum(nil))
}

// protocolMessagePartKeyToString converts a ProtocolMessagePartKey enum to a string.
func protocolMessagePartKeyToString(key ProtocolMessagePartKey) string {
	switch key {
	case SNAPSHOT_DIGEST:
		return "snapshot_digest"
	case CARDANO_TRANSACTIONS_MERKLE_ROOT:
		return "cardano_transactions_merkle_root"
	case NEXT_AGGREGATE_VERIFICATION_KEY:
		return "next_aggregate_verification_key"
	case LATEST_IMMUTABLE_FILE_NUMBER:
		return "latest_immutable_file_number"
	default:
		return "unknown_key"
	}
}

func (csd *CardanoStakeDistribution) FeedHash(hasher hash.Hash) {
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, csd.Epoch)
	hasher.Write(epochBytes)
}

func (ciff *CardanoImmutableFilesFull) FeedHash(hasher hash.Hash) {
	hasher.Write([]byte(ciff.Beacon.Network))
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, ciff.Beacon.Epoch)
	hasher.Write(epochBytes)
	fileNumberBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(fileNumberBytes, ciff.Beacon.ImmutableFileNumber)
	hasher.Write(fileNumberBytes)
}

func (ct *CardanoTransactions) FeedHash(hasher hash.Hash) {
	hasher.Write([]byte(ct.Beacon.Network))
	epochBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(epochBytes, ct.Beacon.Epoch)
	hasher.Write(epochBytes)
	fileNumberBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(fileNumberBytes, ct.Beacon.ImmutableFileNumber)
	hasher.Write(fileNumberBytes)
}

func (gs *GenesisSignature) ToBytesHex() string {
	return hex.EncodeToString(gs.GetProtocolGenesisSignature().Signature)
}
