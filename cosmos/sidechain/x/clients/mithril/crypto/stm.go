package crypto

// Stake represents the quantity of stake held by a party, represented as a uint64.
type Stake uint64

// Index represents the quorum index for signatures.
// An aggregate signature (StmMultiSig) must have at least k unique indices.
type Index uint64
