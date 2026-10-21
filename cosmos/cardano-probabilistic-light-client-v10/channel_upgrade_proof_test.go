package probabilistic

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	"github.com/stretchr/testify/require"
)

func loadChannelUpgradeVectors(t *testing.T) []stateProofVector {
	t.Helper()
	data, err := os.ReadFile("../../tests/ibc-state-commitment/channel-upgrade.json")
	require.NoError(t, err)
	var fixture struct {
		Version int
		Vectors []stateProofVector
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 1, fixture.Version)
	require.Len(t, fixture.Vectors, 5)
	return fixture.Vectors
}

// ibc-go v10 removed channel upgrades and the Channel upgrade sequence. Once
// Cardano commits upgradable channel ends, v10 hosts must still verify them for
// opening and closing handshakes, whatever sequence an abandoned upgrade left.
// v10 never verifies upgrade or error records.
func TestChannelUpgradeVectorsOnV10(t *testing.T) {
	for _, vector := range loadChannelUpgradeVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			verify := storedProofVerifier(t, vector)
			key := []byte(vector.Key)
			proof := vectorProofProto(t, vector)
			if !strings.HasPrefix(vector.Key, "channelEnds/") {
				require.Error(t, verify(key, []byte{0x08, 0x01}, proof, true))
				return
			}
			if vector.Name != "channel_upgraded" {
				return
			}
			channel := &channeltypes.Channel{
				State: channeltypes.OPEN, Ordering: channeltypes.UNORDERED, Counterparty: channeltypes.NewCounterparty("transfer", "channel-2"),
				ConnectionHops: []string{"connection-1"}, Version: "ics20-1",
			}
			require.NoError(t, verify(key, wrapProofValue(t, "", channel), proof, true))
			channel.ConnectionHops = []string{"connection-0"}
			require.Error(t, verify(key, wrapProofValue(t, "", channel), proof, true))
		})
	}
}
