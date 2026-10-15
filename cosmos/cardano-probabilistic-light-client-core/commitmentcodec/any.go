package commitmentcodec

import (
	"fmt"
	"strings"

	"github.com/cosmos/gogoproto/proto"
	gogotypes "github.com/cosmos/gogoproto/types"
	"google.golang.org/protobuf/encoding/protowire"
)

// ExpectedTendermintValue supports canonical IBC Any values and the legacy
// concrete protobuf API. An Any wrapper cannot change the expected client type.
func ExpectedTendermintValue(data []byte, typeURL string) ([]byte, error) {
	// A concrete client can also have a chain ID beginning with '/'. Its fields
	// beyond 1 and 2 distinguish it from an Any without guessing from the ID.
	for rest := data; len(rest) > 0; {
		number, _, count := protowire.ConsumeField(rest)
		if count < 0 {
			return nil, fmt.Errorf("malformed expected protobuf value")
		}
		if number > 2 {
			return data, nil
		}
		rest = rest[count:]
	}
	var wrapped gogotypes.Any
	if err := proto.Unmarshal(data, &wrapped); err == nil && strings.HasPrefix(wrapped.TypeUrl, "/") {
		if wrapped.TypeUrl != typeURL || len(wrapped.Value) == 0 {
			return nil, fmt.Errorf("unexpected Tendermint protobuf Any type or empty value")
		}
		return wrapped.Value, nil
	}
	return data, nil
}
