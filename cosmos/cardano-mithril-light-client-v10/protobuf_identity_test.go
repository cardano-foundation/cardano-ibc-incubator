package mithril

import (
	"testing"

	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/gogoproto/proto"
	"github.com/stretchr/testify/require"
)

func TestPreservedClientAndProtobufIdentities(t *testing.T) {
	require.Equal(t, "08-cardano-mithril", ModuleName)

	testCases := []struct {
		message proto.Message
		name    string
	}{
		{message: &ClientState{}, name: "ibc.lightclients.mithril.v1.ClientState"},
		{message: &ConsensusState{}, name: "ibc.lightclients.mithril.v1.ConsensusState"},
		{message: &MithrilHeader{}, name: "ibc.lightclients.mithril.v1.MithrilHeader"},
		{message: &Misbehaviour{}, name: "ibc.lightclients.mithril.v1.Misbehaviour"},
		{message: &Height{}, name: "ibc.lightclients.mithril.v1.Height"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			require.Equal(t, testCase.name, proto.MessageName(testCase.message))
			require.Equal(t, "/"+testCase.name, codectypes.MsgTypeURL(testCase.message))
		})
	}
}
