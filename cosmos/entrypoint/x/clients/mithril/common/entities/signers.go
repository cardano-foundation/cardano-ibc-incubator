package entities

type SignerWithStake struct {
	PartyId         PartyId
	VerificationKey ProtocolSignerVerificationKey
	Stake           Stake
	// VerificationKeySignature
	// OperationalCertificate
	// KesPeriod
}
