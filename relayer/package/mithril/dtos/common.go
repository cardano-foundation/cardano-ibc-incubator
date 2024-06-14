package dtos

type Beacon struct {
	Network             string `json:"network"`
	Epoch               uint64 `json:"epoch"`
	ImmutableFileNumber uint64 `json:"immutable_file_number,omitempty"`
}

// Parameters holds the nested parameters
type Parameters struct {
	K    uint64  `json:"k"`
	M    uint64  `json:"m"`
	PhiF float64 `json:"phi_f"`
}

// CertificateMetadata holds the metadata of a certificate
type CertificateMetadataBase struct {
	Network     string     `json:"network"`
	Version     string     `json:"version"`
	Parameters  Parameters `json:"parameters"`
	InitiatedAt string     `json:"initiated_at"`
	SealedAt    string     `json:"sealed_at"`
}

// MessageParts represents the parts of the protocol message
type MessageParts struct {
	SnapshotDigest                *string `json:"snapshot_digest"`
	NextAggregateVerificationKey  *string `json:"next_aggregate_verification_key"`
	CardanoTransactionsMerkleRoot *string `json:"cardano_transactions_merkle_root,omitempty"`
	LatestBlockNumber             *string `json:"latest_block_number,omitempty"`
}

// ProtocolMessage represents the protocol message structure
type ProtocolMessage struct {
	MessageParts MessageParts `json:"message_parts"`
}

// CardanoImmutableFilesFull represents the Cardano immutable files full entity
type CardanoImmutableFilesFull struct {
	Network             string `json:"network"`
	Epoch               uint64 `json:"epoch"`
	ImmutableFileNumber uint64 `json:"immutable_file_number"`
}

// CardanoTransactions represents the Cardano transactions entity
type CardanoTransactions struct {
	Network             string `json:"network"`
	Epoch               uint64 `json:"epoch"`
	ImmutableFileNumber uint64 `json:"immutable_file_number"`
}

type CardanoStakeDistribution struct {
	Epoch uint64 `json:"epoch"`
}

type EpochSetting struct {
	Epoch        uint64     `json:"epoch"`
	Protocol     Parameters `json:"protocol"`
	NextProtocol Parameters `json:"next_protocol"`
}

// SignedEntityType represents the signed entity type which can be either CardanoImmutableFilesFull or CardanoTransactions
type SignedEntityType struct {
	CardanoImmutableFilesFull *CardanoImmutableFilesFull `json:"CardanoImmutableFilesFull,omitempty"`
	CardanoTransactions       *[]uint64                  `json:"CardanoTransactions,omitempty"`
	MithrilStakeDistribution  *uint64                    `json:"MithrilStakeDistribution,omitempty"`
	CardanoStakeDistribution  *CardanoStakeDistribution  `json:"CardanoStakeDistribution,omitempty"`
}
