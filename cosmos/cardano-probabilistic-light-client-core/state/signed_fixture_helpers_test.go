package state

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/kes"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/stretchr/testify/require"
)

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
