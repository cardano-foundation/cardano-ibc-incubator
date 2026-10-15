package probabilistic

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	corestate "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

type capacityFixture struct {
	Client       *ClientState
	Consensus    *ConsensusState
	Header, Fork *ProbabilisticHeader
}

func capacityEvidence(t *testing.T, name string) capacityFixture {
	t.Helper()
	var f capacityFixture
	require.NoError(t, json.Unmarshal(readBoundaryGzip(t, "native-boundary-"+name+".json.gz"), &f))
	// Keep observed producers' shares at 2% with a full 4,000-pool registry.
	for i := len(f.Client.EpochStakeDistribution); i < corestate.MaxStakeEntries; i++ {
		hash := blake2b.Sum256([]byte(fmt.Sprintf("registered-test-pool-%d", i)))
		binding := &PoolRegistrationBinding{PoolId: ledger.NewBlake2b224(hash[:28]).Bech32("pool"), VrfKeyHash: bytes.Clone(hash[:]), FirstRegistrationSlot: 1}
		f.Client.LatestCheckpointPoolRegistry.Pools = append(f.Client.LatestCheckpointPoolRegistry.Pools, &PoolRegistrationRecord{Registration: binding, Registered: true})
		f.Client.LatestCheckpointPoolRegistry.Mark = append(f.Client.LatestCheckpointPoolRegistry.Mark, binding)
		f.Client.LatestCheckpointPoolRegistry.Effective = append(f.Client.LatestCheckpointPoolRegistry.Effective, binding)
		f.Client.EpochStakeDistribution = append(f.Client.EpochStakeDistribution, &StakeDistributionEntry{PoolId: binding.PoolId, VrfKeyHash: binding.VrfKeyHash, FirstRegistrationSlot: 1, Stake: 1, RelativeStakeNumerator: 1, RelativeStakeDenominator: 10000})
	}
	f.Client.EpochStakeDistribution[11].Stake = 1906
	f.Client.EpochStakeDistribution[11].RelativeStakeNumerator = 1906
	f.Client.EpochStakeDistribution[12].Stake = 1907
	f.Client.EpochStakeDistribution[12].RelativeStakeNumerator = 1907
	f.Client.EpochContexts[0].StakeDistribution = f.Client.EpochStakeDistribution
	f.Consensus.PoolRegistry = fromCorePoolRegistryState(toCorePoolRegistryState(f.Client.LatestCheckpointPoolRegistry))
	// Align timestamps with this isolated host's real clock. Signed slots and
	// block bodies remain unchanged. Both histories use the same system start.
	newest := max(f.Header.DescendantBlocks[len(f.Header.DescendantBlocks)-1].Timestamp, f.Fork.DescendantBlocks[len(f.Fork.DescendantBlocks)-1].Timestamp)
	delta := time.Now().Add(-10*time.Second).UnixNano() - int64(newest)
	f.Client.SystemStartUnixNs = uint64(int64(f.Client.SystemStartUnixNs) + delta)
	f.Client.LatestCheckpointTimestamp = uint64(int64(f.Client.LatestCheckpointTimestamp) + delta)
	f.Consensus.Timestamp = uint64(int64(f.Consensus.Timestamp) + delta)
	for _, h := range []*ProbabilisticHeader{f.Header, f.Fork} {
		h.NewEpochContext.StakeDistribution = f.Client.EpochStakeDistribution
		blocks := append(append([]*ProbabilisticBlock{}, h.BridgeBlocks...), h.AnchorBlock)
		blocks = append(blocks, h.DescendantBlocks...)
		for _, b := range blocks {
			b.Timestamp = uint64(int64(b.Timestamp) + delta)
		}
		// Descendants need signed headers only. Bridge and anchor bodies remain
		// complete because registration and packet tracking authenticate them.
		for _, b := range h.DescendantBlocks {
			var fields []cbor.RawMessage
			_, err := cbor.Decode(b.BlockCbor, &fields)
			require.NoError(t, err)
			b.HeaderCbor = bytes.Clone(fields[0])
			b.BlockCbor = nil
		}
		if name != "combined" {

		}
	}
	if name == "combined" {
		f.Header = boundaryCheckpointAt(t, f.Header, 966, 984)
		f.Fork = boundaryCheckpointAt(t, f.Fork, 966, 984)

	}
	return f
}

func profileInteger(t *testing.T, source, name string) int64 {
	t.Helper()
	match := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(name) + `=(\d+)$`).FindStringSubmatch(source)
	require.Len(t, match, 2, "missing profile setting %s", name)
	value, err := strconv.ParseInt(match[1], 10, 64)
	require.NoError(t, err)
	return value
}

func spareAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	address := l.Addr().String()
	require.NoError(t, l.Close())
	return address
}
