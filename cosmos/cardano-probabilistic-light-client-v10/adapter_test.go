package probabilistic

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"golang.org/x/crypto/blake2b"
	"strings"
	"testing"
	"time"

	"cosmossdk.io/log"
	store "cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func newProbabilisticTestCodec() codec.BinaryCodec {
	registry := codectypes.NewInterfaceRegistry()
	RegisterInterfaces(registry)
	return codec.NewProtoCodec(registry)
}

func newProbabilisticTestClientStore(t *testing.T, keyName string) (sdk.Context, storetypes.KVStore) {
	t.Helper()

	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	key := storetypes.NewKVStoreKey(keyName)

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	require.NoError(t, stateStore.LoadLatestVersion())

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "cardano-probabilistic-test",
		Height:  100,
		Time:    time.Unix(1_700_000_000, 0),
	}, false, log.NewNopLogger())

	return ctx, stateStore.GetKVStore(key)
}

func newProbabilisticTestClientState() *ClientState {
	zeroHeight := ZeroHeight()
	epochStakeDistribution := []*StakeDistributionEntry{
		{
			PoolId:                   "pool-a",
			Stake:                    10_000,
			VrfKeyHash:               bytes.Repeat([]byte{0x02}, 32),
			FirstRegistrationSlot:    0,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 1,
		},
	}
	epochNonce := bytes.Repeat([]byte{0x03}, 32)
	return &ClientState{
		ChainId:                            "cardano-test",
		LatestHeight:                       &Height{RevisionHeight: 10},
		FrozenHeight:                       zeroHeight,
		CurrentEpoch:                       7,
		TrustingPeriod:                     24 * time.Hour,
		HostStateNftPolicyId:               bytes.Repeat([]byte{0x01}, 28),
		PacketLanePolicyId:                 bytes.Repeat([]byte{0x04}, 28),
		HostStateNftTokenName:              []byte("host-state"),
		EpochStakeDistribution:             cloneStakeDistributionEntries(epochStakeDistribution),
		EpochNonce:                         bytes.Clone(epochNonce),
		LatestCheckpointPoolRegistry:       testAdapterPoolRegistry(7, epochStakeDistribution),
		LatestCheckpointNonceState:         &PraosNonceState{EpochNonce: bytes.Clone(epochNonce), EvolvingNonce: bytes.Repeat([]byte{0x41}, 32), CandidateNonce: bytes.Repeat([]byte{0x42}, 32), LastAppliedBlockNonce: bytes.Repeat([]byte{0x43}, 32), LastEpochBlockNonce: bytes.Repeat([]byte{0x44}, 32)},
		RandomnessStabilisationWindowSlots: 10,
		SlotsPerKesPeriod:                  129600,
		MaxKesEvolutions:                   62,
		ActiveSlotCoefficientNumerator:     1,
		ActiveSlotCoefficientDenominator:   20,
		MaxClockDrift:                      time.Minute,
		OperationalCertificateCounterHistoryStartHeight: NewHeight(0, 10),
		CurrentEpochStartSlot:                           0,
		CurrentEpochEndSlotExclusive:                    1_000_000,
		SystemStartUnixNs:                               1_700_000_000_000_000_000,
		SlotLengthNs:                                    1_000_000_000,
		EpochContexts: []*EpochContext{
			{
				Epoch:                 7,
				StakeDistribution:     epochStakeDistribution,
				EpochNonce:            epochNonce,
				SlotsPerKesPeriod:     129600,
				EpochStartSlot:        0,
				EpochEndSlotExclusive: 1_000_000,
			},
		},
	}
}

func newProbabilisticTestConsensusState(acceptedBlockHash string, heights ...uint64) *ConsensusState {
	height := uint64(10)
	if len(heights) > 0 {
		height = heights[0]
	}
	snapshot, _ := probabilisticcore.EncodePacketStateSnapshot(probabilisticcore.PacketStateSnapshot{
		Height: height, BlockHash: acceptedBlockHash, HostTxHash: strings.Repeat("22", 32),
		HostRoot: bytes.Repeat([]byte{0x11}, 32), Lanes: map[string]probabilisticcore.TrackedPacketLane{},
	})
	return &ConsensusState{
		PacketStateSnapshot: snapshot,
		NonceState:          newProbabilisticTestClientState().LatestCheckpointNonceState,
		PoolRegistry:        newProbabilisticTestClientState().LatestCheckpointPoolRegistry,
		Timestamp:           uint64(time.Unix(1_700_000_000, 0).UnixNano()),
		IbcStateRoot:        bytes.Repeat([]byte{0x11}, 32),
		AcceptedBlockHash:   acceptedBlockHash,
		AcceptedEpoch:       7,
		UniquePoolsCount:    1,
		UniqueStakeBps:      10_000,
		SecurityScoreBps:    10_000,
	}
}

func setTestCheckpoint(
	t testing.TB,
	clientState *ClientState,
	height *Height,
	hash string,
	epoch uint64,
	slot uint64,
) {
	t.Helper()
	timestamp, err := clientState.DeriveTimestampFromSlot(slot)
	require.NoError(t, err)
	clientState.LatestCheckpointHeight = height
	clientState.LatestCheckpointBlockHash = hash
	clientState.LatestCheckpointEpoch = epoch
	clientState.LatestCheckpointSlot = slot
	clientState.LatestCheckpointTimestamp = timestamp
}

func newVerifiedTestHeader(t *testing.T) *ProbabilisticHeader {
	t.Helper()

	trustedHash := bytes.Repeat([]byte{0x11}, 32)
	bridge := makeTestProbabilisticBlock(t, 11, 110, hex.EncodeToString(trustedHash))
	anchor := makeTestProbabilisticBlock(t, 12, 120, bridge.Hash)
	descendant := makeTestProbabilisticBlock(t, 13, 130, anchor.Hash)

	return &ProbabilisticHeader{
		TrustedHeight:          &Height{RevisionHeight: 10},
		BridgeBlocks:           []*ProbabilisticBlock{bridge},
		AnchorBlock:            anchor,
		DescendantBlocks:       []*ProbabilisticBlock{descendant},
		HostStateTxHash:        "deadbeef",
		HostStateTxOutputIndex: 0,
	}
}

func makeTestProbabilisticBlock(t testing.TB, blockNumber, slot uint64, prevHashHex string) *ProbabilisticBlock {
	t.Helper()

	block := ledger.BabbageBlock{
		BlockHeader: &ledger.BabbageBlockHeader{},
	}
	block.BlockHeader.Body.BlockNumber = blockNumber
	block.BlockHeader.Body.Slot = slot
	if prevHashHex != "" {
		prevHashBytes, err := hex.DecodeString(prevHashHex)
		require.NoError(t, err)
		block.BlockHeader.Body.PrevHash = ledger.NewBlake2b256(prevHashBytes)
	}

	// Hash the exact encoded body components, just as ledger validation does.
	initial, err := cbor.Encode(block)
	require.NoError(t, err)
	var fields []cbor.RawMessage
	_, err = cbor.Decode(initial, &fields)
	require.NoError(t, err)
	hashes := []byte{}
	for _, field := range fields[1:] {
		hash := blake2b.Sum256(field)
		hashes = append(hashes, hash[:]...)
	}
	hash := blake2b.Sum256(hashes)
	block.BlockHeader.Body.BlockBodyHash = ledger.NewBlake2b256(hash[:])
	blockCbor, err := cbor.Encode(block)
	require.NoError(t, err)
	_, err = cbor.Decode(blockCbor, &block)
	require.NoError(t, err)

	return &ProbabilisticBlock{
		Height:    &Height{RevisionHeight: block.BlockNumber()},
		Hash:      block.Hash().String(),
		Slot:      block.SlotNumber(),
		Epoch:     7,
		Timestamp: 1_700_000_000_000_000_000 + block.SlotNumber()*1_000_000_000,
		BlockCbor: blockCbor,
	}
}

func mustTestBlockPrevHash(t *testing.T, block *ProbabilisticBlock) string {
	t.Helper()

	decodedBlock, err := probabilisticcore.DecodeLedgerBlock(block.BlockCbor)
	require.NoError(t, err)

	prevHash, err := probabilisticcore.BlockPrevHash(decodedBlock)
	require.NoError(t, err)

	return prevHash
}

func cloneTestProbabilisticBlock(block *ProbabilisticBlock) *ProbabilisticBlock {
	if block == nil {
		return nil
	}
	clone := *block
	if block.Height != nil {
		height := *block.Height
		clone.Height = &height
	}
	if block.BlockCbor != nil {
		clone.BlockCbor = append([]byte(nil), block.BlockCbor...)
	}
	if block.HeaderCbor != nil {
		clone.HeaderCbor = append([]byte(nil), block.HeaderCbor...)
	}
	return &clone
}

func TestInitialStateWithFourThousandPoolsStaysBelowOneMegabyte(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	stakeDistribution := make([]*StakeDistributionEntry, 0, 4_000)
	counters := make([]*OperationalCertificateCounter, 0, 4_000)
	for index := uint32(1); index <= 4_000; index++ {
		poolID := make([]byte, 28)
		binary.BigEndian.PutUint32(poolID[24:], index)
		vrfKeyHash := make([]byte, 32)
		binary.BigEndian.PutUint32(vrfKeyHash[28:], index)
		stakeDistribution = append(stakeDistribution, &StakeDistributionEntry{
			PoolId:                   hex.EncodeToString(poolID),
			Stake:                    1,
			VrfKeyHash:               vrfKeyHash,
			FirstRegistrationSlot:    0,
			RelativeStakeNumerator:   1,
			RelativeStakeDenominator: 4_000,
		})
		counters = append(counters, &OperationalCertificateCounter{
			PoolId:         poolID,
			SequenceNumber: 1,
		})
	}
	clientState.EpochStakeDistribution = cloneStakeDistributionEntries(stakeDistribution)
	clientState.EpochContexts[0].StakeDistribution = stakeDistribution
	clientState.LatestCheckpointOperationalCertificateCounters = counters
	clientBytes, err := clientState.Marshal()
	require.NoError(t, err)
	consensusBytes, err := newProbabilisticTestConsensusState(testBlockHash("initial-block-hash")).Marshal()
	require.NoError(t, err)

	require.Less(t, len(clientBytes)+len(consensusBytes), 1_000_000)
	require.Less(t, len(consensusBytes), 1_000)
}
func TestIBCGenesisValidationAcceptsOperationalCertificateState(t *testing.T) {
	clientID := ModuleName + "-0"
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState(testBlockHash("initial-hash"))
	genesis := clienttypes.NewGenesisState(
		[]clienttypes.IdentifiedClientState{clienttypes.NewIdentifiedClientState(clientID, clientState)},
		clienttypes.ClientsConsensusStates{clienttypes.NewClientConsensusStates(
			clientID,
			[]clienttypes.ConsensusStateWithHeight{
				clienttypes.NewConsensusStateWithHeight(clienttypes.NewHeight(0, 10), consensusState),
			},
		)},
		nil,
		clienttypes.DefaultParams(),
		false,
		1,
	)
	require.NoError(t, genesis.Validate())
}

func TestLegacyClientStateWireDecodesNewTemporalFieldsAsZero(t *testing.T) {
	legacyWire, err := hex.DecodeString(
		"0a0c63617264616e6f2d746573741202100a20079a0102100aa20107686173682d3130a80107b0013ec20102100a",
	)
	require.NoError(t, err)

	var decoded ClientState
	require.NoError(t, decoded.Unmarshal(legacyWire))
	require.Equal(t, "cardano-test", decoded.ChainId)
	require.EqualValues(t, 10, decoded.LatestCheckpointHeight.RevisionHeight)
	require.Equal(t, "hash-10", decoded.LatestCheckpointBlockHash)
	require.EqualValues(t, 7, decoded.LatestCheckpointEpoch)
	require.Zero(t, decoded.MaxClockDrift)
	require.Zero(t, decoded.LatestCheckpointSlot)
	require.Zero(t, decoded.LatestCheckpointTimestamp)
}
func cloneStakeDistributionEntries(entries []*StakeDistributionEntry) []*StakeDistributionEntry {
	return mapCoreSlice(entries, func(e *StakeDistributionEntry) *StakeDistributionEntry {
		return fromCoreStakeDistributionEntry(toCoreStakeDistributionEntry(e))
	})
}

func testBlockHash(label string) string {
	hash := blake2b.Sum256([]byte(label))
	return hex.EncodeToString(hash[:])
}

func setTestPacketSnapshot(t testing.TB, consensus *ConsensusState, height uint64) {
	t.Helper()
	raw, err := probabilisticcore.EncodePacketStateSnapshot(probabilisticcore.PacketStateSnapshot{
		Height: height, BlockHash: consensus.AcceptedBlockHash, HostTxHash: strings.Repeat("22", 32),
		HostRoot: consensus.IbcStateRoot, Lanes: map[string]probabilisticcore.TrackedPacketLane{},
	})
	require.NoError(t, err)
	consensus.PacketStateSnapshot = raw
}

// This only seeds synthetic test fixtures. Production bootstrap uses an independent checkpoint.
func testAdapterPoolRegistry(epoch uint64, entries []*StakeDistributionEntry) *PoolRegistryState {
	result := &PoolRegistryState{Epoch: epoch}
	for _, entry := range entries {
		binding := &PoolRegistrationBinding{PoolId: entry.PoolId, VrfKeyHash: bytes.Clone(entry.VrfKeyHash), FirstRegistrationSlot: entry.FirstRegistrationSlot}
		result.Pools = append(result.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		result.Mark = append(result.Mark, binding)
		result.Effective = append(result.Effective, binding)
	}
	return result
}
