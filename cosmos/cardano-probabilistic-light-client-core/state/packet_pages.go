package state

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"sort"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

const snapshotPacketLanes byte = 11
const snapshotPacketInputs byte = 12
const snapshotPacketRoutes byte = 13

type packetCheckpoint struct {
	Height                uint64
	BlockHash, HostTxHash [32]byte
	HostOutputIndex       uint32
	HostRoot              [32]byte
	Lanes, Inputs, Routes SnapshotRoot
}

func packetInputKey(hash string, index uint32) ([]byte, error) {
	decoded, err := decodeBlockHash(hash)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(binary.BigEndian.AppendUint32(decoded[:], index))
	return digest[:], nil
}
func packetRouteKey(port, channel string) []byte {
	raw := binary.BigEndian.AppendUint32(nil, uint32(len(port)))
	raw = append(raw, port...)
	raw = append(raw, channel...)
	hash := sha256.Sum256(raw)
	return hash[:]
}
func encodePacketLane(lane core.TrackedPacketLane) ([]byte, error) {
	hash, err := decodeBlockHash(lane.TxHash)
	if err != nil {
		return nil, err
	}
	state := lane.State
	if len(state.Port) > 128 || len(state.Channel) > 28 || len(state.Root) != 32 {
		return nil, fmt.Errorf("invalid packet lane record")
	}
	raw := append(bytes.Clone(hash[:]), byte(len(state.Port)), byte(len(state.Channel)))
	raw = append(raw, state.Port...)
	raw = append(raw, state.Channel...)
	raw = binary.BigEndian.AppendUint32(raw, lane.OutputIndex)
	raw = binary.BigEndian.AppendUint32(raw, state.Lane)
	raw = binary.BigEndian.AppendUint32(raw, state.LaneCount)
	raw = binary.BigEndian.AppendUint64(raw, state.Version)
	return append(raw, state.Root...), nil
}
func decodePacketLane(raw []byte, height uint64) (core.TrackedPacketLane, error) {
	var lane core.TrackedPacketLane
	if len(raw) < 86 || len(raw) != 86+int(raw[32])+int(raw[33]) {
		return lane, fmt.Errorf("invalid sealed packet lane")
	}
	lane.TxHash = hex.EncodeToString(raw[:32])
	cursor := 34
	lane.State.Port = string(raw[cursor : cursor+int(raw[32])])
	cursor += int(raw[32])
	lane.State.Channel = string(raw[cursor : cursor+int(raw[33])])
	cursor += int(raw[33])
	lane.OutputIndex = binary.BigEndian.Uint32(raw[cursor:])
	cursor += 4
	lane.State.Lane = binary.BigEndian.Uint32(raw[cursor:])
	cursor += 4
	lane.State.LaneCount = binary.BigEndian.Uint32(raw[cursor:])
	cursor += 4
	lane.State.Version = binary.BigEndian.Uint64(raw[cursor:])
	cursor += 8
	lane.State.Root = bytes.Clone(raw[cursor:])
	lane.State.Height = height
	return lane, nil
}
func savePacketCheckpoint(store storetypes.KVStore, scope [32]byte, packet *packetCheckpoint) ([32]byte, error) {
	raw, err := cbor.Encode(packet)
	if err != nil {
		return [32]byte{}, err
	}
	return savePacketObject(store, scope, raw)
}
func loadPacketCheckpoint(store storetypes.KVStore, scope, reference [32]byte) (*packetCheckpoint, error) {
	raw, err := loadPacketObject(store, scope, reference)
	if err != nil {
		return nil, err
	}
	var packet packetCheckpoint
	if _, err := cbor.Decode(raw, &packet); err != nil {
		return nil, err
	}
	if packet.Height == 0 || packet.Lanes.Rows != packet.Inputs.Rows {
		return nil, fmt.Errorf("invalid paged packet cursor")
	}
	return &packet, nil
}
func orderedPacketChanges(changes map[string][]byte) []SnapshotChange {
	ordered := make([]SnapshotChange, 0, len(changes))
	for key, value := range changes {
		ordered = append(ordered, SnapshotChange{[]byte(key), value})
	}
	sort.Slice(ordered, func(i, j int) bool { return bytes.Compare(ordered[i].Key, ordered[j].Key) < 0 })
	return ordered
}
func createPacketCheckpoint(store storetypes.KVStore, scope [32]byte, snapshot core.PacketStateSnapshot) ([32]byte, error) {
	if err := snapshot.Validate(); err != nil {
		return [32]byte{}, err
	}
	packet := &packetCheckpoint{Height: snapshot.Height, HostOutputIndex: snapshot.HostOutputIndex}
	packet.BlockHash, _ = decodeBlockHash(snapshot.BlockHash)
	packet.HostTxHash, _ = decodeBlockHash(snapshot.HostTxHash)
	copy(packet.HostRoot[:], snapshot.HostRoot)
	lanes, inputs := map[string][]byte{}, map[string][]byte{}
	routes := map[string][]byte{}
	for name, lane := range snapshot.Lanes {
		key, _ := hex.DecodeString(name)
		raw, err := encodePacketLane(lane)
		if err != nil {
			return [32]byte{}, err
		}
		lanes[string(key)] = raw
		input, _ := packetInputKey(lane.TxHash, lane.OutputIndex)
		inputs[string(input)] = key
		route := string(packetRouteKey(lane.State.Port, lane.State.Channel))
		value := routes[route]
		var count uint32
		if value != nil {
			count = binary.BigEndian.Uint32(value[4:])
		}
		routes[route] = binary.BigEndian.AppendUint32(binary.BigEndian.AppendUint32(nil, lane.State.LaneCount), count+1)
	}
	var err error
	packet.Lanes, err = NewSnapshotMap(store, scope, snapshotPacketLanes).PutBatch(SnapshotRoot{}, orderedPacketChanges(lanes))
	if err != nil {
		return [32]byte{}, err
	}
	packet.Inputs, err = NewSnapshotMap(store, scope, snapshotPacketInputs).PutBatch(SnapshotRoot{}, orderedPacketChanges(inputs))
	if err != nil {
		return [32]byte{}, err
	}
	packet.Routes, err = NewSnapshotMap(store, scope, snapshotPacketRoutes).PutBatch(SnapshotRoot{}, orderedPacketChanges(routes))
	if err != nil {
		return [32]byte{}, err
	}
	return savePacketCheckpoint(store, scope, packet)
}
func packetSubset(packet *packetCheckpoint) core.PacketStateSnapshot {
	return core.PacketStateSnapshot{Height: packet.Height, BlockHash: hex.EncodeToString(packet.BlockHash[:]), HostTxHash: hex.EncodeToString(packet.HostTxHash[:]), HostOutputIndex: packet.HostOutputIndex, HostRoot: bytes.Clone(packet.HostRoot[:]), Lanes: map[string]core.TrackedPacketLane{}}
}
func advancePacketCheckpoint(store storetypes.KVStore, scope, reference [32]byte, block []byte, cs *ClientState) ([32]byte, [32]byte, error) {
	var zero [32]byte
	packet, err := loadPacketCheckpoint(store, scope, reference)
	if err != nil {
		return zero, zero, err
	}
	inputs, names, err := core.PacketDependencies(block, cs.PacketLanePolicyId)
	if err != nil {
		return zero, zero, err
	}
	wanted := map[string]bool{}
	for _, name := range names {
		wanted[name] = true
	}
	inputMap := NewSnapshotMap(store, scope, snapshotPacketInputs)
	for _, input := range inputs {
		key, err := packetInputKey(input.Hash, input.Index)
		if err != nil {
			return zero, zero, err
		}
		raw, found, err := inputMap.Lookup(packet.Inputs, key)
		if err != nil {
			return zero, zero, err
		}
		if found {
			if len(raw) != 32 {
				return zero, zero, fmt.Errorf("invalid packet input index")
			}
			wanted[hex.EncodeToString(raw)] = true
		}
	}
	previous := packetSubset(packet)
	laneMap := NewSnapshotMap(store, scope, snapshotPacketLanes)
	for name := range wanted {
		key, _ := hex.DecodeString(name)
		raw, exists, err := laneMap.Lookup(packet.Lanes, key)
		if err != nil {
			return zero, zero, err
		}
		if exists {
			lane, err := decodePacketLane(raw, packet.Height)
			if err != nil {
				return zero, zero, err
			}
			previous.Lanes[name] = lane
		}
	}
	next, err := core.AdvancePacketStateSnapshot(previous, [][]byte{block}, cs.PacketLanePolicyId, cs.HostStateNftPolicyId, cs.HostStateNftTokenName)
	if err != nil {
		return zero, zero, err
	}
	laneChanges, inputChanges := map[string][]byte{}, map[string][]byte{}
	type routeDelta struct {
		Removed, Added uint32
		Count          uint32
	}
	routes := map[string]routeDelta{}
	for name, old := range previous.Lanes {
		key, _ := hex.DecodeString(name)
		laneChanges[string(key)] = nil
		input, _ := packetInputKey(old.TxHash, old.OutputIndex)
		inputChanges[string(input)] = nil
		route := string(packetRouteKey(old.State.Port, old.State.Channel))
		delta := routes[route]
		delta.Removed++
		routes[route] = delta
	}
	for name, lane := range next.Lanes {
		key, _ := hex.DecodeString(name)
		raw, err := encodePacketLane(lane)
		if err != nil {
			return zero, zero, err
		}
		laneChanges[string(key)] = raw
		input, _ := packetInputKey(lane.TxHash, lane.OutputIndex)
		inputChanges[string(input)] = key
		route := string(packetRouteKey(lane.State.Port, lane.State.Channel))
		delta := routes[route]
		if delta.Added > 0 && delta.Count != lane.State.LaneCount {
			return zero, zero, fmt.Errorf("inconsistent packet route count")
		}
		delta.Added++
		delta.Count = lane.State.LaneCount
		routes[route] = delta
	}
	routeMap := NewSnapshotMap(store, scope, snapshotPacketRoutes)
	routeChanges := map[string][]byte{}
	for route, delta := range routes {
		raw, exists, err := routeMap.Lookup(packet.Routes, []byte(route))
		if err != nil {
			return zero, zero, err
		}
		var oldCount, oldLanes uint32
		if exists {
			if len(raw) != 8 {
				return zero, zero, fmt.Errorf("invalid route index")
			}
			oldCount, oldLanes = binary.BigEndian.Uint32(raw), binary.BigEndian.Uint32(raw[4:])
		}
		if delta.Removed > oldLanes || uint64(oldLanes-delta.Removed)+uint64(delta.Added) > uint64(core.MaxPacketLanes) {
			return zero, zero, fmt.Errorf("invalid route lane accounting")
		}
		remaining := oldLanes - delta.Removed
		if delta.Added > 0 && remaining > 0 && oldCount != delta.Count {
			return zero, zero, fmt.Errorf("lane count conflicts with an untouched route")
		}
		if remaining+delta.Added == 0 {
			routeChanges[route] = nil
		} else {
			if delta.Added > 0 {
				oldCount = delta.Count
			}
			routeChanges[route] = binary.BigEndian.AppendUint32(binary.BigEndian.AppendUint32(nil, oldCount), remaining+delta.Added)
		}
	}
	packet.Lanes, err = laneMap.PutBatch(packet.Lanes, orderedPacketChanges(laneChanges))
	if err != nil {
		return zero, zero, err
	}
	packet.Inputs, err = inputMap.PutBatch(packet.Inputs, orderedPacketChanges(inputChanges))
	if err != nil {
		return zero, zero, err
	}
	packet.Routes, err = routeMap.PutBatch(packet.Routes, orderedPacketChanges(routeChanges))
	if err != nil {
		return zero, zero, err
	}
	packet.Height, packet.BlockHash = next.Height, mustBlockHash(next.BlockHash)
	packet.HostTxHash, packet.HostOutputIndex = mustBlockHash(next.HostTxHash), next.HostOutputIndex
	copy(packet.HostRoot[:], next.HostRoot)
	ref, err := savePacketCheckpoint(store, scope, packet)
	return ref, packet.HostRoot, err
}
func mustBlockHash(hash string) [32]byte {
	value, err := decodeBlockHash(hash)
	if err != nil {
		panic(err)
	}
	return value
}

// PacketRoot reads one route and one lane. It never expands the full snapshot.
func (cs *ClientState) PacketRoot(ctx Context, consensus *ConsensusState, height uint64, key []byte) (core.PacketLaneRoot, error) {
	var zero core.PacketLaneRoot
	if consensus.VerificationGeneration != cs.VerificationGeneration || cs.BootstrapPending {
		return zero, fmt.Errorf("packet state belongs to an unusable generation")
	}
	store, err := ctx.snapshotStore()
	if err != nil {
		return zero, err
	}
	scope, err := verificationScope(cs)
	if err != nil {
		return zero, err
	}
	packet, err := loadPacketCheckpoint(store, scope, [32]byte(consensus.PacketStateReference))
	if err != nil {
		return zero, err
	}
	if packet.Height != height || !bytes.Equal(packet.HostRoot[:], consensus.IbcStateRoot) {
		return zero, fmt.Errorf("packet reference disagrees with consensus")
	}
	parsed, err := core.ParsePacketLaneKey(key)
	if err != nil {
		return zero, err
	}
	raw, found, err := NewSnapshotMap(store, scope, snapshotPacketRoutes).Lookup(packet.Routes, packetRouteKey(parsed.Port, parsed.Channel))
	if err != nil {
		return zero, err
	}
	if !found || len(raw) != 8 {
		return zero, fmt.Errorf("packet route is unavailable")
	}
	count := binary.BigEndian.Uint32(raw)
	lane, err := core.PacketLane(parsed.Port, parsed.Channel, parsed.Sequence, count)
	if err != nil {
		return zero, err
	}
	name, err := core.PacketLaneTokenName(parsed.Port, parsed.Channel, lane, count)
	if err != nil {
		return zero, err
	}
	raw, found, err = NewSnapshotMap(store, scope, snapshotPacketLanes).Lookup(packet.Lanes, name)
	if err != nil {
		return zero, err
	}
	if !found {
		return zero, fmt.Errorf("packet lane is unavailable")
	}
	tracked, err := decodePacketLane(raw, height)
	if err != nil {
		return zero, err
	}
	return tracked.State, tracked.State.ValidateKey(height, key)
}
