package crypto

// Test access to the shared BLS point conversions. Generation-based tests use
// an external package so the verifier never needs to import signing support.
var (
	VkFromP2AffineForTest = vkFromP2Affine
	SigToP1ForTest        = sigToP1
	P2AffineToVkForTest   = p2AffineToVk
	P1AffineToSigForTest  = p1AffineToSig
)
