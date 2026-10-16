package state

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
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

type nativeChallengeFixture struct {
	Client    *ClientState         `json:"client"`
	Consensus *ConsensusState      `json:"consensus"`
	Header    *ProbabilisticHeader `json:"header"`
	Fork      *ProbabilisticHeader `json:"fork"`
}

type nativeChallengeProducer struct {
	cold                 ed25519.PrivateKey
	vrfSecret, vrfPublic []byte
	kesSecret            *kes.SecretKey
	kesPublic            []byte
}

// Fully signed synthetic Praos evidence exercises native cryptography and
// complete body authentication. Deterministic keys exist only for this test.
func makeNativeChallengeFixture(t *testing.T) nativeChallengeFixture {
	t.Helper()
	cs := newProbabilisticTestClientState()
	cs.TrustingPeriod = 48 * time.Hour
	// Start more than six months after registration. The signing certificate
	// begins in this KES period so its relative signing period remains zero.
	slotOffset := uint64(160 * 129600)
	cs.CurrentEpochStartSlot = slotOffset
	cs.CurrentEpochEndSlotExclusive += slotOffset
	cs.EpochContexts[0].EpochStartSlot = slotOffset
	cs.EpochContexts[0].EpochEndSlotExclusive += slotOffset
	cs.CurrentEpochEndSlotExclusive = slotOffset + 60000
	cs.EpochContexts[0].EpochEndSlotExclusive = slotOffset + 60000
	cs.LatestCheckpointNonceState.LastEpochBlockNonce = nil
	cs.LatestCheckpointNonceState.CandidateNonce = bytes.Clone(cs.EpochNonce)
	producers := make([]nativeChallengeProducer, 13)
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
	setTestCheckpoint(t, cs, cs.LatestHeight, hash, 7, slotOffset+10)
	consensus := newProbabilisticTestConsensusState(hash)
	consensus.Timestamp = cs.LatestCheckpointTimestamp
	consensus.NonceState = clonePraosNonceState(cs.LatestCheckpointNonceState)
	consensus.PoolRegistry = clonePoolRegistry(cs.LatestCheckpointPoolRegistry)
	consensus.SettlementCredit = cloneSettlementCredit(cs.LatestCheckpointSettlementCredit)
	consensus.PoolProduction = clonePoolProduction(cs.LatestCheckpointPoolProduction)
	makeHeader := func(firstSlot uint64) *ProbabilisticHeader {
		h := &ProbabilisticHeader{TrustedHeight: cs.LatestHeight, IsCheckpoint: true}
		h.NewEpochContext = cloneEpochContext(cs.EpochContexts[0])
		h.NewEpochContext.Epoch = 8
		h.NewEpochContext.EpochStartSlot, h.NewEpochContext.EpochEndSlotExclusive = slotOffset+60000, slotOffset+120000
		previous, slot := hash, firstSlot
		for n := uint64(11); n <= 41; n++ {
			p := &producers[int((n-11)%11)]
			var proof, output []byte
			for {
				seed, err := vrf.MkInputVrf(int64(slot), cs.EpochNonce)
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
			signable := append(bytes.Clone(p.kesPublic), make([]byte, 16)...)
			binary.BigEndian.PutUint64(signable[40:], bh.Body.OpCert.KesPeriod)
			bh.Body.OpCert.Signature = ed25519.Sign(p.cold, signable)
			encoded, err := cbor.Encode(block)
			require.NoError(t, err)
			var fields []cbor.RawMessage
			_, err = cbor.Decode(encoded, &fields)
			require.NoError(t, err)
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
			encoded, err = cbor.Encode(block)
			require.NoError(t, err)
			_, err = cbor.Decode(encoded, &block)
			timestamp, err := cs.DeriveTimestampFromSlot(slot)
			require.NoError(t, err)
			b := &ProbabilisticBlock{Height: NewHeight(0, n), Hash: block.Hash().String(), Slot: slot, Epoch: 8, Timestamp: timestamp}
			if n == 11 {
				b.BlockCbor = encoded
				h.AnchorBlock = b
			} else {
				b.HeaderCbor = block.BlockHeader.Cbor()
				h.DescendantBlocks = append(h.DescendantBlocks, b)
			}
			previous, slot = b.Hash, slot+1
		}
		return h
	}
	header := makeHeader(slotOffset + 60000)
	fork := makeHeader(header.AnchorBlock.Slot + 1)
	return nativeChallengeFixture{cs, consensus, header, fork}
}

func TestNativeChallengeFixture(t *testing.T) {
	fixture := makeNativeChallengeFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "native-challenge")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(fixture.Fork.DescendantBlocks[29].Timestamp))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	fixture.Client, _ = GetClientState(store, cdc)
	ctx.Time = ctx.Time.Add(3*time.Minute + 2*time.Nanosecond)
	for _, header := range []*ProbabilisticHeader{fixture.Header, fixture.Fork} {
		require.NoError(t, fixture.Client.VerifyClientMessage(ctx, cdc, store, header))
	}
	evidence := &Misbehaviour{ProbabilisticHeader1: fixture.Header, ProbabilisticHeader2: fixture.Fork}
	require.NoError(t, fixture.Client.VerifyClientMessage(ctx, cdc, store, evidence))
	require.True(t, fixture.Client.CheckForMisbehaviour(ctx, cdc, store, evidence))
	encoded, err := json.MarshalIndent(fixture, "", "  ")
	require.NoError(t, err)
	encoded = append(encoded, '\n')
	if os.Getenv("UPDATE_NATIVE_CHALLENGE_FIXTURE") == "1" {
		require.NoError(t, os.WriteFile("../testdata/native-challenge.json", encoded, 0644))
	}
	saved, err := os.ReadFile("../testdata/native-challenge.json")
	require.NoError(t, err)
	require.JSONEq(t, string(saved), string(encoded))
}
