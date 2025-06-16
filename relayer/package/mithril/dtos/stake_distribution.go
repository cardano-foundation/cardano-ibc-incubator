package dtos

import "time"

type MithrilStakeDistribution struct {
	Hash            string    `json:"hash"`
	Epoch           uint64    `json:"epoch"`
	CertificateHash string    `json:"certificate_hash"`
	CreatedAt       time.Time `json:"created_at"`
}
