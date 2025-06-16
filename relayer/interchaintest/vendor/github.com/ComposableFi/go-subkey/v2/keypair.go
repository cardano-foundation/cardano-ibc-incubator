package subkey

// PublicKey can verify and be converted to SS58 addresses
type PublicKey interface {
	Verifier

	// Public returns the pub key in bytes.
	Public() []byte

	// AccountID returns the accountID for this key
	AccountID() []byte

	// SS58Address returns the Base58 public key with checksum and network identifier.
	SS58Address(network uint16) string
}

// KeyPair can sign, verify using a seed and public key
type KeyPair interface {
	Signer
	PublicKey

	// Seed returns the seed of the pair
	Seed() []byte
}

// Signer signs the message and returns the signature.
type Signer interface {
	Sign(msg []byte) ([]byte, error)
}

// Verifier verifies the signature.
type Verifier interface {
	Verify(msg []byte, signature []byte) bool
}
