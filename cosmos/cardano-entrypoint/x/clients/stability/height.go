package stability

import (
	"math/big"
	"strconv"

	errorsmod "cosmossdk.io/errors"

	sdk "github.com/cosmos/cosmos-sdk/types"
	ibcerrors "github.com/cosmos/ibc-go/v10/modules/core/errors"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

var _ exported.Height = (*Height)(nil)

func ZeroHeight() *Height {
	return &Height{}
}

func NewHeight(revisionNumber uint64, revisionHeight uint64) *Height {
	return &Height{
		RevisionNumber: revisionNumber,
		RevisionHeight: revisionHeight,
	}
}

func (h Height) GetRevisionNumber() uint64 {
	return 0
}

func (h Height) GetRevisionHeight() uint64 {
	return h.RevisionHeight
}

func (h Height) Compare(other exported.Height) int64 {
	var a, b big.Int
	a.SetUint64(h.RevisionHeight)
	b.SetUint64(other.GetRevisionHeight())
	return int64(a.Cmp(&b))
}

func (h Height) LT(other exported.Height) bool  { return h.Compare(other) == -1 }
func (h Height) LTE(other exported.Height) bool { return h.Compare(other) <= 0 }
func (h Height) GT(other exported.Height) bool  { return h.Compare(other) == 1 }
func (h Height) GTE(other exported.Height) bool { return h.Compare(other) >= 0 }
func (h Height) EQ(other exported.Height) bool  { return h.Compare(other) == 0 }

func (h Height) Decrement() (exported.Height, bool) {
	if h.RevisionHeight == 0 {
		return nil, false
	}
	return NewHeight(0, h.RevisionHeight-1), true
}

func (h Height) Increment() exported.Height {
	return NewHeight(0, h.RevisionHeight+1)
}

func (h Height) IsZero() bool {
	return h.RevisionHeight == 0
}

func MustParseHeight(heightStr string) *Height {
	height, err := ParseHeight(heightStr)
	if err != nil {
		panic(err)
	}
	return height
}

func ParseHeight(heightStr string) (*Height, error) {
	revisionHeight, err := strconv.ParseUint(heightStr, 10, 64)
	if err != nil {
		return nil, errorsmod.Wrapf(ibcerrors.ErrInvalidHeight, "invalid stability height. parse err: %s", err)
	}
	return NewHeight(0, revisionHeight), nil
}

func GetSelfHeight(ctx sdk.Context) *Height {
	return NewHeight(0, uint64(ctx.BlockHeight()))
}
