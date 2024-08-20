package dtos

// SignerDetail represents the details of a signer.
type Signer struct {
	PartyID                  string `json:"party_id"`
	VerificationKey          string `json:"verification_key"`
	VerificationKeySignature string `json:"verification_key_signature"`
	OperationalCertificate   string `json:"operational_certificate"`
	KESPeriod                uint64 `json:"kes_period"`
	Stake                    uint64 `json:"stake"`
}
