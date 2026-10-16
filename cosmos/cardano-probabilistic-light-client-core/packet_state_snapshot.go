package probabilisticcore

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
)

// PacketStateSnapshot is retained at an authenticated block, including rootless
// checkpoints. A proof height may use it only after that block is settled.
// Keeping the live references is necessary to detect missing continuations.
type PacketStateSnapshot struct {
	Height          uint64
	BlockHash       string
	HostTxHash      string
	HostOutputIndex uint32
	HostRoot        []byte
	Lanes           map[string]TrackedPacketLane
}

type TrackedPacketLane struct {
	State       PacketLaneRoot
	TxHash      string
	OutputIndex uint32
}

// AdvancePacketStateSnapshot scans every body between the trusted cursor and
// the new anchor. The caller authenticates the headers and settlement evidence.
// This function independently checks body hashes and continuity, and never
// modifies the trusted snapshot on failure. Descendants must not be included:
// they establish settlement but are not part of the anchor's state.
func AdvancePacketStateSnapshot(previous PacketStateSnapshot, blocks [][]byte, lanePolicy, hostPolicy, hostName []byte) (PacketStateSnapshot, error) {
	if previous.Height == 0 || len(previous.BlockHash) != 64 || len(previous.HostTxHash) != 64 || len(previous.HostRoot) != 32 || len(lanePolicy) != 28 || len(hostPolicy) != 28 || len(blocks) == 0 {
		return PacketStateSnapshot{}, fmt.Errorf("invalid packet state cursor or policies")
	}
	if err := previous.Validate(); err != nil {
		return PacketStateSnapshot{}, err
	}
	next := previous
	next.HostRoot = bytes.Clone(previous.HostRoot)
	next.Lanes = make(map[string]TrackedPacketLane, len(previous.Lanes))
	for name, lane := range previous.Lanes {
		if lane.State.Height != previous.Height {
			return PacketStateSnapshot{}, fmt.Errorf("lane height does not match snapshot cursor")
		}
		lane.State.Root = bytes.Clone(lane.State.Root)
		next.Lanes[name] = lane
	}
	for _, raw := range blocks {
		block, err := DecodeLedgerBlock(raw)
		if err != nil {
			return PacketStateSnapshot{}, err
		}
		parent, err := BlockPrevHash(block)
		if err != nil {
			return PacketStateSnapshot{}, err
		}
		if block.BlockNumber() != next.Height+1 || !strings.EqualFold(parent, next.BlockHash) {
			return PacketStateSnapshot{}, fmt.Errorf("packet state requires contiguous block bodies")
		}
		bodyHash, err := BlockBodyHash(block)
		if err != nil {
			return PacketStateSnapshot{}, err
		}
		valid, err := verifyNativeBlockBody(block, bodyHash)
		if err != nil || !valid {
			return PacketStateSnapshot{}, fmt.Errorf("packet state block body is not authenticated: %v", err)
		}
		for index, tx := range block.Transactions() {
			spent := map[string]TrackedPacketLane{}
			hostSpent := false
			for _, input := range tx.Consumed() {
				if strings.EqualFold(input.Id().String(), next.HostTxHash) && input.Index() == next.HostOutputIndex {
					hostSpent = true
				}
				for name, lane := range next.Lanes {
					if strings.EqualFold(input.Id().String(), lane.TxHash) && input.Index() == lane.OutputIndex {
						spent[name] = lane
					}
				}
			}
			// Invalid transactions consume collateral, not their ordinary inputs. They
			// cannot advance authenticated script state or mint a new lane identity.
			if transactionIndexIsInvalid(block, uint(index)) || !tx.IsValid() {
				if hostSpent || len(spent) > 0 {
					return PacketStateSnapshot{}, fmt.Errorf("authenticated state consumed as collateral")
				}
				continue
			}
			continued := map[string]bool{}
			hostContinued := false
			for outputIndex, output := range utxoOutputs(tx.Produced()) {
				assets := output.Assets()
				if assets == nil {
					continue
				}
				if !assetQuantityEquals(assets.Asset(ledger.NewBlake2b224(hostPolicy), hostName), 0) {
					if !hostSpent || hostContinued || !assetQuantityEquals(assets.Asset(ledger.NewBlake2b224(hostPolicy), hostName), 1) || output.Datum() == nil {
						return PacketStateSnapshot{}, fmt.Errorf("invalid HostState continuation")
					}
					root, err := ExtractIbcStateRootFromHostStateDatum(output.Datum().Cbor(), hostPolicy)
					if err != nil {
						return PacketStateSnapshot{}, err
					}
					next.HostRoot, next.HostTxHash, next.HostOutputIndex = root, tx.Hash().String(), uint32(outputIndex)
					hostContinued = true
				}
				for _, nameBytes := range assets.Assets(ledger.NewBlake2b224(lanePolicy)) {
					name := hex.EncodeToString(nameBytes)
					// The same policy may issue sequencers. Only a valid lane datum can
					// introduce a lane, and an existing lane cannot disappear into one.
					if output.Datum() == nil {
						continue
					}
					var tag cbor.RawTag
					var datum packetLaneDatum
					if cbor.Unmarshal(output.Datum().Cbor(), &tag) != nil || tag.Number != 121 || cbor.Unmarshal(tag.Content, &datum) != nil {
						continue
					}
					expected, err := PacketLaneTokenName(string(datum.Port), string(datum.Channel), datum.Lane, datum.LaneCount)
					if err != nil || !bytes.Equal(expected, nameBytes) {
						return PacketStateSnapshot{}, fmt.Errorf("lane identity does not match datum")
					}
					if !assetQuantityEquals(assets.Asset(ledger.NewBlake2b224(lanePolicy), nameBytes), 1) || continued[name] {
						return PacketStateSnapshot{}, fmt.Errorf("duplicate lane continuation")
					}
					state, err := decodePacketLaneRoot(output.Datum().Cbor(), block.BlockNumber(), string(datum.Port), string(datum.Channel), datum.Lane, datum.LaneCount)
					if err != nil {
						return PacketStateSnapshot{}, err
					}
					if old, exists := next.Lanes[name]; exists {
						if _, consumed := spent[name]; !consumed || state.Version != old.State.Version+1 || state.LaneCount != old.State.LaneCount {
							return PacketStateSnapshot{}, fmt.Errorf("lane update skips its live predecessor")
						}
					} else if state.Version != 0 || tx.AssetMint() == nil || !assetQuantityEquals(tx.AssetMint().Asset(ledger.NewBlake2b224(lanePolicy), nameBytes), 1) {
						return PacketStateSnapshot{}, fmt.Errorf("untracked lane must start at authenticated issuance")
					}
					next.Lanes[name] = TrackedPacketLane{State: state, TxHash: tx.Hash().String(), OutputIndex: uint32(outputIndex)}
					continued[name] = true
				}
			}
			if hostSpent && !hostContinued {
				return PacketStateSnapshot{}, fmt.Errorf("missing HostState continuation")
			}
			for name := range spent {
				if !continued[name] {
					nameBytes, err := hex.DecodeString(name)
					if err != nil || tx.AssetMint() == nil || !assetQuantityEquals(tx.AssetMint().Asset(ledger.NewBlake2b224(lanePolicy), nameBytes), -1) {
						return PacketStateSnapshot{}, fmt.Errorf("missing lane continuation or authenticated retirement")
					}
					// Block authentication and phase-2 validity establish execution of
					// the lane policy's drained-channel retirement checks.
					delete(next.Lanes, name)
				}
			}
		}
		next.Height, next.BlockHash = block.BlockNumber(), block.Hash().String()
	}
	for name, lane := range next.Lanes {
		lane.State.Height = next.Height
		next.Lanes[name] = lane
	}
	return next, next.Validate()
}

func (snapshot PacketStateSnapshot) PacketRoot(key []byte, height uint64) (PacketLaneRoot, error) {
	parsed, err := ParsePacketLaneKey(key)
	if err != nil {
		return PacketLaneRoot{}, err
	}
	if snapshot.Height != height {
		return PacketLaneRoot{}, fmt.Errorf("packet snapshot height mismatch")
	}
	for _, tracked := range snapshot.Lanes {
		root := tracked.State
		if root.Port != parsed.Port || root.Channel != parsed.Channel {
			continue
		}
		lane, err := PacketLane(parsed.Port, parsed.Channel, parsed.Sequence, root.LaneCount)
		if err != nil {
			return PacketLaneRoot{}, err
		}
		if root.Lane == lane {
			if err := root.ValidateKey(height, key); err != nil {
				return PacketLaneRoot{}, err
			}
			return root, nil
		}
	}
	return PacketLaneRoot{}, fmt.Errorf("no authenticated packet lane at height %d", height)
}

func (snapshot PacketStateSnapshot) Validate() error {
	validHash := func(value string) bool {
		raw, err := hex.DecodeString(value)
		return err == nil && len(raw) == 32 && value == strings.ToLower(value)
	}
	if snapshot.Height == 0 || !validHash(snapshot.BlockHash) || !validHash(snapshot.HostTxHash) || len(snapshot.HostRoot) != 32 {
		return fmt.Errorf("invalid packet state snapshot cursor")
	}
	refs := map[string]bool{fmt.Sprintf("%s#%d", snapshot.HostTxHash, snapshot.HostOutputIndex): true}
	counts := map[string]uint32{}
	for name, tracked := range snapshot.Lanes {
		state := tracked.State
		expected, err := PacketLaneTokenName(state.Port, state.Channel, state.Lane, state.LaneCount)
		if err != nil || hex.EncodeToString(expected) != name || state.Height != snapshot.Height || len(state.Root) != 32 || !validHash(tracked.TxHash) {
			return fmt.Errorf("invalid tracked packet lane")
		}
		ref := fmt.Sprintf("%s#%d", tracked.TxHash, tracked.OutputIndex)
		if refs[ref] {
			return fmt.Errorf("packet lanes must have independent outputs")
		}
		refs[ref] = true
		channel := state.Port + "/" + state.Channel
		if count, exists := counts[channel]; exists && count != state.LaneCount {
			return fmt.Errorf("inconsistent lane count")
		}
		counts[channel] = state.LaneCount
	}
	return nil
}

func EncodePacketStateSnapshot(snapshot PacketStateSnapshot) ([]byte, error) {
	if err := snapshot.Validate(); err != nil {
		return nil, err
	}
	mode, err := cbor.CanonicalEncOptions().EncMode()
	if err != nil {
		return nil, err
	}
	return mode.Marshal(snapshot)
}

func DecodePacketStateSnapshot(raw []byte) (PacketStateSnapshot, error) {
	var snapshot PacketStateSnapshot
	mode, err := (cbor.DecOptions{DupMapKey: cbor.DupMapKeyEnforcedAPF, MaxNestedLevels: 16, MaxArrayElements: 65536, MaxMapPairs: 65536}).DecMode()
	if err != nil {
		return snapshot, err
	}
	if err := mode.Unmarshal(raw, &snapshot); err != nil {
		return snapshot, fmt.Errorf("invalid packet state snapshot: %w", err)
	}
	return snapshot, snapshot.Validate()
}
