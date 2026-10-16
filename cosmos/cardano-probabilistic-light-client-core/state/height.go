package state

import (
	"math/big"

	"github.com/cosmos/gogoproto/proto"
)

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

func (h Height) Compare(other HeightValue) int64 {
	var a, b big.Int
	a.SetUint64(h.RevisionHeight)
	b.SetUint64(other.GetRevisionHeight())
	return int64(a.Cmp(&b))
}

func (h Height) LT(other HeightValue) bool  { return h.Compare(other) == -1 }
func (h Height) LTE(other HeightValue) bool { return h.Compare(other) <= 0 }
func (h Height) GT(other HeightValue) bool  { return h.Compare(other) == 1 }
func (h Height) GTE(other HeightValue) bool { return h.Compare(other) >= 0 }
func (h Height) EQ(other HeightValue) bool  { return h.Compare(other) == 0 }

func (h Height) IsZero() bool {
	return h.RevisionHeight == 0
}

func (h *Height) Reset()         { *h = Height{} }
func (*Height) ProtoMessage()    {}
func (h *Height) String() string { return proto.CompactTextString(h) }
