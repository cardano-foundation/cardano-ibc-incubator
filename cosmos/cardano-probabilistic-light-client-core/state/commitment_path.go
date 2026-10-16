package state

import "fmt"

// Cardano commitments use exactly the ibc namespace and one nonempty object key.
// Keep revision-height keys intact when removing the namespace.
func IbcStateKeyFromPath[T ~string | ~[]byte](components []T) ([]byte, error) {
	if len(components) != 2 {
		return nil, fmt.Errorf("expected MerklePath with exactly 2 components, got %d", len(components))
	}
	if string(components[0]) != "ibc" {
		return nil, fmt.Errorf("invalid Cardano commitment prefix: expected %q, got %q", "ibc", components[0])
	}
	if len(components[1]) == 0 {
		return nil, fmt.Errorf("empty IBC state key")
	}
	return []byte(components[1]), nil
}
