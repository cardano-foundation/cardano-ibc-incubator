package state

import errorsmod "cosmossdk.io/errors"

// These are the evidence bounds exercised on the v8/v10 local destination
// profiles. Two full headers must fit, including their repeated epoch tables.
// Raising a bound requires rerunning the complete challenge capacity test.
const (
	MaxHeaderBytes             = 5 * 1024 * 1024 / 2
	MaxHeaderBlocks            = 128
	MaxBridgeBlocks            = 96
	MaxStakeEntries            = 4000
	MaxClientStateBytes        = 3 * 1024 * 1024
	MaxBlockCBORBytes          = 96 * 1024
	MaxHeaderCBORBytes         = 1100
	NativeBlockVerificationGas = uint64(200_000)
	MaxHeaderVerificationGas   = uint64(65_000_000)
	ChallengeTxEnvelopeBytes   = 64 * 1024
	MaxChallengeTxBytes        = 2*MaxHeaderBytes + ChallengeTxEnvelopeBytes
	// Reserve two verifications, the SDK's transaction-size charge, a client
	// read and freeze write, and the remaining admission and keeper work.
	MaxChallengeTxGas = 2*MaxHeaderVerificationGas + uint64(MaxChallengeTxBytes)*10 + uint64(MaxClientStateBytes)*40 + 10_000_000
)

func ValidateHeaderBytes(size int) error {
	if size > MaxHeaderBytes {
		return errorsmod.Wrapf(ErrInvalidHeader, "header is %d bytes, exceeds the %d-byte challenge capacity bound", size, MaxHeaderBytes)
	}
	return nil
}

func validateClientBytes(size int) error {
	if size > MaxClientStateBytes {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "client state is %d bytes, exceeds the %d-byte challenge capacity bound", size, MaxClientStateBytes)
	}
	return nil
}

func (c Context) chargeNativeVerification(header *ProbabilisticHeader) {
	if c.ConsumeGas != nil {
		c.ConsumeGas(uint64(1+len(header.BridgeBlocks)+len(header.DescendantBlocks))*NativeBlockVerificationGas, "Cardano native header verification")
	}
}
