package state

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
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

type nativeBoundaryFixture struct {
	Client     *ClientState         `json:"client"`
	Consensus  *ConsensusState      `json:"consensus"`
	Header     *ProbabilisticHeader `json:"header"`
	Fork       *ProbabilisticHeader `json:"fork"`
	SizeClient *ClientState         `json:"size_client,omitempty"`
}

type nativeBoundaryProducer struct {
	cold                 ed25519.PrivateKey
	vrfSecret, vrfPublic []byte
	kesSecret            *kes.SecretKey
	kesPublic            []byte
}

// Fully signed synthetic Praos evidence exercises native cryptography and
// complete body authentication. Deterministic keys exist only for this test.
func makeNativeBoundaryFixture(t *testing.T, countStall bool, paddingBytes int) nativeBoundaryFixture {
	return makeNativeBoundaryFixtureAtHeight(t, countStall, paddingBytes, 966)
}

func makeNativeBoundaryFixtureAtHeight(t *testing.T, countStall bool, paddingBytes int, trustedHeight uint64) nativeBoundaryFixture {
	return makeNativeBoundaryFixtureAtHeightAndFork(t, countStall, paddingBytes, trustedHeight, 0)
}
func makeNativeBoundaryFixtureAtHeightAndFork(t *testing.T, countStall bool, paddingBytes int, trustedHeight, forkOverride uint64) nativeBoundaryFixture {
	return makeNativeBoundaryFixtureWithProducers(t, countStall, paddingBytes, trustedHeight, forkOverride, nil)
}

func makeNativeBoundaryFixtureWithProducers(t *testing.T, countStall bool, paddingBytes int, trustedHeight, forkOverride uint64, producerOverrides map[uint64]int) nativeBoundaryFixture {
	t.Helper()
	cs := newProbabilisticTestClientState()
	if trustedHeight == 904 || trustedHeight == stakeOmissionTrustedHeight {
		cs.SlotsPerKesPeriod = 259200
		cs.EpochContexts[0].SlotsPerKesPeriod = cs.SlotsPerKesPeriod
	}
	// Start more than six months after registration. The signing certificate
	// begins in this KES period so its relative signing period remains zero.
	slotOffset := 160 * cs.SlotsPerKesPeriod
	cs.CurrentEpochStartSlot = slotOffset
	cs.CurrentEpochEndSlotExclusive += slotOffset
	cs.EpochContexts[0].EpochStartSlot = slotOffset
	cs.EpochContexts[0].EpochEndSlotExclusive += slotOffset
	cs.LatestHeight = NewHeight(0, trustedHeight)
	cs.OperationalCertificateCounterHistoryStartHeight = cs.LatestHeight
	cs.TrustingPeriod = 48 * time.Hour
	epochLength := uint64(60000)
	if trustedHeight == 904 || trustedHeight == stakeOmissionTrustedHeight {
		epochLength = 120000
	}
	cs.CurrentEpochEndSlotExclusive = slotOffset + epochLength
	cs.EpochContexts[0].EpochEndSlotExclusive = slotOffset + epochLength
	cs.LatestCheckpointNonceState.LastEpochBlockNonce = nil
	cs.LatestCheckpointNonceState.CandidateNonce = bytes.Clone(cs.EpochNonce)
	producers := make([]nativeBoundaryProducer, 13)
	entries := make([]*StakeDistributionEntry, 13)
	for i := range producers {
		p := &producers[i]
		p.cold = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 1)}, 32))
		var err error
		p.vrfPublic, p.vrfSecret, err = vrf.KeyGen(bytes.Repeat([]byte{byte(i + 21)}, 32))
		require.NoError(t, err)
		p.kesSecret, p.kesPublic, err = kes.KeyGen(6, bytes.Repeat([]byte{byte(i + 41)}, 32))
		require.NoError(t, err)
		poolHash := ledger.IssuerVkey(p.cold.Public().(ed25519.PublicKey)).Hash()
		vrfHash := blake2b.Sum256(p.vrfPublic)
		stake := uint64(200)
		if i >= 11 {
			stake = 3900
		}
		entries[i] = &StakeDistributionEntry{PoolId: poolHash.Bech32("pool"), Stake: stake, RelativeStakeNumerator: stake, RelativeStakeDenominator: 10000, VrfKeyHash: vrfHash[:], FirstRegistrationSlot: 1}
	}
	cs.EpochStakeDistribution = entries
	cs.EpochContexts[0].StakeDistribution = entries
	cs.LatestCheckpointPoolRegistry = testPoolRegistry(7, entries)
	cs.LatestCheckpointSettlementCredit = &SettlementCreditState{Epoch: 7}
	cs.LatestCheckpointPoolProduction = &PoolProductionHistory{Epoch: 7}
	for _, entry := range entries {
		cs.LatestCheckpointPoolProduction.Pools = append(cs.LatestCheckpointPoolProduction.Pools, &PoolProductionRecord{PoolId: entry.PoolId, CompletedEpochsBitmap: 1})
	}
	hash := testBlockHash("native-bootstrap")
	trustedSlot := slotOffset + 10
	if trustedHeight == stakeOmissionTrustedHeight {
		trustedSlot = slotOffset + epochLength - 1000
	}
	setTestCheckpoint(t, cs, cs.LatestHeight, hash, 7, trustedSlot)
	consensus := newProbabilisticTestConsensusState(hash, trustedHeight)
	consensus.Timestamp = cs.LatestCheckpointTimestamp
	consensus.NonceState = clonePraosNonceState(cs.LatestCheckpointNonceState)
	consensus.PoolRegistry = clonePoolRegistry(cs.LatestCheckpointPoolRegistry)
	consensus.SettlementCredit = cloneSettlementCredit(cs.LatestCheckpointSettlementCredit)
	consensus.PoolProduction = clonePoolProduction(cs.LatestCheckpointPoolProduction)
	var header *ProbabilisticHeader
	makeHeader := func(forkHeight uint64) *ProbabilisticHeader {
		h := &ProbabilisticHeader{TrustedHeight: cs.LatestHeight, IsCheckpoint: true}
		h.NewEpochContext = cloneEpochContext(cs.EpochContexts[0])
		h.NewEpochContext.Epoch = 8
		h.NewEpochContext.EpochStartSlot, h.NewEpochContext.EpochEndSlotExclusive = slotOffset+epochLength, slotOffset+2*epochLength
		previous, slot := hash, trustedSlot+1
		tracker, err := newNonceTracker(&trustedBlockState{height: cs.LatestHeight, blockHash: hash, slot: trustedSlot, epoch: 7, nonceState: cs.LatestCheckpointNonceState})
		require.NoError(t, err)
		lastHeight := uint64(1031)
		if trustedHeight == 904 {
			lastHeight = 1032
		}
		if trustedHeight == stakeOmissionTrustedHeight {
			lastHeight = 1062
		}
		for n := trustedHeight + 1; n <= lastHeight; n++ {
			if n == forkHeight {
				original := append(append(append([]*ProbabilisticBlock{}, header.BridgeBlocks...), header.AnchorBlock), header.DescendantBlocks...)
				slot = original[n-trustedHeight-1].Slot + 1
			}
			producerIndex := int((n - 967) % 11)
			// The omission case admits only producers 0 through 10, then
			// encounters registered producer 11 on the same signed ancestry.
			if trustedHeight == stakeOmissionTrustedHeight {
				if n == 1031 {
					slot = max(slot, h.AnchorBlock.Slot+15*60*60)
				}
				if n == 1032 {
					producerIndex = 11
				}
			}
			if countStall && n <= 1000 {
				if n < 977 {
					producerIndex = int(n - 966)
				} else {
					producerIndex = 0
				}
			}
			if producer, ok := producerOverrides[n]; ok {
				producerIndex = producer
			}
			p := &producers[producerIndex]
			epoch := uint64(7)
			if n >= 1001 {
				epoch = 8
				if slot < slotOffset+epochLength {
					slot = slotOffset + epochLength
				}
			}
			require.NoError(t, tracker.tick(cs, n, slot, epoch, previous))
			if n == 1001 {
				h.NewEpochContext.EpochNonce = bytes.Clone(tracker.state.EpochNonce)
			}
			var proof, output []byte
			for {
				seed, err := vrf.MkInputVrf(int64(slot), tracker.state.EpochNonce)
				require.NoError(t, err)
				proof, output, err = vrf.Prove(p.vrfSecret, seed)
				require.NoError(t, err)
				eligible, err := core.IsPraosLeaderEligible(output, 200, 10000, 1, 20)
				require.NoError(t, err)
				if eligible {
					break
				}
				slot++
			}
			require.Less(t, slot, slotOffset+cs.SlotsPerKesPeriod)
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
			bh.Body.OpCert.KesPeriod = slotOffset / cs.SlotsPerKesPeriod
			if trustedHeight == stakeOmissionTrustedHeight {
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
			padding, err := cbor.Encode(map[uint64]any{0: map[uint64]any{1: bytes.Repeat([]byte{0x5a}, paddingBytes)}})
			require.NoError(t, err)
			fields[3] = padding
			bodyHashes := []byte{}
			for _, field := range fields[1:] {
				sum := blake2b.Sum256(field)
				bodyHashes = append(bodyHashes, sum[:]...)
			}
			bodyHash := blake2b.Sum256(bodyHashes)
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
			timestamp, err := cs.DeriveTimestampFromSlot(slot)
			require.NoError(t, err)
			b := &ProbabilisticBlock{Height: NewHeight(0, n), Hash: block.Hash().String(), Slot: slot, Epoch: epoch, Timestamp: timestamp}
			b.BlockCbor = encoded
			if n < 1001 {
				h.BridgeBlocks = append(h.BridgeBlocks, b)
			} else if n == 1001 {
				h.AnchorBlock = b
			} else {
				h.DescendantBlocks = append(h.DescendantBlocks, b)
			}
			require.NoError(t, tracker.apply(cs, &authenticatedProbabilisticBlock{height: n, slot: slot, epoch: epoch, prevHash: previous, hash: b.Hash}, output))
			previous, slot = b.Hash, slot+1
		}
		return h
	}
	header = makeHeader(0)
	forkHeight := uint64(977)
	if countStall || trustedHeight == 904 {
		forkHeight = trustedHeight + 1
	}
	if forkOverride != 0 {
		forkHeight = forkOverride
	}
	fork := header
	if trustedHeight != stakeOmissionTrustedHeight || forkOverride != 0 {
		fork = makeHeader(forkHeight)
	}
	return nativeBoundaryFixture{Client: cs, Consensus: consensus, Header: header, Fork: fork}
}

func TestNativeBoundaryFixture(t *testing.T) {
	for _, name := range []string{"size", "count", "control", "limit", "combined"} {
		t.Run(name, func(t *testing.T) {
			countStall := name == "count" || name == "combined"
			padding := 40 * 1024
			if name == "control" {
				padding = 1024
			}
			if name == "combined" {
				padding = 80 * 1024
			}
			fixture := makeNativeBoundaryFixture(t, countStall, padding)
			if name == "limit" {
				fixture = makeNativeBoundaryFixtureAtHeight(t, false, 21*1024, 904)
			}
			trusted, err := fixture.Client.latestTrustedBlockState(nil, nil)
			require.NoError(t, err)
			for _, evidence := range []*ProbabilisticHeader{fixture.Header, fixture.Fork} {
				contexts := append(fixture.Client.EpochContexts, evidence.NewEpochContext)
				_, err := fixture.Client.authenticateHeaderBlocksWithContexts(evidence, contexts, trusted.operationalCertificateCounters, trusted)
				require.NoError(t, err)
			}
		})
	}
}
