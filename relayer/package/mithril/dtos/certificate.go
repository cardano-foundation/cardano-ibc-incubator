package dtos

type CertificateMetadataOverall struct {
	CertificateMetadataBase
	TotalSigners int `json:"total_signers"`
}

type CertificateMetadataDetail struct {
	CertificateMetadataBase
	Signers []Signer
}

type CertificateOverall struct {
	Hash                     string                     `json:"hash"`
	PreviousHash             string                     `json:"previous_hash"`
	Epoch                    uint64                     `json:"epoch"`
	SignedEntityType         SignedEntityType           `json:"signed_entity_type"`
	Beacon                   Beacon                     `json:"beacon"`
	Metadata                 CertificateMetadataOverall `json:"metadata"`
	ProtocolMessage          ProtocolMessage            `json:"protocol_message"`
	SignedMessage            string                     `json:"signed_message"`
	AggregateVerificationKey string                     `json:"aggregate_verification_key"`
}

type CertificateDetail struct {
	Hash                     string                    `json:"hash"`
	PreviousHash             string                    `json:"previous_hash"`
	Epoch                    uint64                    `json:"epoch"`
	SignedEntityType         SignedEntityType          `json:"signed_entity_type"`
	Beacon                   Beacon                    `json:"beacon"`
	Metadata                 CertificateMetadataDetail `json:"metadata"`
	ProtocolMessage          ProtocolMessage           `json:"protocol_message"`
	SignedMessage            string                    `json:"signed_message"`
	AggregateVerificationKey string                    `json:"aggregate_verification_key"`
	MultiSignature           string                    `json:"multi_signature"`
	GenesisSignature         string                    `json:"genesis_signature"`
}
