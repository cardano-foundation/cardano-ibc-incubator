package state

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/kes"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/blinklabs-io/gouroboros/vrf"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/blake2b"
)

// Called by Caribic's v8 acceptance driver. Transaction bodies come from its
// ICS-20 packets. All headers, VRFs, body hashes and rollover nonces are signed
// here rather than changing a saved header's root after signing.
func TestExportAcceptanceHistory(t *testing.T) {
	input := os.Getenv("CARIBIC_ACCEPTANCE_HISTORY_INPUT")
	if input == "" {
		t.Skip("used by the local v8 acceptance driver")
	}
	var request struct {
		Transactions                     map[uint64][]byte
		Snapshot                         []byte
		SlotLengthNs                     uint64
		EpochLengthSlots                 uint64
		ActiveSlotCoefficientNumerator   uint64
		ActiveSlotCoefficientDenominator uint64
		RetainedCounterRows              uint64
		RenewOperationalCertificates     bool
	}
	raw, err := os.ReadFile(input)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &request))
	// Reuse the deterministic producer registry and explicit trusted checkpoint.
	f := makeNativeBoundaryFixture(t, false, 0)
	cs, consensus := f.Client, f.Consensus
	cs.SlotLengthNs = 1_000 // Accelerated local source clock, independent of host deadlines.
	if request.SlotLengthNs != 0 {
		cs.SlotLengthNs = request.SlotLengthNs
	}
	cs.SlotsPerKesPeriod = 1_000_000
	epochLength := uint64(200_000)
	if request.EpochLengthSlots != 0 {
		epochLength = request.EpochLengthSlots
	}
	if request.ActiveSlotCoefficientNumerator != 0 {
		cs.ActiveSlotCoefficientNumerator = request.ActiveSlotCoefficientNumerator
		cs.ActiveSlotCoefficientDenominator = request.ActiveSlotCoefficientDenominator
	}
	for index := uint64(0); index < request.RetainedCounterRows; index++ {
		pool := blake2b.Sum256([]byte(fmt.Sprintf("readiness-retired-pool-%d", index)))
		cs.LatestCheckpointOperationalCertificateCounters = append(cs.LatestCheckpointOperationalCertificateCounters, &OperationalCertificateCounter{PoolId: bytes.Clone(pool[:28]), SequenceNumber: 1})
	}
	offset := uint64(240*24*time.Hour) / cs.SlotLengthNs // Preserve producer age for either source clock.
	offset = (offset + cs.SlotsPerKesPeriod - 1) / cs.SlotsPerKesPeriod * cs.SlotsPerKesPeriod
	cs.CurrentEpochStartSlot, cs.CurrentEpochEndSlotExclusive = offset, offset+epochLength
	cs.EpochContexts[0].SlotsPerKesPeriod = cs.SlotsPerKesPeriod
	cs.EpochContexts[0].EpochStartSlot, cs.EpochContexts[0].EpochEndSlotExclusive = offset, offset+epochLength
	cs.SystemStartUnixNs = uint64(time.Now().Add(-time.Minute).UnixNano()) - (offset+3*epochLength)*cs.SlotLengthNs
	setTestCheckpoint(t, cs, cs.LatestHeight, cs.LatestCheckpointBlockHash, 7, offset+10)
	consensus.Timestamp = cs.LatestCheckpointTimestamp
	consensus.PacketStateSnapshot = request.Snapshot
	snap, err := core.DecodePacketStateSnapshot(request.Snapshot)
	require.NoError(t, err)
	require.Equal(t, cs.LatestCheckpointBlockHash, snap.BlockHash)
	consensus.IbcStateRoot = snap.HostRoot
	producers := make([]nativeBoundaryProducer, 11)
	for i := range producers {
		p := &producers[i]
		p.cold = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 1)}, 32))
		p.vrfPublic, p.vrfSecret, err = vrf.KeyGen(bytes.Repeat([]byte{byte(i + 21)}, 32))
		require.NoError(t, err)
		p.kesSecret, p.kesPublic, err = kes.KeyGen(6, bytes.Repeat([]byte{byte(i + 41)}, 32))
		require.NoError(t, err)
	}
	type history struct {
		Blocks   []*ProbabilisticBlock
		Contexts []*EpochContext
	}
	build := func(forkAt uint64, original *history) history {
		result := history{}
		previous, slot := cs.LatestCheckpointBlockHash, offset+11
		tracker, err := newNonceTracker(&trustedBlockState{height: cs.LatestHeight, blockHash: previous, slot: offset + 10, epoch: 7, nonceState: cs.LatestCheckpointNonceState})
		require.NoError(t, err)
		last := uint64(1155)
		if forkAt != 0 {
			last = 1031
			if forkAt >= 1063 {
				last = 1124
			}
		}
		for n := uint64(967); n <= last; n++ {
			epoch := uint64(7)
			if n >= 1001 {
				epoch = 8
				slot = max(slot, offset+epochLength)
			}
			if n >= 1094 {
				epoch = 9
				slot = max(slot, offset+2*epochLength)
			}
			if n == forkAt {
				slot = original.Blocks[n-967].Slot + 1
			}
			require.NoError(t, tracker.tick(cs, n, slot, epoch, previous))
			if n == 1001 || n == 1094 {
				context := cloneEpochContext(cs.EpochContexts[0])
				context.Epoch, context.EpochNonce = epoch, bytes.Clone(tracker.state.EpochNonce)
				context.EpochStartSlot, context.EpochEndSlotExclusive = offset+(epoch-7)*epochLength, offset+(epoch-6)*epochLength
				result.Contexts = append(result.Contexts, context)
			}
			p := &producers[int((n-967)%11)]
			var proof, output []byte
			for {
				seed, err := vrf.MkInputVrf(int64(slot), tracker.state.EpochNonce)
				require.NoError(t, err)
				proof, output, err = vrf.Prove(p.vrfSecret, seed)
				require.NoError(t, err)
				eligible, err := core.IsPraosLeaderEligible(output, 200, 10000, cs.ActiveSlotCoefficientNumerator, cs.ActiveSlotCoefficientDenominator)
				require.NoError(t, err)
				if eligible {
					break
				}
				slot++
			}
			require.Less(t, slot, offset+cs.SlotsPerKesPeriod)
			block := ledger.BabbageBlock{BlockHeader: &ledger.BabbageBlockHeader{}}
			bh := block.BlockHeader
			bh.Body.BlockNumber, bh.Body.Slot = n, slot
			prev, err := hex.DecodeString(previous)
			require.NoError(t, err)
			bh.Body.PrevHash = ledger.NewBlake2b256(prev)
			copy(bh.Body.IssuerVkey[:], p.cold.Public().(ed25519.PublicKey))
			bh.Body.VrfKey = p.vrfPublic
			bh.Body.VrfResult.Proof, bh.Body.VrfResult.Output = proof, output
			bh.Body.OpCert.HotVkey = p.kesPublic
			bh.Body.OpCert.KesPeriod = offset / cs.SlotsPerKesPeriod
			if request.RenewOperationalCertificates && n >= 1094 {
				bh.Body.OpCert.SequenceNumber = 1
			}
			signable := append(bytes.Clone(p.kesPublic), make([]byte, 16)...)
			binary.BigEndian.PutUint64(signable[32:], bh.Body.OpCert.SequenceNumber)
			binary.BigEndian.PutUint64(signable[40:], bh.Body.OpCert.KesPeriod)
			bh.Body.OpCert.Signature = ed25519.Sign(p.cold, signable)
			encoded, err := cbor.Encode(block)
			require.NoError(t, err)
			var fields []cbor.RawMessage
			_, err = cbor.Decode(encoded, &fields)
			require.NoError(t, err)
			if tx := request.Transactions[n]; len(tx) > 0 {
				fields[1], err = cbor.Encode([]cbor.RawMessage{tx})
				require.NoError(t, err)
				fields[2], err = cbor.Encode([]map[uint64]any{{}})
				require.NoError(t, err)
			}
			hashes := []byte{}
			for _, field := range fields[1:] {
				sum := blake2b.Sum256(field)
				hashes = append(hashes, sum[:]...)
			}
			bodyHash := blake2b.Sum256(hashes)
			bh.Body.BlockBodyHash = ledger.NewBlake2b256(bodyHash[:])
			body, err := cbor.Encode(bh.Body)
			require.NoError(t, err)
			bh.Signature, err = kes.Sign(p.kesSecret, 0, body)
			require.NoError(t, err)
			fields[0], err = cbor.Encode(bh)
			require.NoError(t, err)
			encoded, err = cbor.Encode(fields)
			require.NoError(t, err)
			_, err = cbor.Decode(encoded, &block)
			require.NoError(t, err)
			timestamp, err := cs.DeriveTimestampFromSlot(slot)
			require.NoError(t, err)
			b := &ProbabilisticBlock{Height: NewHeight(0, n), Hash: block.Hash().String(), Slot: slot, Epoch: epoch, Timestamp: timestamp, BlockCbor: encoded}
			result.Blocks = append(result.Blocks, b)
			require.NoError(t, tracker.apply(cs, &authenticatedProbabilisticBlock{height: n, slot: slot, epoch: epoch, prevHash: previous, hash: b.Hash}, output))
			previous, slot = b.Hash, slot+1
		}
		return result
	}
	honest := build(0, nil)
	bad := build(980, &honest)
	tail := build(1010, &honest)
	later := history{}
	if request.SlotLengthNs != 0 {
		later = build(1070, &honest)
	}
	result := struct {
		Client                   *ClientState
		Consensus                *ConsensusState
		Honest, Bad, Tail, Later history
	}{cs, consensus, honest, bad, tail, later}
	raw, err = json.Marshal(result)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(os.Getenv("CARIBIC_ACCEPTANCE_HISTORY_OUTPUT"), raw, 0600))
}
