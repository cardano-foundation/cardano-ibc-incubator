package mithril

import (
	"fmt"
	"math/big"
	"strconv"

	errorsmod "cosmossdk.io/errors"

	sdk "github.com/cosmos/cosmos-sdk/types"
	ibcerrors "github.com/cosmos/ibc-go/v8/modules/core/errors"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.Height = (*Height)(nil)

// ZeroHeight is a helper function which returns an uninitialized height.
func ZeroHeight() Height {
	return Height{}
}

// NewHeight is a constructor for the IBC height type
func NewHeight(revisionNumber uint64, revisionHeight uint64) Height {
	return Height{
		RevisionNumber: revisionNumber,
		RevisionHeight: revisionHeight,
	}
}

// GetRevisionNumber always returns 0
func (h Height) GetRevisionNumber() uint64 {
	return 0
}

// GetMithrilHeight returns the mithril-height of the height
func (h Height) GetRevisionHeight() uint64 {
	return h.RevisionHeight
}

// Compare implements a method to compare two heights. When comparing two heights a, b
// we can call a.Compare(b) which will return
// -1 if a < b
// 0  if a = b
// 1  if a > b
func (h Height) Compare(other exported.Height) int64 {
	var a, b big.Int
	a.SetUint64(h.RevisionHeight)
	b.SetUint64(other.GetRevisionHeight())
	return int64(a.Cmp(&b))
}

// LT Helper comparison function returns true if h < other
func (h Height) LT(other exported.Height) bool {
	return h.Compare(other) == -1
}

// LTE Helper comparison function returns true if h <= other
func (h Height) LTE(other exported.Height) bool {
	cmp := h.Compare(other)
	return cmp <= 0
}

// GT Helper comparison function returns true if h > other
func (h Height) GT(other exported.Height) bool {
	return h.Compare(other) == 1
}

// GTE Helper comparison function returns true if h >= other
func (h Height) GTE(other exported.Height) bool {
	cmp := h.Compare(other)
	return cmp >= 0
}

// EQ Helper comparison function returns true if h == other
func (h Height) EQ(other exported.Height) bool {
	return h.Compare(other) == 0
}

// String returns a string representation of Height
func (h Height) String() string {
	return fmt.Sprintf("%d-%d", 0, h.RevisionHeight)
}

// Decrement will return a new height with the MithrilHeight decremented
// If the MithrilHeight is already at lowest value (1), then false success flag is returend
func (h Height) Decrement() (decremented exported.Height, success bool) {
	if h.RevisionHeight == 0 {
		return Height{}, false
	}
	return NewHeight(0, h.RevisionHeight-1), true
}

// Increment will return a height with an incremented mithril height
func (h Height) Increment() exported.Height {
	return NewHeight(0, h.RevisionHeight+1)
}

// IsZero returns true if mithril height is 0
func (h Height) IsZero() bool {
	return h.RevisionHeight == 0
}

// MustParseHeight will attempt to parse a string representation of a height and panic if
// parsing fails.
func MustParseHeight(heightStr string) Height {
	height, err := ParseHeight(heightStr)
	if err != nil {
		panic(err)
	}

	return height
}

// ParseHeight is a utility function that takes a string representation of the height
// and returns a Height struct
func ParseHeight(heightStr string) (Height, error) {
	revisionHeight, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		return Height{}, errorsmod.Wrapf(ibcerrors.ErrInvalidHeight, "invalid mithril height. parse err: %s", err)
	}
	return NewHeight(0, revisionHeight), nil
}

// GetSelfHeight is a utility function that returns self height given context
func GetSelfHeight(ctx sdk.Context) Height {
	return NewHeight(0, uint64(ctx.BlockHeight()))
}
