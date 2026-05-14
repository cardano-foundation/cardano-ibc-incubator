package cryptohelpers

import (
	"bytes"
	"strconv"
)

type Range struct {
	Start uint64 `json:"start"`
	End   uint64 `json:"end"`
}

type BlockRange struct {
	InnerRange *Range `json:"inner_range"`
}

func (br *BlockRange) ToMKTreeNode() *MKTreeNode {
	start := strconv.FormatUint(br.InnerRange.Start, 10)
	end := strconv.FormatUint(br.InnerRange.End, 10)

	var buffer bytes.Buffer
	buffer.WriteString(start)
	buffer.WriteString("-")
	buffer.WriteString(end)

	return &MKTreeNode{
		Hash: buffer.Bytes(),
	}
}
