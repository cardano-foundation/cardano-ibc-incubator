package state

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/kes"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/stretchr/testify/require"
)

// Keep the first two blocks, then re-sign the other valid fixture's suffix
// against their predecessor. Both branches have genuine VRF and KES evidence.
func makeNativeTailFork(t *testing.T, header, fork *ProbabilisticHeader) *ProbabilisticHeader {
	t.Helper()
	result := cloneNativeHeader(t, header)
	previous := result.DescendantBlocks[0].Hash
	for i := 1; i < len(result.DescendantBlocks); i++ {
		block := cloneTestProbabilisticBlock(fork.DescendantBlocks[i])
		decoded, err := ledger.NewBabbageBlockHeaderFromCbor(block.HeaderCbor)
		require.NoError(t, err)
		prev, err := hex.DecodeString(previous)
		require.NoError(t, err)
		decoded.Body.PrevHash = ledger.NewBlake2b256(prev)
		producer := byte((block.Height.RevisionHeight - 11) % 11)
		secret, _, err := kes.KeyGen(6, bytes.Repeat([]byte{producer + 41}, 32))
		require.NoError(t, err)
		body, err := cbor.Encode(decoded.Body)
		require.NoError(t, err)
		decoded.Signature, err = kes.Sign(secret, 0, body)
		require.NoError(t, err)
		block.HeaderCbor, err = cbor.Encode(decoded)
		require.NoError(t, err)
		decoded, err = ledger.NewBabbageBlockHeaderFromCbor(block.HeaderCbor)
		require.NoError(t, err)
		block.Hash = decoded.Hash().String()
		result.DescendantBlocks[i] = block
		previous = block.Hash
	}
	return result
}

func loadNativeSettlementFixture(t *testing.T) nativeSettlementFixture {
	t.Helper()
	data, err := os.ReadFile("../testdata/native-settlement.json")
	require.NoError(t, err)
	var fixture nativeSettlementFixture
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotNil(t, fixture.TailFork)
	return fixture
}

func cloneNativeHeader(t *testing.T, header *ProbabilisticHeader) *ProbabilisticHeader {
	t.Helper()
	encoded, err := json.Marshal(header)
	require.NoError(t, err)
	var result ProbabilisticHeader
	require.NoError(t, json.Unmarshal(encoded, &result))
	return &result
}

// The synthetic blocks all have the same empty body. Restore that complete
// body when moving a former descendant into the committed prefix.
func nativeHeaderAtAnchor(t *testing.T, header *ProbabilisticHeader, height uint64) *ProbabilisticHeader {
	t.Helper()
	result := cloneNativeHeader(t, header)
	var fields []cbor.RawMessage
	_, err := cbor.Decode(result.AnchorBlock.BlockCbor, &fields)
	require.NoError(t, err)
	blocks := append([]*ProbabilisticBlock{result.AnchorBlock}, result.DescendantBlocks...)
	result.BridgeBlocks, result.DescendantBlocks = nil, nil
	for _, block := range blocks {
		if block.Height.RevisionHeight <= height {
			if len(block.HeaderCbor) > 0 {
				fields[0] = block.HeaderCbor
				block.BlockCbor, err = cbor.Encode(fields)
				require.NoError(t, err)
				block.HeaderCbor = nil
			}
			if block.Height.RevisionHeight == height {
				result.AnchorBlock = block
			} else {
				result.BridgeBlocks = append(result.BridgeBlocks, block)
			}
		} else {
			result.DescendantBlocks = append(result.DescendantBlocks, block)
		}
	}
	return result
}

func TestNativeMisbehaviourUsesSettledPrefixes(t *testing.T) {
	fixture := loadNativeSettlementFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "settled-prefix")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, found := GetClientState(store, cdc)
	require.True(t, found)
	for _, height := range []uint64{12, 13} {
		t.Run(NewHeight(0, height).String(), func(t *testing.T) {
			later := nativeHeaderAtAnchor(t, fixture.TailFork, height)
			// At height 12 both anchors agree with the other observation. At
			// height 13 the later anchor differs from an earlier temporary block.
			for _, header := range []*ProbabilisticHeader{fixture.Header, later} {
				require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, header))
			}
			for _, pair := range [][2]*ProbabilisticHeader{{fixture.Header, later}, {later, fixture.Header}} {
				evidence := &Misbehaviour{ProbabilisticHeader1: pair[0], ProbabilisticHeader2: pair[1]}
				require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, evidence), ErrIBCInvalidMisbehaviour)
				require.False(t, client.CheckForMisbehaviour(ctx, cdc, store, evidence))
			}
		})
	}

	// A mismatch at the earlier anchor is incompatible settled ancestry.
	laterFork := nativeHeaderAtAnchor(t, fixture.Fork, 12)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, laterFork))
	evidence := &Misbehaviour{ProbabilisticHeader1: fixture.Header, ProbabilisticHeader2: laterFork}
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, evidence))
	require.True(t, client.CheckForMisbehaviour(ctx, cdc, store, evidence))
}

func TestNativeMisbehaviourStoredConsensusUsesSettledPrefix(t *testing.T) {
	fixture := loadNativeSettlementFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "stored-settled-prefix")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, found := GetClientState(store, cdc)
	require.True(t, found)
	later := nativeHeaderAtAnchor(t, fixture.Header, 12)
	for _, header := range []*ProbabilisticHeader{fixture.Header, later} {
		require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, header))
	}
	// A stored claim above both anchors cannot turn their temporary tails
	// into settled claims. Both observations differ from this stored hash.
	stored := newProbabilisticTestConsensusState(fixture.TailFork.DescendantBlocks[1].Hash)
	SetConsensusState(store, cdc, stored, NewHeight(0, 13))
	evidence := &Misbehaviour{ProbabilisticHeader1: fixture.Header, ProbabilisticHeader2: later}
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, evidence), ErrIBCInvalidMisbehaviour)
	for _, message := range []any{fixture.Header, later, evidence} {
		require.False(t, client.CheckForMisbehaviour(ctx, cdc, store, message))
	}
	// Once that disputed block is itself an anchor, the same hash difference
	// is a settled conflict against the stored consensus state.
	settled := nativeHeaderAtAnchor(t, fixture.Header, 13)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, settled))
	require.True(t, client.CheckForMisbehaviour(ctx, cdc, store, settled))
	settledEvidence := &Misbehaviour{ProbabilisticHeader1: fixture.Header, ProbabilisticHeader2: settled}
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, settledEvidence))
}

func TestNativeMisbehaviourAtRootlessTrustedBoundary(t *testing.T) {
	fixture := loadNativeSettlementFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "rootless-settled-boundary")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, found := GetClientState(store, cdc)
	require.True(t, found)
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, fixture.Header))
	client.UpdateState(ctx, cdc, store, fixture.Header)
	client, found = GetClientState(store, cdc)
	require.True(t, found)
	_, found = GetConsensusState(store, cdc, fixture.Header.GetHeight())
	require.False(t, found)

	later := nativeHeaderAtAnchor(t, fixture.Header, 12)
	later.TrustedHeight = fixture.Header.GetHeight()
	later.BridgeBlocks = nil
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, later))
	compatible := &Misbehaviour{ProbabilisticHeader1: later, ProbabilisticHeader2: fixture.Header}
	require.ErrorIs(t, client.VerifyClientMessage(ctx, cdc, store, compatible), ErrIBCInvalidMisbehaviour)
	require.False(t, client.CheckForMisbehaviour(ctx, cdc, store, compatible))

	// The earlier fork conflicts with the authenticated previous hash in the
	// later anchor. There is no shared bridge block or stored root at height 11.
	conflicting := &Misbehaviour{ProbabilisticHeader1: later, ProbabilisticHeader2: fixture.Fork}
	require.NoError(t, client.VerifyClientMessage(ctx, cdc, store, conflicting))
	require.True(t, client.CheckForMisbehaviour(ctx, cdc, store, conflicting))
}
