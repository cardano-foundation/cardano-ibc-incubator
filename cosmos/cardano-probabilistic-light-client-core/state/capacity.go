package state

// Logical observations are verified through bounded operations. These limits
// bound the committed workload and individual native witnesses.
const (
	MaxHeaderBlocks            = 128
	MaxBridgeBlocks            = 96
	MaxStakeEntries            = 4000
	MaxBlockCBORBytes          = 96 * 1024
	MaxHeaderCBORBytes         = 1100
	NativeBlockVerificationGas = uint64(200_000)
)
