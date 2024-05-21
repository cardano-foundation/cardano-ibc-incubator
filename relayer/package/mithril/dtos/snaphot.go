package dtos

import "time"

// Snapshot represents the snapshot data transfer object.
type Snapshot struct {
	Digest               string    `json:"digest"`
	Beacon               Beacon    `json:"beacon"`
	CertificateHash      string    `json:"certificate_hash"`
	Size                 int       `json:"size"`
	CreatedAt            time.Time `json:"created_at"`
	Locations            []string  `json:"locations"`
	CompressionAlgorithm string    `json:"compression_algorithm"`
	CardanoNodeVersion   string    `json:"cardano_node_version"`
}
