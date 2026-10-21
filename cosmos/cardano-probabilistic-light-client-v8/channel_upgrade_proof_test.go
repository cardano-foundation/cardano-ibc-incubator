package probabilistic

import (
	"encoding/json"
	"os"
	"testing"

	proto "github.com/cosmos/gogoproto/proto"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
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

func upgradeVectorChannel(state channeltypes.State, hop string, sequence uint64) *channeltypes.Channel {
	return &channeltypes.Channel{
		State: state, Ordering: channeltypes.UNORDERED, Counterparty: channeltypes.NewCounterparty("transfer", "channel-2"),
		ConnectionHops: []string{hop}, Version: "ics20-1", UpgradeSequence: sequence,
	}
}

// The protobuf values ibc-go v8.7.0 passes to VerifyMembership for each
// Cardano record in tests/ibc-state-commitment/channel-upgrade.json.
func expectedChannelUpgradeValue(t *testing.T, name string) proto.Message {
	t.Helper()
	fields := channeltypes.NewUpgradeFields(channeltypes.UNORDERED, []string{"connection-1"}, "ics20-1")
	switch name {
	case "channel_flushing":
		return upgradeVectorChannel(channeltypes.FLUSHING, "connection-0", 3)
	case "channel_upgraded":
		return upgradeVectorChannel(channeltypes.OPEN, "connection-1", 1)
	case "channel_upgrade":
		return &channeltypes.Upgrade{Fields: fields, Timeout: channeltypes.NewTimeout(clienttypes.NewHeight(2, 500), 1_700_000_600_000_000_000), NextSequenceSend: 5}
	case "channel_upgrade_init":
		return &channeltypes.Upgrade{Fields: fields}
	case "channel_upgrade_error":
		return &channeltypes.ErrorReceipt{Sequence: 3, Message: "ABCI code: 28: restored channel to pre-upgrade state"}
	}
	require.Failf(t, "unknown vector", "%s", name)
	return nil
}

// Every compared field changes one at a time.
func changedChannelUpgradeValues(t *testing.T, value proto.Message) map[string]proto.Message {
	t.Helper()
	changes := map[string]proto.Message{}
	change := func(name string, edit func(proto.Message)) {
		changed := proto.Clone(value)
		edit(changed)
		changes[name] = changed
	}
	switch value.(type) {
	case *channeltypes.Channel:
		channel := func(m proto.Message) *channeltypes.Channel { return m.(*channeltypes.Channel) }
		change("state", func(m proto.Message) { channel(m).State = channeltypes.FLUSHCOMPLETE })
		change("ordering", func(m proto.Message) { channel(m).Ordering = channeltypes.ORDERED })
		change("counterparty port", func(m proto.Message) { channel(m).Counterparty.PortId = "other" })
		change("counterparty channel", func(m proto.Message) { channel(m).Counterparty.ChannelId = "channel-3" })
		change("hop", func(m proto.Message) { channel(m).ConnectionHops = []string{"connection-9"} })
		change("version", func(m proto.Message) { channel(m).Version = "ics20-2" })
		change("lower sequence", func(m proto.Message) { channel(m).UpgradeSequence-- })
		change("higher sequence", func(m proto.Message) { channel(m).UpgradeSequence++ })
	case *channeltypes.Upgrade:
		upgrade := func(m proto.Message) *channeltypes.Upgrade { return m.(*channeltypes.Upgrade) }
		change("ordering", func(m proto.Message) { upgrade(m).Fields.Ordering = channeltypes.ORDERED })
		change("hop", func(m proto.Message) { upgrade(m).Fields.ConnectionHops = []string{"connection-0"} })
		change("version", func(m proto.Message) { upgrade(m).Fields.Version = "ics20-2" })
		change("timeout height", func(m proto.Message) { upgrade(m).Timeout.Height.RevisionHeight++ })
		change("timeout timestamp", func(m proto.Message) { upgrade(m).Timeout.Timestamp++ })
		change("next sequence send", func(m proto.Message) { upgrade(m).NextSequenceSend++ })
	case *channeltypes.ErrorReceipt:
		receipt := func(m proto.Message) *channeltypes.ErrorReceipt { return m.(*channeltypes.ErrorReceipt) }
		change("sequence", func(m proto.Message) { receipt(m).Sequence++ })
		change("message", func(m proto.Message) { receipt(m).Message += "." })
	}
	require.NotEmpty(t, changes)
	return changes
}

// The deployed client must authenticate the Cardano records produced by the
// Gateway runtime and Aiken encoders for every channel-upgrade step.
func TestChannelUpgradeProofVectors(t *testing.T) {
	for _, vector := range loadChannelUpgradeVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			verify := storedProofVerifier(t, vector)
			key := []byte(vector.Key)
			expected := expectedChannelUpgradeValue(t, vector.Name)
			value := wrapProofValue(t, "", expected)
			for encoding, proof := range map[string][]byte{"json": vector.Proof, "protobuf": vectorProofProto(t, vector)} {
				t.Run(encoding, func(t *testing.T) {
					require.NoError(t, verify(key, value, proof, true))
					require.Error(t, verify(key, value, proof, false))
					for name, changed := range changedChannelUpgradeValues(t, expected) {
						require.Error(t, verify(key, wrapProofValue(t, "", changed), proof, true), name)
					}
				})
			}
		})
	}
}

// A channel end committed before Cardano supported upgrades has no sequence.
// It must not stand in for a channel that has started an upgrade.
func TestLegacyChannelProofOnlyMatchesSequenceZero(t *testing.T) {
	var vector stateProofVector
	for _, candidate := range loadStateProofVectors(t) {
		if candidate.Name == "channel" {
			vector = candidate
		}
	}
	verify := storedProofVerifier(t, vector)
	proof := vectorProofProto(t, vector)
	channel := expectedProofValue(t, vector)
	require.NoError(t, verify([]byte(vector.Key), channel, proof, true))
	var upgraded channeltypes.Channel
	require.NoError(t, proto.Unmarshal(channel, &upgraded))
	upgraded.UpgradeSequence = 1
	require.ErrorContains(t, verify([]byte(vector.Key), wrapProofValue(t, "", &upgraded), proof, true), "UpgradeSequence mismatch")
}
