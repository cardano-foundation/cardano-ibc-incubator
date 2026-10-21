package commitmentcodec

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/cosmos/gogoproto/proto"
	gogotypes "github.com/cosmos/gogoproto/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
)

type codecVector struct {
	Name, Kind, Committed, Sequence, Bytes string
	Version                                Version
	State, Ordering                        uint64
}

func loadCodecVectors(t *testing.T) []codecVector {
	t.Helper()
	data, err := os.ReadFile("../../../tests/ibc-state-commitment/codec.json")
	require.NoError(t, err)
	var fixture struct {
		FixtureVersion int
		Vectors        []codecVector
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 2, fixture.FixtureVersion)
	return fixture.Vectors
}

func expectedClient() TendermintClientStateValue {
	return TendermintClientStateValue{
		ChainId: "cosmos-2", TrustLevel: TrustLevelDatum{Numerator: 1, Denominator: 3},
		TrustingPeriod: 14 * 24 * time.Hour, UnbondingPeriod: 21 * 24 * time.Hour, MaxClockDrift: 10 * time.Second,
		LatestHeight: HeightDatum{RevisionNumber: 2, RevisionHeight: 100},
		ProofSpecs:   []*ics23.ProofSpec{proto.Clone(ics23.IavlSpec).(*ics23.ProofSpec), proto.Clone(ics23.TendermintSpec).(*ics23.ProofSpec)},
		UpgradePath:  []string{"upgrade", "upgradedIBCState"},
	}
}

func TestAikenGatewayCodecVectors(t *testing.T) {
	for _, vector := range loadCodecVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			data, err := hex.DecodeString(vector.Committed)
			require.NoError(t, err)
			if vector.Kind != "envelope" {
				require.NoError(t, RequireSupportedCodec(data))
			}
			switch vector.Kind {
			case "client":
				value, version, err := DecodeClientState(data)
				require.NoError(t, err)
				require.Equal(t, vector.Version, version)
				expected := expectedClient()
				if vector.Name != "client_upgrade_path" {
					expected.UpgradePath = nil
				}
				require.NoError(t, value.Compare(expected))
				expected.AllowUpdateAfterExpiry = true
				require.Error(t, value.Compare(expected))
				if version == Legacy8 {
					require.Error(t, value.Compare(expectedClient()))
				}
			case "consensus":
				value, err := DecodeConsensusState(data)
				require.NoError(t, err)
				require.NoError(t, value.Compare(ConsensusStateValue{Timestamp: 1700000000000000000, NextValidatorsHash: bytes.Repeat([]byte{0x11}, 32), Root: bytes.Repeat([]byte{0x22}, 32)}))
			case "connection":
				value, err := DecodeConnectionEnd(data)
				require.NoError(t, err)
				expected := ConnectionEndValue{
					ClientId: "07-tendermint-0", State: vector.State,
					Versions:             []ConnectionVersionValue{{Identifier: "1", Features: []string{"ORDER_UNORDERED", "ORDER_ORDERED"}}},
					CounterpartyClientId: "07-tendermint-9", CounterpartyConnectionId: "connection-2", CounterpartyPrefix: []byte("ibc"),
				}
				require.NoError(t, value.Compare(expected))
				// Feature order is immaterial and comparison must not mutate the caller.
				require.Equal(t, "ORDER_UNORDERED", expected.Versions[0].Features[0])
				expected.State++
				require.Error(t, value.Compare(expected))
			case "channel":
				value, err := DecodeChannel(data)
				require.NoError(t, err)
				expected := ChannelValue{State: vector.State, Ordering: vector.Ordering, CounterpartyPortId: "transfer", CounterpartyChannelId: "channel-2", ConnectionHops: []string{"connection-0"}, Version: "ics20-1"}
				require.NoError(t, value.Compare(expected))
				expected.UpgradeSequence = 1
				require.Error(t, value.Compare(expected))
			case "sequence":
				value, err := strconv.ParseUint(vector.Sequence, 10, 64)
				require.NoError(t, err)
				expected := make([]byte, 8)
				binary.BigEndian.PutUint64(expected, value)
				require.NoError(t, CompareNextSequenceRecv(data, expected))
				expected[7] ^= 1
				require.Error(t, CompareNextSequenceRecv(data, expected))
			case "bytes":
				expected, err := hex.DecodeString(vector.Bytes)
				require.NoError(t, err)
				require.NoError(t, ComparePacketBytes(data, expected))
				require.Error(t, ComparePacketBytes(data, append(expected, 0)))
			case "registration":
				value, err := DecodeRegistration(data)
				require.NoError(t, err)
				require.Equal(t, bytes.Repeat([]byte{0x33}, 28), value.ModuleScriptHash)
				require.Equal(t, []byte("port"), value.PortToken.Name)
				require.Equal(t, []byte("module"), value.ModuleToken.Name)
			case "envelope":
				// A later codec's leaf is rejected by name and by every reader.
				require.ErrorIs(t, RequireSupportedCodec(data), ErrUnsupportedCodec)
				_, _, err := DecodeClientState(data)
				require.Error(t, err)
				_, err = DecodeConsensusState(data)
				require.Error(t, err)
				_, err = DecodeConnectionEnd(data)
				require.Error(t, err)
				_, err = DecodeChannel(data)
				require.Error(t, err)
				_, err = DecodeRegistration(data)
				require.Error(t, err)
				require.Error(t, ComparePacketBytes(data, bytes.Repeat([]byte{0xab}, 32)))
				require.Error(t, CompareNextSequenceRecv(data, make([]byte, 8)))
			default:
				t.Fatalf("unsupported vector kind %q", vector.Kind)
			}
		})
	}
}

func TestClientFormatsRejectMalformedValuesWithoutFallback(t *testing.T) {
	data, err := hex.DecodeString(loadCodecVectors(t)[0].Committed)
	require.NoError(t, err)
	original, err := recordFields(data)
	require.NoError(t, err)
	for name, mutate := range map[string]func([]cbor.RawMessage) []cbor.RawMessage{
		"seven fields":      func(v []cbor.RawMessage) []cbor.RawMessage { return v[:7] },
		"ten fields":        func(v []cbor.RawMessage) []cbor.RawMessage { return append(v, cbor.RawMessage{0x80}) },
		"null upgrade path": func(v []cbor.RawMessage) []cbor.RawMessage { v[8] = cbor.RawMessage{0xf6}; return v },
		"null chain":        func(v []cbor.RawMessage) []cbor.RawMessage { v[0] = cbor.RawMessage{0xf6}; return v },
		"null period":       func(v []cbor.RawMessage) []cbor.RawMessage { v[2] = cbor.RawMessage{0xf6}; return v },
		"negative period":   func(v []cbor.RawMessage) []cbor.RawMessage { v[2] = cbor.RawMessage{0x20}; return v },
		"wrong height constructor": func(v []cbor.RawMessage) []cbor.RawMessage {
			v[6] = cbor.RawMessage{0xd8, 0x7a, 0x82, 0x02, 0x18, 0x64}
			return v
		},
	} {
		t.Run(name, func(t *testing.T) {
			fields := append([]cbor.RawMessage{}, original...)
			encoded, err := cbor.Marshal(cbor.Tag{Number: 121, Content: mutate(fields)})
			require.NoError(t, err)
			_, _, err = DecodeClientState(encoded)
			require.Error(t, err)
		})
	}
	for _, malformed := range [][]byte{nil, {0xf6}, {0x80}, append(append([]byte{}, data...), 0), append([]byte{0xd8, 0x7a}, data[2:]...)} {
		_, _, err := DecodeClientState(malformed)
		require.Error(t, err)
	}
}

func TestChannelHopsAreOrderedAndFeaturesHaveNoSeparatorAmbiguity(t *testing.T) {
	channel := ChannelDatum{State: cbor.Tag{Number: 124, Content: []any{}}, Ordering: cbor.Tag{Number: 122, Content: []any{}}, ConnectionHops: [][]byte{[]byte("a"), []byte("b")}}
	require.Error(t, channel.Compare(ChannelValue{State: 3, Ordering: 1, ConnectionHops: []string{"b", "a"}}))
	connection := ConnectionEndDatum{State: cbor.Tag{Number: 121, Content: []any{}}, Versions: []VersionDatum{{Features: [][]byte{[]byte("a,b"), []byte("c")}}}}
	require.Error(t, connection.Compare(ConnectionEndValue{Versions: []ConnectionVersionValue{{Features: []string{"a", "b,c"}}}}))
}

func TestExpectedAnyPreservesConcreteClientValues(t *testing.T) {
	const typeURL = "/ibc.lightclients.tendermint.v1.ClientState"
	// Concrete ClientState: chain_id='/chain', trust_level=1/3 and duration=1.
	concrete := []byte{0x0a, 6, '/', 'c', 'h', 'a', 'i', 'n', 0x12, 4, 8, 1, 16, 3, 0x1a, 2, 8, 1}
	decoded, err := ExpectedTendermintValue(concrete, typeURL)
	require.NoError(t, err)
	require.Equal(t, concrete, decoded)
	wrapped, err := (&gogotypes.Any{TypeUrl: typeURL, Value: concrete}).Marshal()
	require.NoError(t, err)
	decoded, err = ExpectedTendermintValue(wrapped, typeURL)
	require.NoError(t, err)
	require.Equal(t, concrete, decoded)
	_, err = ExpectedTendermintValue(wrapped, "/wrong.ClientState")
	require.Error(t, err)
}

func TestEnvelopesCannotNameUnenvelopedCodecs(t *testing.T) {
	for name, committed := range map[string]string{
		"legacy8":         "d87a9f0040ff",
		"upgrade path 9":  "d87a9f0140ff",
		"missing payload": "d87a9f02ff",
		"empty":           "d87a80",
		"bytes codec":     "d87a9f410240ff",
		"extra field":     "d87a9f024040ff",
	} {
		t.Run(name, func(t *testing.T) {
			data, err := hex.DecodeString(committed)
			require.NoError(t, err)
			require.ErrorIs(t, RequireSupportedCodec(data), ErrUnsupportedCodec)
		})
	}
}
