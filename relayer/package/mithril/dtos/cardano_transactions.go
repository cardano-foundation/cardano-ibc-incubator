package dtos

import "time"

// CardanoTransactionSetSnapshot represents the Cardano transaction set snapshot data transfer object.
type CardanoTransactionSetSnapshot struct {
	MerkleRoot      string    `json:"merkle_root"`
	Beacon          Beacon    `json:"beacon"`
	Hash            string    `json:"hash"`
	CertificateHash string    `json:"certificate_hash"`
	CreatedAt       time.Time `json:"created_at"`
}
