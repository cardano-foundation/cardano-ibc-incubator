package merkleindex

import (
	"fmt"
	"math/bits"
)

// Parent returns the index of the parent of the given node.
func Parent(index uint64) (uint64, error) {
	if index == 0 {
		return 0, fmt.Errorf("the root node does not have a parent")
	}
	return (index - 1) / 2, nil
}

// Sibling returns the index of the sibling of the given node.
func Sibling(index uint64) (uint64, error) {
	if index == 0 {
		return 0, fmt.Errorf("the root node does not have a sibling")
	}
	if index%2 == 1 {
		return index + 1, nil
	}
	return index - 1, nil
}

// NextPowerOfTwo returns zero if the next power cannot fit in uint64.
func NextPowerOfTwo(x uint64) uint64 {
	if x < 2 {
		return 1
	}
	return 1 << (64 - bits.LeadingZeros64(x-1))
}
