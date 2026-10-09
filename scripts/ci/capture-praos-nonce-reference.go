// Run from cosmos/cardano-probabilistic-light-client-core against an isolated
// single-pool network. This captures native node state, not calculated answers.
package main

import (
	"compress/gzip"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"sync"
	"time"

	ouroboros "github.com/blinklabs-io/gouroboros"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/blinklabs-io/gouroboros/protocol/chainsync"
	"github.com/blinklabs-io/gouroboros/protocol/common"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

type referenceBlock struct {
	Height uint64         `json:"height"`
	Slot   uint64         `json:"slot"`
	Hash   string         `json:"hash"`
	Header string         `json:"header_cbor"`
	Body   string         `json:"block_cbor"`
	State  map[string]any `json:"node_state,omitempty"`
}

func main() {
	socket := flag.String("socket", "", "node socket")
	magic := flag.Uint("magic", 42, "network magic")
	duration := flag.Duration("duration", 72*time.Second, "capture duration")
	output := flag.String("output", "testdata/praos_nonce_node.json.gz", "output fixture")
	epochLength := flag.Uint64("epoch-length", 120, "configured network epoch length")
	window := flag.Uint64("window", 32, "configured randomness stabilisation window")
	kesPeriod := flag.Uint64("kes-period", 100000, "configured KES period length")
	maxKes := flag.Uint64("max-kes", 60, "configured maximum KES evolutions")
	activeNumerator := flag.Uint64("active-numerator", 1, "active slot coefficient numerator")
	activeDenominator := flag.Uint64("active-denominator", 4, "active slot coefficient denominator")
	flag.Parse()
	if *socket == "" {
		panic("--socket is required")
	}
	var mu sync.Mutex
	blocks := map[uint64]*referenceBlock{}
	transport, err := net.Dial("unix", *socket)
	if err != nil {
		panic(err)
	}
	conn, err := ouroboros.New(ouroboros.WithConnection(transport), ouroboros.WithNetworkMagic(uint32(*magic)),
		ouroboros.WithNodeToNode(false), ouroboros.WithChainSyncConfig(chainsync.NewConfig(
			chainsync.WithRollBackwardFunc(func(chainsync.CallbackContext, common.Point, chainsync.Tip) error { return nil }),
			chainsync.WithRollForwardFunc(func(_ chainsync.CallbackContext, _ uint, value any, _ chainsync.Tip) error {
				block := value.(ledger.Block)
				header, _, _, err := core.BuildBlockVerificationArtifacts(block)
				if err != nil {
					return err
				}
				mu.Lock()
				blocks[block.SlotNumber()] = &referenceBlock{Height: block.BlockNumber(), Slot: block.SlotNumber(),
					Hash: block.Hash().String(), Header: header, Body: hex.EncodeToString(block.Cbor())}
				mu.Unlock()
				return nil
			}))))
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	go func() {
		for err := range conn.ErrorChan() {
			fmt.Fprintln(os.Stderr, err)
		}
	}()
	go func() {
		if err := conn.ChainSync().Client.Sync([]common.Point{common.NewPointOrigin()}); err != nil {
			fmt.Fprintln(os.Stderr, err)
		}
	}()
	var firstSlot, lastSlot uint64
	started := false
	deadline := time.Now().Add(*duration)
	for time.Now().Before(deadline) {
		raw, err := exec.Command("cardano-cli", "conway", "query", "protocol-state", "--socket-path", *socket,
			"--testnet-magic", strconv.Itoa(int(*magic))).Output()
		if err != nil {
			panic(err)
		}
		var state map[string]any
		if err := json.Unmarshal(raw, &state); err != nil {
			panic(err)
		}
		if slot, ok := state["lastSlot"].(float64); ok {
			mu.Lock()
			if block := blocks[uint64(slot)]; block != nil {
				block.State = state
				if !started {
					firstSlot, started = block.Slot, true
				}
				lastSlot = block.Slot
			}
			mu.Unlock()
		}
		time.Sleep(100 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	var result []*referenceBlock
	for slot, block := range blocks {
		if started && slot >= firstSlot && slot <= lastSlot {
			result = append(result, block)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Height < result[j].Height })
	if len(result) < 30 {
		panic(fmt.Sprintf("too few captured blocks: %d", len(result)))
	}
	for i := 1; i < len(result); i++ {
		if result[i].Height != result[i-1].Height+1 {
			panic("captured history is not contiguous")
		}
	}
	version, err := exec.Command("cardano-node", "--version").Output()
	if err != nil {
		panic(err)
	}
	f, err := os.Create(*output)
	if err != nil {
		panic(err)
	}
	gz := gzip.NewWriter(f)
	err = json.NewEncoder(gz).Encode(map[string]any{"node_version": string(version), "epoch_length": *epochLength,
		"randomness_stabilisation_window_slots": *window, "slots_per_kes_period": *kesPeriod, "max_kes_evolutions": *maxKes,
		"active_slot_numerator": *activeNumerator, "active_slot_denominator": *activeDenominator, "blocks": result})
	if err != nil {
		panic(err)
	}
	if err := gz.Close(); err != nil {
		panic(err)
	}
	if err := f.Close(); err != nil {
		panic(err)
	}
	fmt.Printf("Captured %d contiguous blocks across epochs %d-%d\n", len(result), firstSlot / *epochLength, lastSlot / *epochLength)
}
