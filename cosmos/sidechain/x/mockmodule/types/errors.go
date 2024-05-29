package types

// DONTCOVER

import (
	sdkerrors "cosmossdk.io/errors"
)

// x/mockmodule module sentinel errors
var (
	ErrInvalidSigner        = sdkerrors.Register(ModuleName, 1100, "expected gov account as only signer for proposal message")
	ErrSample               = sdkerrors.Register(ModuleName, 1101, "sample error")
	ErrInvalidPacketTimeout = sdkerrors.Register(ModuleName, 1500, "invalid packet timeout")
	ErrInvalidVersion       = sdkerrors.Register(ModuleName, 1501, "invalid version")
)
