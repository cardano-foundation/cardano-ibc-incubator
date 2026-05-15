package stability

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	ics23 "github.com/cosmos/ics23/go"
	"github.com/stretchr/testify/require"
)

func TestVerifyUpgradeAndUpdateStateSucceedsWithCommittedUpgradeStates(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.NoError(t, err)

	storedClient, found := getClientState(fixture.clientStore, fixture.cdc)
	require.True(t, found)
	require.Equal(t, "cardano-test-v2", storedClient.ChainId)
	require.True(t, storedClient.FrozenHeight.IsZero())
	require.Equal(t, fixture.oldClient.HeuristicParams, storedClient.HeuristicParams)

	storedConsensus, found := GetConsensusState(fixture.clientStore, fixture.cdc, fixture.oldClient.LatestHeight)
	require.True(t, found)
	require.Equal(t, "hash-upgraded", storedConsensus.AcceptedBlockHash)
	require.Equal(t, fixture.upgradedConsensus.IbcStateRoot, storedConsensus.IbcStateRoot)

	scoreBz := fixture.clientStore.Get(StabilityScoreKey(fixture.oldClient.LatestHeight.RevisionHeight))
	require.Equal(t, fixture.upgradedConsensus.SecurityScoreBps, binary.BigEndian.Uint64(scoreBz))
	require.Equal(t, []byte("hash-upgraded"), fixture.clientStore.Get(AcceptedBlockHashKey(fixture.oldClient.LatestHeight.RevisionHeight)))
}

func TestVerifyUpgradeAndUpdateStateRejectsSecurityParameterChanges(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ClientState)
	}{
		{
			name: "trusting period",
			mutate: func(cs *ClientState) {
				cs.TrustingPeriod += time.Hour
			},
		},
		{
			name: "heuristic params",
			mutate: func(cs *ClientState) {
				cs.HeuristicParams.ThresholdUniqueStakeBps++
			},
		},
		{
			name: "upgrade path",
			mutate: func(cs *ClientState) {
				cs.UpgradePath = []string{"different", "upgradedIBCState"}
			},
		},
		{
			name: "host state policy",
			mutate: func(cs *ClientState) {
				cs.HostStateNftPolicyId = bytes.Repeat([]byte{0x09}, 28)
			},
		},
		{
			name: "host state token",
			mutate: func(cs *ClientState) {
				cs.HostStateNftTokenName = []byte("different-host-state")
			},
		},
		{
			name: "system start",
			mutate: func(cs *ClientState) {
				cs.SystemStartUnixNs++
			},
		},
		{
			name: "slot length",
			mutate: func(cs *ClientState) {
				cs.SlotLengthNs++
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fixture := newStabilityUpgradeFixture(t)
			tt.mutate(fixture.upgradedClient)
			fixture.recommitUpgrade(t)

			err := fixture.oldClient.VerifyUpgradeAndUpdateState(
				fixture.ctx,
				fixture.cdc,
				fixture.clientStore,
				fixture.upgradedClientBz,
				fixture.upgradedConsensusBz,
				fixture.upgradedClient,
				fixture.upgradedConsensus,
				fixture.upgradedClientProof,
				fixture.upgradedConsensusProof,
			)
			require.Error(t, err)
		})
	}
}

func TestVerifyUpgradeAndUpdateStateRejectsWrongHeight(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	fixture.upgradedClient.LatestHeight = NewHeight(0, fixture.oldClient.LatestHeight.RevisionHeight+1)
	fixture.recommitUpgrade(t)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.ErrorContains(t, err, "must equal current latest height")
}

func TestVerifyUpgradeAndUpdateStateRejectsInactiveClient(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	fixture.oldClient.FrozenHeight = NewHeight(0, 1)
	setClientState(fixture.clientStore, fixture.cdc, fixture.oldClient)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.ErrorContains(t, err, "client must be active")
}

func TestVerifyUpgradeAndUpdateStateRejectsExpiredClient(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	oldConsensus, found := GetConsensusState(fixture.clientStore, fixture.cdc, fixture.oldClient.LatestHeight)
	require.True(t, found)
	oldConsensus.Timestamp = uint64(fixture.ctx.BlockTime().Add(-2 * fixture.oldClient.TrustingPeriod).UnixNano())
	setConsensusState(fixture.clientStore, fixture.cdc, oldConsensus, fixture.oldClient.LatestHeight)
	setClientState(fixture.clientStore, fixture.cdc, fixture.oldClient)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.ErrorContains(t, err, "client must be active")
}

func TestVerifyUpgradeAndUpdateStateRejectsInvalidConsensusState(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	fixture.upgradedConsensus.IbcStateRoot = []byte{0x01}
	fixture.recommitUpgrade(t)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.ErrorContains(t, err, "upgraded consensus state failed validation")
}

func TestVerifyUpgradeAndUpdateStateRejectsInvalidClientState(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	fixture.upgradedClient.ChainId = ""
	fixture.recommitUpgrade(t)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.ErrorContains(t, err, "upgraded client state failed validation")
}

func TestVerifyUpgradeAndUpdateStateRejectsWrongProofPath(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	wrongKey := []byte("upgrade/wrong/10/upgradedClient")
	wrongPaths := map[string][]*ics23.InnerOp{
		string(wrongKey): fixture.proofPaths[string(upgradeClientKey(fixture.oldClient.UpgradePath, fixture.oldClient.LatestHeight))],
	}
	fixture.upgradedClientProof = mustSparseMembershipProof(t, wrongKey, fixture.upgradedClientBz, wrongPaths)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.Error(t, err)
}

func TestVerifyUpgradeAndUpdateStateRejectsDifferentCommittedBytes(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	tamperedClientBz := append([]byte(nil), fixture.upgradedClientBz...)
	tamperedClientBz[len(tamperedClientBz)-1] ^= 0x01

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		tamperedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.Error(t, err)
}

func TestVerifyUpgradeAndUpdateStateRejectsDifferentCommittedConsensusBytes(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)
	tamperedConsensusBz := append([]byte(nil), fixture.upgradedConsensusBz...)
	tamperedConsensusBz[len(tamperedConsensusBz)-1] ^= 0x01

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		tamperedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.Error(t, err)
}

func TestVerifyUpgradeAndUpdateStateCannotReplayAfterConsensusRootChanges(t *testing.T) {
	fixture := newStabilityUpgradeFixture(t)

	err := fixture.oldClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.NoError(t, err)

	upgradedClient, found := getClientState(fixture.clientStore, fixture.cdc)
	require.True(t, found)
	err = upgradedClient.VerifyUpgradeAndUpdateState(
		fixture.ctx,
		fixture.cdc,
		fixture.clientStore,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClient,
		fixture.upgradedConsensus,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.Error(t, err)
}

func TestLightClientModuleVerifyUpgradeAndUpdateStateDelegatesToClientState(t *testing.T) {
	ctx, clientStore, module, clientID := newStabilityTestModule(t, "stability-upgrade-module")
	fixture := newStabilityUpgradeFixtureWithStore(t, ctx, clientStore)

	err := module.VerifyUpgradeAndUpdateState(
		ctx,
		clientID,
		fixture.upgradedClientBz,
		fixture.upgradedConsensusBz,
		fixture.upgradedClientProof,
		fixture.upgradedConsensusProof,
	)
	require.NoError(t, err)
}

type stabilityUpgradeFixture struct {
	ctx                    sdk.Context
	cdc                    codec.BinaryCodec
	clientStore            storetypes.KVStore
	oldClient              *ClientState
	upgradedClient         *ClientState
	upgradedConsensus      *ConsensusState
	upgradedClientBz       []byte
	upgradedConsensusBz    []byte
	upgradedClientProof    []byte
	upgradedConsensusProof []byte
	proofPaths             map[string][]*ics23.InnerOp
}

func newStabilityUpgradeFixture(t *testing.T) *stabilityUpgradeFixture {
	t.Helper()

	cdc := newStabilityTestCodec()
	ctx, clientStore := newStabilityTestClientStore(t, "stability-upgrade")
	return newStabilityUpgradeFixtureWithStore(t, ctx, clientStore, cdc)
}

func newStabilityUpgradeFixtureWithStore(
	t *testing.T,
	ctx sdk.Context,
	clientStore storetypes.KVStore,
	cdcOpt ...codec.BinaryCodec,
) *stabilityUpgradeFixture {
	t.Helper()

	cdc := newStabilityTestCodec()
	if len(cdcOpt) > 0 {
		cdc = cdcOpt[0]
	}
	oldClient := newStabilityTestClientState()
	oldClient.UpgradePath = []string{"upgrade", "upgradedIBCState"}
	require.NoError(t, oldClient.Validate())

	upgradedClient := cloneStabilityClientState(t, cdc, oldClient)
	upgradedClient.ChainId = "cardano-test-v2"
	upgradedClient.FrozenHeight = NewHeight(0, 7)

	upgradedConsensus := newStabilityTestConsensusState("hash-upgraded")
	upgradedConsensus.IbcStateRoot = bytes.Repeat([]byte{0x22}, 32)
	upgradedConsensus.SecurityScoreBps = 9_999
	require.NoError(t, upgradedConsensus.ValidateBasic())

	fixture := &stabilityUpgradeFixture{
		ctx:               ctx,
		cdc:               cdc,
		clientStore:       clientStore,
		oldClient:         oldClient,
		upgradedClient:    upgradedClient,
		upgradedConsensus: upgradedConsensus,
	}
	fixture.recommitUpgrade(t)

	setClientState(clientStore, cdc, oldClient)
	oldConsensus := newStabilityTestConsensusState("hash-old")
	oldConsensus.IbcStateRoot = fixture.committedRoot(t)
	setConsensusState(clientStore, cdc, oldConsensus, oldClient.LatestHeight)
	setConsensusMetadata(ctx, clientStore, oldClient.LatestHeight)

	return fixture
}

func (f *stabilityUpgradeFixture) recommitUpgrade(t *testing.T) {
	t.Helper()

	var err error
	f.upgradedClientBz, err = f.cdc.Marshal(f.upgradedClient)
	require.NoError(t, err)
	f.upgradedConsensusBz, err = f.cdc.Marshal(f.upgradedConsensus)
	require.NoError(t, err)

	clientKey := upgradeClientKey(f.oldClient.UpgradePath, f.oldClient.LatestHeight)
	consKey := upgradeConsensusKey(f.oldClient.UpgradePath, f.oldClient.LatestHeight)
	values := map[string][]byte{
		string(clientKey): f.upgradedClientBz,
		string(consKey):   f.upgradedConsensusBz,
	}
	root, paths := buildSparseProofs(values)
	f.proofPaths = paths
	f.upgradedClientProof = mustSparseMembershipProof(t, clientKey, f.upgradedClientBz, paths)
	f.upgradedConsensusProof = mustSparseMembershipProof(t, consKey, f.upgradedConsensusBz, paths)

	oldConsensus, found := GetConsensusState(f.clientStore, f.cdc, f.oldClient.LatestHeight)
	if found {
		oldConsensus.IbcStateRoot = root
		setConsensusState(f.clientStore, f.cdc, oldConsensus, f.oldClient.LatestHeight)
	}
}

func (f *stabilityUpgradeFixture) committedRoot(t *testing.T) []byte {
	t.Helper()
	clientKey := upgradeClientKey(f.oldClient.UpgradePath, f.oldClient.LatestHeight)
	return computeSparseRootFromProof(clientKey, f.upgradedClientBz, f.proofPaths[string(clientKey)])
}

func cloneStabilityClientState(t *testing.T, cdc codec.BinaryCodec, cs *ClientState) *ClientState {
	t.Helper()
	bz, err := cdc.Marshal(cs)
	require.NoError(t, err)
	var clone ClientState
	require.NoError(t, cdc.Unmarshal(bz, &clone))
	return &clone
}

func upgradeClientKey(upgradePath []string, height *Height) []byte {
	return constructUpgradeClientMerklePath(upgradePath, height).KeyPath[0]
}

func upgradeConsensusKey(upgradePath []string, height *Height) []byte {
	return constructUpgradeConsStateMerklePath(upgradePath, height).KeyPath[0]
}

func buildSparseProofs(values map[string][]byte) ([]byte, map[string][]*ics23.InnerOp) {
	type leaf struct {
		key   []byte
		value []byte
		index uint64
	}

	leaves := make([]leaf, 0, len(values))
	level := make(map[uint64][]byte, len(values))
	for key, value := range values {
		keyBz := []byte(key)
		index := sparseIndex(keyBz)
		leaves = append(leaves, leaf{key: keyBz, value: value, index: index})
		level[index] = sparseLeafHash(keyBz, value)
	}

	paths := make(map[string][]*ics23.InnerOp, len(values))
	for _, leaf := range leaves {
		paths[string(leaf.key)] = make([]*ics23.InnerOp, 0, 64)
	}

	for depth := 0; depth < 64; depth++ {
		for _, leaf := range leaves {
			nodeIndex := leaf.index >> uint(depth)
			siblingHash := level[nodeIndex^1]
			if len(siblingHash) == 0 {
				siblingHash = make([]byte, 32)
			}
			if nodeIndex&1 == 0 {
				paths[string(leaf.key)] = append(paths[string(leaf.key)], &ics23.InnerOp{
					Hash:   ics23.HashOp_SHA256,
					Prefix: []byte{0x01},
					Suffix: siblingHash,
				})
			} else {
				prefix := append([]byte{0x01}, siblingHash...)
				paths[string(leaf.key)] = append(paths[string(leaf.key)], &ics23.InnerOp{
					Hash:   ics23.HashOp_SHA256,
					Prefix: prefix,
					Suffix: []byte{},
				})
			}
		}

		next := make(map[uint64][]byte)
		seenParents := make(map[uint64]struct{})
		for index := range level {
			parent := index >> 1
			if _, seen := seenParents[parent]; seen {
				continue
			}
			seenParents[parent] = struct{}{}
			left := level[parent<<1]
			right := level[parent<<1|1]
			if len(left) == 0 {
				left = make([]byte, 32)
			}
			if len(right) == 0 {
				right = make([]byte, 32)
			}
			parentHash := sparseInnerHash(left, right)
			if !bytes.Equal(parentHash, make([]byte, 32)) {
				next[parent] = parentHash
			}
		}
		level = next
	}

	root := level[0]
	if len(root) == 0 {
		root = make([]byte, 32)
	}
	return root, paths
}

func mustSparseMembershipProof(t *testing.T, key []byte, value []byte, paths map[string][]*ics23.InnerOp) []byte {
	t.Helper()
	path := paths[string(key)]
	require.Len(t, path, 64)

	type jsonInnerOp struct {
		Prefix string `json:"prefix"`
		Suffix string `json:"suffix"`
	}
	type jsonExist struct {
		Key   string        `json:"key"`
		Value string        `json:"value"`
		Path  []jsonInnerOp `json:"path"`
	}
	type jsonProof struct {
		Exist *jsonExist `json:"exist,omitempty"`
	}
	type jsonMerkleProof struct {
		Proofs []jsonProof `json:"proofs"`
	}

	ops := make([]jsonInnerOp, 0, len(path))
	for _, op := range path {
		ops = append(ops, jsonInnerOp{
			Prefix: hex.EncodeToString(op.Prefix),
			Suffix: hex.EncodeToString(op.Suffix),
		})
	}

	bz, err := json.Marshal(jsonMerkleProof{
		Proofs: []jsonProof{
			{
				Exist: &jsonExist{
					Key:   hex.EncodeToString(key),
					Value: hex.EncodeToString(value),
					Path:  ops,
				},
			},
		},
	})
	require.NoError(t, err)
	return bz
}

func computeSparseRootFromProof(key []byte, value []byte, path []*ics23.InnerOp) []byte {
	current := sparseLeafHash(key, value)
	index := sparseIndex(key)
	for depth, op := range path {
		direction := (index >> uint(depth)) & 1
		if direction == 0 {
			current = sparseInnerHash(current, op.Suffix)
		} else {
			current = sparseInnerHash(op.Prefix[1:], current)
		}
	}
	return current
}

func sparseIndex(key []byte) uint64 {
	keyHash := sha256.Sum256(key)
	return binary.BigEndian.Uint64(keyHash[0:8])
}

func sparseLeafHash(key []byte, value []byte) []byte {
	valueHash := sha256.Sum256(value)
	if bytes.Equal(valueHash[:], emptyValueHashForTest()) {
		return make([]byte, 32)
	}
	keyHash := sha256.Sum256(key)
	preimage := make([]byte, 0, 65)
	preimage = append(preimage, 0x00)
	preimage = append(preimage, keyHash[:]...)
	preimage = append(preimage, valueHash[:]...)
	h := sha256.Sum256(preimage)
	return h[:]
}

func sparseInnerHash(left []byte, right []byte) []byte {
	if bytes.Equal(left, make([]byte, 32)) && bytes.Equal(right, make([]byte, 32)) {
		return make([]byte, 32)
	}
	preimage := make([]byte, 0, 65)
	preimage = append(preimage, 0x01)
	preimage = append(preimage, left...)
	preimage = append(preimage, right...)
	h := sha256.Sum256(preimage)
	return h[:]
}

func emptyValueHashForTest() []byte {
	h := sha256.Sum256([]byte{})
	return h[:]
}
