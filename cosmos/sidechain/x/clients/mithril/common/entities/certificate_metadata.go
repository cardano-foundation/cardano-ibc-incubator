package entities

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"time"
)

type CertificateMetadata struct {
	Network             string
	ImmutableFileNumber ImmutableFileNumber
	ProtocolVersion     ProtocolVersion
	ProtocolParameters  ProtocolParameters
	InitiatedAt         time.Time
	SealedAt            time.Time
	Signers             []StakeDistributionParty
}

type StakeDistributionParty struct {
	PartyId PartyId
	Stake   Stake
}

func (p *StakeDistributionParty) ComputeHash() string {
	hasher := sha256.New()
	hasher.Write([]byte(p.PartyId))

	stakeBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(stakeBytes, uint64(p.Stake))
	hasher.Write(stakeBytes)

	return hex.EncodeToString(hasher.Sum(nil))
}

func (m *CertificateMetadata) ComputeHash() string {
	hasher := sha256.New()
	hasher.Write([]byte(m.Network))
	hasher.Write([]byte(m.ProtocolVersion))
	hasher.Write([]byte(m.ProtocolParameters.ComputeHash()))

	initiatedAtBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(initiatedAtBytes, uint64(m.InitiatedAt.UnixNano()))
	hasher.Write(initiatedAtBytes)

	sealedAtBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(sealedAtBytes, uint64(m.SealedAt.UnixNano()))
	hasher.Write(sealedAtBytes)

	for _, party := range m.Signers {
		hasher.Write([]byte(party.ComputeHash()))
	}

	return hex.EncodeToString(hasher.Sum(nil))
}
