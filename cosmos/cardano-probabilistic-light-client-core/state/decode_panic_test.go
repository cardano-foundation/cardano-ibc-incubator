package state

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

// A decoder panic while reading the HostState transaction means the anchor
// block bytes are malformed. Other failures concern the HostState commitment.
func TestHostStateExtractionErrorClassifiesDecodePanics(t *testing.T) {
	panicked := fmt.Errorf("%w: index out of range", probabilisticcore.ErrDecodePanicked)
	require.ErrorIs(t, hostStateExtractionError(panicked), ErrInvalidAcceptedBlock)
	require.NotErrorIs(t, hostStateExtractionError(panicked), ErrInvalidHostStateCommitment)

	missing := errors.New("host state tx not found in authenticated anchor block")
	require.ErrorIs(t, hostStateExtractionError(missing), ErrInvalidHostStateCommitment)
}
