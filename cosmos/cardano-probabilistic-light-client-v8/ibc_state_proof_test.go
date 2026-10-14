package probabilistic

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	datum "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v8/internal/cardanodatum"
	proto "github.com/cosmos/gogoproto/proto"
	gogotypes "github.com/cosmos/gogoproto/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	tm "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
)

type nextSequenceRecvVector struct {
	Sequence  string
	Committed string
	Expected  string
	Root      string
}

type nextSequenceRecvFixture struct {
	Version   int
	Key       string
	ProofPath []struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	}
	Vectors []nextSequenceRecvVector
}

func loadNextSequenceRecvFixture(t *testing.T) nextSequenceRecvFixture {
	t.Helper()
	data, err := os.ReadFile("../../tests/ibc-state-commitment/next-sequence-recv.json")
	require.NoError(t, err)
	var fixture nextSequenceRecvFixture
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 1, fixture.Version)
	require.Len(t, fixture.ProofPath, 64)
	require.NotEmpty(t, fixture.Vectors)
	return fixture
}

func nextSequenceRecvHex(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	require.NoError(t, err)
	return decoded
}

func nextSequenceRecvProof(t *testing.T, fixture nextSequenceRecvFixture, vector nextSequenceRecvVector) []byte {
	t.Helper()
	exist := &ics23.ExistenceProof{
		Key: []byte(fixture.Key), Value: nextSequenceRecvHex(t, vector.Committed),
	}
	for _, op := range fixture.ProofPath {
		exist.Path = append(exist.Path, &ics23.InnerOp{
			Hash:   ics23.HashOp_SHA256,
			Prefix: nextSequenceRecvHex(t, op.Prefix), Suffix: nextSequenceRecvHex(t, op.Suffix),
		})
	}
	proof := commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{
		Proof: &ics23.CommitmentProof_Exist{Exist: exist},
	}}}
	encoded, err := proof.Marshal()
	require.NoError(t, err)
	return encoded
}

func TestNextSequenceRecvGatewayProofs(t *testing.T) {
	fixture := loadNextSequenceRecvFixture(t)
	for _, vector := range fixture.Vectors {
		t.Run(vector.Sequence, func(t *testing.T) {
			legacyProof, err := json.Marshal(map[string]any{"proofs": []any{
				map[string]any{"exist": map[string]any{
					"key":   hex.EncodeToString([]byte(fixture.Key)),
					"value": vector.Committed, "path": fixture.ProofPath,
				}},
			}})
			require.NoError(t, err)
			for encoding, proof := range map[string][]byte{
				"protobuf": nextSequenceRecvProof(t, fixture, vector), "json": legacyProof,
			} {
				t.Run(encoding, func(t *testing.T) {
					root := nextSequenceRecvHex(t, vector.Root)
					expected := nextSequenceRecvHex(t, vector.Expected)
					key := []byte(fixture.Key)
					require.NoError(t, VerifyIbcStateMembership(root, key, expected, proof))
					expected[7] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, key, expected, proof), "value mismatch")
					expected[7] ^= 1
					root[0] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, key, expected, proof), "ibc_state_root")
					root[0] ^= 1
					require.ErrorContains(t, VerifyIbcStateMembership(root, []byte(fixture.Key+"0"), expected, proof), "key mismatch")
				})
			}
		})
	}
}

func TestNextSequenceRecvRejectsInvalidEncoding(t *testing.T) {
	key := []byte("nextSequenceRecv/ports/mock/channels/channel-0")
	expected := []byte{0, 0, 0, 0, 0, 0, 0, 1}
	for name, committed := range map[string]string{
		"empty": "", "negative": "20", "bytestring": "480000000000000001",
		"text": "6131", "float": "f93c00", "boolean": "f5",
		"bignum overflow": "c249010000000000000000", "truncated": "1b01", "trailing data": "0100",
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, verifyCardanoValueMatchesExpected(key, expected, nextSequenceRecvHex(t, committed)))
		})
	}
	for _, committed := range []byte{0xf6, 0xf7} {
		require.Error(t, verifyCardanoValueMatchesExpected(key, make([]byte, 8), []byte{committed}))
	}
	for _, length := range []int{0, 1, 7, 9} {
		require.Error(t, verifyCardanoValueMatchesExpected(key, make([]byte, length), []byte{0}))
	}
}

type stateProofVector struct {
	Name, Key, Committed, Root, Protobuf string
	Proof                                json.RawMessage
}

func loadStateProofVectors(t *testing.T) []stateProofVector {
	t.Helper()
	data, err := os.ReadFile("../../tests/ibc-state-commitment/proofs.json")
	require.NoError(t, err)
	var fixture struct {
		Version int
		Vectors []stateProofVector
	}
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.Equal(t, 1, fixture.Version)
	require.Len(t, fixture.Vectors, 7)
	return fixture.Vectors
}

func proofClientState() *tm.ClientState {
	return &tm.ClientState{
		ChainId: "cosmos-2", TrustLevel: tm.Fraction{Numerator: 1, Denominator: 3},
		TrustingPeriod: 14 * 24 * time.Hour, UnbondingPeriod: 21 * 24 * time.Hour, MaxClockDrift: 10 * time.Second,
		LatestHeight: clienttypes.NewHeight(2, 100), ProofSpecs: []*ics23.ProofSpec{proto.Clone(ics23.IavlSpec).(*ics23.ProofSpec), proto.Clone(ics23.TendermintSpec).(*ics23.ProofSpec)},
		UpgradePath: []string{"upgrade", "upgradedIBCState"},
	}
}

func wrapProofValue(t *testing.T, typeURL string, msg proto.Message) []byte {
	t.Helper()
	encoded, err := proto.Marshal(msg)
	require.NoError(t, err)
	if typeURL != "" {
		encoded, err = (&gogotypes.Any{TypeUrl: typeURL, Value: encoded}).Marshal()
		require.NoError(t, err)
	}
	return encoded
}

func expectedProofValue(t *testing.T, vector stateProofVector) []byte {
	t.Helper()
	switch vector.Name {
	case "client":
		return wrapProofValue(t, "/ibc.lightclients.tendermint.v1.ClientState", proofClientState())
	case "consensus_revision_1", "consensus_revision_2":
		return wrapProofValue(t, "/ibc.lightclients.tendermint.v1.ConsensusState", &tm.ConsensusState{
			Timestamp: time.Unix(1_700_000_000, 0), NextValidatorsHash: bytes.Repeat([]byte{0x11}, 32), Root: commitmenttypes.MerkleRoot{Hash: bytes.Repeat([]byte{0x22}, 32)},
		})
	case "connection":
		return wrapProofValue(t, "", &connectiontypes.ConnectionEnd{
			ClientId: "07-tendermint-0", State: connectiontypes.OPEN,
			Versions:     []*connectiontypes.Version{{Identifier: "1", Features: []string{"ORDER_ORDERED", "ORDER_UNORDERED"}}},
			Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-9", ConnectionId: "connection-2", Prefix: commitmenttypes.MerklePrefix{KeyPrefix: []byte("ibc")}},
		})
	case "channel":
		return wrapProofValue(t, "", &channeltypes.Channel{
			State: channeltypes.OPEN, Ordering: channeltypes.UNORDERED,
			Counterparty:   channeltypes.Counterparty{PortId: "transfer", ChannelId: "channel-2"},
			ConnectionHops: []string{"connection-0"}, Version: "ics20-1",
		})
	case "next_sequence_recv":
		return []byte{0, 0, 0, 0, 0, 0, 0, 7}
	default:
		return nil
	}
}

// Exercise the public methods against a stored authenticated root rather than
// checking only the free-standing proof helpers. Initialization also installs
// the epoch challenge deadline and IBC delay metadata.
func storedProofVerifier(t *testing.T, vector stateProofVector) func([]byte, []byte, []byte, bool) error {
	t.Helper()
	ctx, store := newProbabilisticTestClientStore(t, "proof-vectors")
	cdc := newProbabilisticTestCodec()
	cs := newProbabilisticTestClientState()
	consensus := newProbabilisticTestConsensusState(testBlockHash("proof-anchor"))
	consensus.IbcStateRoot = nextSequenceRecvHex(t, vector.Root)
	setTestPacketSnapshot(t, consensus, cs.LatestHeight.RevisionHeight)
	require.NoError(t, cs.Initialize(ctx, cdc, store, consensus))
	cs, _ = getClientState(store, cdc)
	ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3*time.Minute + 2*time.Nanosecond))
	return func(key, value, proof []byte, membership bool) error {
		path := commitmenttypes.NewMerklePath("ibc", string(key))
		if membership {
			return cs.VerifyMembership(ctx, store, cdc, cs.LatestHeight, 0, 0, proof, path, value)
		}
		return cs.VerifyNonMembership(ctx, store, cdc, cs.LatestHeight, 0, 0, proof, path)
	}
}

func vectorProofProto(t *testing.T, vector stateProofVector) []byte {
	t.Helper()
	proof := &ics23.CommitmentProof{}
	if vector.Committed == "" {
		p, err := probabilisticcore.DecodeJSONNonExistenceProof(vector.Proof)
		require.NoError(t, err)
		proof.Proof = &ics23.CommitmentProof_Nonexist{Nonexist: p}
	} else {
		p, err := probabilisticcore.DecodeJSONExistenceProof(vector.Proof)
		require.NoError(t, err)
		proof.Proof = &ics23.CommitmentProof_Exist{Exist: p}
	}
	encoded, err := (&commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{proof}}).Marshal()
	require.NoError(t, err)
	require.Equal(t, vector.Protobuf, hex.EncodeToString(encoded), "SDK and Gateway must serialize the same proof bytes")
	return nextSequenceRecvHex(t, vector.Protobuf)
}

func TestPublicIbcStateProofVectors(t *testing.T) {
	for _, vector := range loadStateProofVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			verify := storedProofVerifier(t, vector)
			value, key := expectedProofValue(t, vector), []byte(vector.Key)
			membership := vector.Committed != ""
			for encoding, proof := range map[string][]byte{"json": vector.Proof, "protobuf": vectorProofProto(t, vector)} {
				t.Run(encoding, func(t *testing.T) {
					require.NoError(t, verify(key, value, proof, membership))
					require.Error(t, verify([]byte(vector.Key+"-wrong"), value, proof, membership))
					require.Error(t, verify(key, value, proof, !membership))
					if membership {
						wrong := bytes.Clone(value)
						wrong[len(wrong)-1] ^= 1
						require.Error(t, verify(key, wrong, proof, true))
					}
				})
			}
			// A different stored root must reject both existence and absence.
			wrong := vector
			root := nextSequenceRecvHex(t, vector.Root)
			root[0] ^= 1
			wrong.Root = hex.EncodeToString(root)
			require.Error(t, storedProofVerifier(t, wrong)(key, value, vector.Proof, membership))
			if vector.Name == "consensus_revision_1" {
				require.Error(t, verify([]byte("clients/07-tendermint-0/consensusStates/2-100"), value, vector.Proof, true))
				require.Error(t, verify([]byte("clients/07-tendermint-0/consensusStates/100"), value, vector.Proof, true))
			}
		})
	}
}

func TestClientProofRejectsUncommittedSettings(t *testing.T) {
	vector := loadStateProofVectors(t)[0]
	verify := storedProofVerifier(t, vector)
	for name, mutate := range map[string]func(*tm.ClientState){
		"missing specs":      func(s *tm.ClientState) { s.ProofSpecs = nil },
		"empty spec":         func(s *tm.ClientState) { s.ProofSpecs[0] = &ics23.ProofSpec{} },
		"nil leaf":           func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec = nil },
		"nil inner":          func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec = nil },
		"leaf hash":          func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec.Hash = ics23.HashOp_SHA512 },
		"prehash key":        func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec.PrehashKey = ics23.HashOp_SHA256 },
		"prehash value":      func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec.PrehashValue = ics23.HashOp_NO_HASH },
		"length":             func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec.Length = ics23.LengthOp_NO_PREFIX },
		"leaf prefix":        func(s *tm.ClientState) { s.ProofSpecs[0].LeafSpec.Prefix = []byte{1} },
		"child order":        func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.ChildOrder = []int32{1, 0} },
		"child size":         func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.ChildSize++ },
		"min prefix":         func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.MinPrefixLength++ },
		"max prefix":         func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.MaxPrefixLength++ },
		"empty child":        func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.EmptyChild = []byte{1} },
		"inner hash":         func(s *tm.ClientState) { s.ProofSpecs[0].InnerSpec.Hash = ics23.HashOp_SHA512 },
		"max depth":          func(s *tm.ClientState) { s.ProofSpecs[0].MaxDepth++ },
		"min depth":          func(s *tm.ClientState) { s.ProofSpecs[0].MinDepth++ },
		"prehash comparison": func(s *tm.ClientState) { s.ProofSpecs[0].PrehashKeyBeforeComparison = true },
		"proof order":        func(s *tm.ClientState) { s.ProofSpecs[0], s.ProofSpecs[1] = s.ProofSpecs[1], s.ProofSpecs[0] },
		"upgrade path":       func(s *tm.ClientState) { s.UpgradePath[0] = "different" },
		"allow expiry":       func(s *tm.ClientState) { s.AllowUpdateAfterExpiry = true },
		"allow misbehaviour": func(s *tm.ClientState) { s.AllowUpdateAfterMisbehaviour = true },
	} {
		t.Run(name, func(t *testing.T) {
			state := proofClientState()
			mutate(state)
			value := wrapProofValue(t, "/ibc.lightclients.tendermint.v1.ClientState", state)
			require.Error(t, verify([]byte(vector.Key), value, vectorProofProto(t, vector), true))
		})
	}
}

func TestMalformedCommittedConstructorsDoNotPanic(t *testing.T) {
	for _, vector := range loadStateProofVectors(t) {
		if vector.Name != "client" && vector.Name != "channel" && vector.Name != "connection" {
			continue
		}
		for _, invalid := range []any{nil, false, uint64(123), cbor.Tag{Number: 125, Content: []any{}}, cbor.Tag{Number: 121, Content: []any{uint64(1)}}} {
			t.Run(vector.Name, func(t *testing.T) {
				var committed any
				original := nextSequenceRecvHex(t, vector.Committed)
				switch vector.Name {
				case "client":
					var state datum.ClientStateDatum
					require.NoError(t, cbor.Unmarshal(original, &state))
					state.ProofSpecs[0].PrehashKeyBeforeComparison = invalid
					committed = state
				case "channel":
					var state datum.ChannelDatum
					require.NoError(t, cbor.Unmarshal(original, &state))
					state.Ordering = invalid
					committed = state
				case "connection":
					var state datum.ConnectionEndDatum
					require.NoError(t, cbor.Unmarshal(original, &state))
					state.State = invalid
					committed = state
				}
				encoded, err := cbor.Marshal(committed)
				require.NoError(t, err)
				proof, err := probabilisticcore.DecodeJSONExistenceProof(vector.Proof)
				require.NoError(t, err)
				proof.Value = encoded
				root, err := probabilisticcore.ComputeRootFromProofPath([]byte(vector.Key), encoded, proof.Path)
				require.NoError(t, err)
				vector.Root = hex.EncodeToString(root)
				mp := &commitmenttypes.MerkleProof{Proofs: []*ics23.CommitmentProof{{Proof: &ics23.CommitmentProof_Exist{Exist: proof}}}}
				wire, err := mp.Marshal()
				require.NoError(t, err)
				require.Error(t, storedProofVerifier(t, vector)([]byte(vector.Key), expectedProofValue(t, vector), wire, true))
			})
		}
	}
}

func TestPublicProofRejectsMalformedWire(t *testing.T) {
	for _, vector := range loadStateProofVectors(t) {
		if vector.Name != "client" && vector.Name != "absent_consensus" {
			continue
		}
		t.Run(vector.Name, func(t *testing.T) {
			verify := storedProofVerifier(t, vector)
			membership := vector.Committed != ""
			key, value := []byte(vector.Key), expectedProofValue(t, vector)
			for _, proof := range [][]byte{nil, {0xff}, {0x0a, 0xff}, []byte("null"), []byte("{}"), []byte(`{"proofs":[null]}`)} {
				require.Error(t, verify(key, value, proof, membership))
			}
			wire := vectorProofProto(t, vector)
			var mp commitmenttypes.MerkleProof
			require.NoError(t, mp.Unmarshal(wire))
			mp.Proofs = append(mp.Proofs, mp.Proofs[0])
			duplicate, err := mp.Marshal()
			require.NoError(t, err)
			require.Error(t, verify(key, value, duplicate, membership))
			var legacy struct {
				Proofs []json.RawMessage `json:"proofs"`
			}
			require.NoError(t, json.Unmarshal(vector.Proof, &legacy))
			legacy.Proofs = append(legacy.Proofs, legacy.Proofs[0])
			duplicate, err = json.Marshal(legacy)
			require.NoError(t, err)
			require.Error(t, verify(key, value, duplicate, membership))
		})
	}
}

func TestIbcProofDelaysRejectOverflow(t *testing.T) {
	for _, vector := range loadStateProofVectors(t) {
		if vector.Name != "client" && vector.Name != "absent_consensus" {
			continue
		}
		t.Run(vector.Name, func(t *testing.T) {
			ctx, store := newProbabilisticTestClientStore(t, "proof-delay-boundaries")
			cdc := newProbabilisticTestCodec()
			cs := newProbabilisticTestClientState()
			consensus := newProbabilisticTestConsensusState(testBlockHash("delay-anchor"))
			consensus.IbcStateRoot = nextSequenceRecvHex(t, vector.Root)
			setTestPacketSnapshot(t, consensus, cs.LatestHeight.RevisionHeight)
			require.NoError(t, cs.Initialize(ctx, cdc, store, consensus))
			cs, _ = getClientState(store, cdc)
			// Finish the independent epoch challenge window before isolating
			// the connection's time and block delays at a new processed point.
			ctx = ctx.WithBlockTime(ctx.BlockTime().Add(3*time.Minute + 2*time.Nanosecond)).WithBlockHeight(200)
			processedTime := uint64(ctx.BlockTime().UnixNano())
			processedHeight := uint64(ctx.BlockHeight())
			SetProcessedTime(store, cs.LatestHeight, processedTime)
			SetProcessedHeight(store, cs.LatestHeight, clienttypes.NewHeight(0, processedHeight))
			key, value, proof := []byte(vector.Key), expectedProofValue(t, vector), vectorProofProto(t, vector)
			path := commitmenttypes.NewMerklePath("ibc", string(key))
			for _, tc := range []struct {
				name                  string
				timeDelay, blockDelay uint64
				elapsedTime           time.Duration
				elapsedBlocks         int64
				pending               bool
			}{
				{name: "zero delays"},
				{name: "before time deadline", timeDelay: 10, blockDelay: 2, elapsedTime: 9, elapsedBlocks: 2, pending: true},
				{name: "before block deadline", timeDelay: 10, blockDelay: 2, elapsedTime: 10, elapsedBlocks: 1, pending: true},
				{name: "exact deadlines", timeDelay: 10, blockDelay: 2, elapsedTime: 10, elapsedBlocks: 2},
				{name: "after deadlines", timeDelay: 10, blockDelay: 2, elapsedTime: 11, elapsedBlocks: 3},
				{name: "time wraps to zero", timeDelay: math.MaxUint64 - processedTime + 1, pending: true},
				{name: "blocks wrap to zero", blockDelay: math.MaxUint64 - processedHeight + 1, pending: true},
				{name: "maximum time delay", timeDelay: math.MaxUint64, pending: true},
				{name: "maximum block delay", blockDelay: math.MaxUint64, pending: true},
				{name: "both delays overflow", timeDelay: math.MaxUint64, blockDelay: math.MaxUint64, pending: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					host := ctx.WithBlockTime(ctx.BlockTime().Add(tc.elapsedTime)).WithBlockHeight(ctx.BlockHeight() + tc.elapsedBlocks)
					var err error
					if vector.Committed != "" {
						err = cs.VerifyMembership(host, store, cdc, cs.LatestHeight, tc.timeDelay, tc.blockDelay, proof, path, value)
					} else {
						err = cs.VerifyNonMembership(host, store, cdc, cs.LatestHeight, tc.timeDelay, tc.blockDelay, proof, path)
					}
					if tc.pending {
						require.ErrorIs(t, err, ErrDelayPeriodNotPassed)
					} else {
						require.NoError(t, err)
					}
				})
			}
		})
	}
}
