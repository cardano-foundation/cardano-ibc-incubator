package probabilistic

import (
	"strings"
	"testing"

	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/stretchr/testify/require"
)

// Certified stake reaches the core through MsgUpdateClient like a header.
func TestMithrilStakeCertificatesAreAClientMessage(t *testing.T) {
	msg := &MithrilStakeCertificates{Certificates: []string{"{}"}}
	require.Equal(t, ModuleName, msg.ClientType())
	require.NoError(t, msg.ValidateBasic())

	cdc := newProbabilisticTestCodec().(codec.Codec)
	encoded, err := cdc.MarshalInterface(exported.ClientMessage(msg))
	require.NoError(t, err)
	var decoded exported.ClientMessage
	require.NoError(t, cdc.UnmarshalInterface(encoded, &decoded))
	require.Equal(t, msg, decoded)
	require.Equal(t, &state.MithrilStakeCertificates{Certificates: msg.Certificates}, coreMessage(decoded))

	require.Error(t, (&MithrilStakeCertificates{}).ValidateBasic())
	require.Error(t, (&MithrilStakeCertificates{Certificates: []string{strings.Repeat("x", state.MaxMithrilCertificateBytes+1)}}).ValidateBasic())
}
