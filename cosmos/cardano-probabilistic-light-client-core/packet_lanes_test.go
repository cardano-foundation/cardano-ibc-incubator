package probabilisticcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"testing"

	ics23 "github.com/cosmos/ics23/go"
)

func TestPacketLaneWireVectors(t *testing.T) {
	for index, want := range []uint32{1, 2, 3, 4, 5} {
		got, err := PacketLane("transfer", "channel-0", uint64(index+1), 16)
		if err != nil || got != want {
			t.Fatalf("sequence %d: got %d, %v, want %d", index+1, got, err, want)
		}
	}
	name, err := PacketLaneTokenName("transfer", "channel-0", 0, 16)
	if err != nil || hex.EncodeToString(name) != "31f732290ccec0a1b9dd878576dcfb232fd4b3a07125c849c0473fe61768d1c8" {
		t.Fatalf("token name: %x, %v", name, err)
	}
}

func TestPacketLaneRejectsNoncanonicalKeys(t *testing.T) {
	for _, sequence := range []string{"0", "01", "-1", "+1", "1/extra", "18446744073709551616"} {
		if _, err := ParsePacketLaneKey([]byte("receipts/ports/transfer/channels/channel-0/sequences/" + sequence)); err == nil {
			t.Fatalf("accepted sequence %q", sequence)
		}
	}
	for _, channel := range []string{"channel-00", "channel--1", "channel-18446744073709551616"} {
		if _, err := PacketLane("transfer", channel, 1, 16); err == nil {
			t.Fatalf("accepted channel %q", channel)
		}
	}
}

func packetLaneProof(key, value []byte) (*ics23.ExistenceProof, []byte) {
	hash := sha256.Sum256(key)
	index := binary.BigEndian.Uint64(hash[:8])
	path := make([]*ics23.InnerOp, 64)
	for depth := range path {
		if (index>>uint(depth))&1 == 0 {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: []byte{1}, Suffix: make([]byte, 32)}
		} else {
			path[depth] = &ics23.InnerOp{Hash: ics23.HashOp_SHA256, Prefix: append([]byte{1}, make([]byte, 32)...)}
		}
	}
	root, _ := ComputeRootFromProofPath(key, value, path)
	return &ics23.ExistenceProof{Key: key, Value: value, Path: path}, root
}

func TestPacketLaneProofBindsChannelLaneAndHeight(t *testing.T) {
	key := []byte("commitments/ports/transfer/channels/channel-0/sequences/1")
	value := bytes.Repeat([]byte{0xab}, 32)
	proof, hash := packetLaneProof(key, value)
	root := PacketLaneRoot{Port: "transfer", Channel: "channel-0", Lane: 1, LaneCount: 16, Height: 42, Version: 1, Root: hash}
	if err := VerifyPacketLaneMembership(root, 42, key, value, proof); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*PacketLaneRoot){
		func(r *PacketLaneRoot) { r.Height++ },
		func(r *PacketLaneRoot) { r.Lane++ },
		func(r *PacketLaneRoot) { r.Channel = "channel-1" },
		func(r *PacketLaneRoot) { r.Port = "other" },
		func(r *PacketLaneRoot) { r.LaneCount = 0 },
		func(r *PacketLaneRoot) { r.Root = make([]byte, 32) },
	} {
		bad := root
		change(&bad)
		if err := VerifyPacketLaneMembership(bad, 42, key, value, proof); err == nil {
			t.Fatalf("accepted invalid root: %+v", bad)
		}
	}
	proof.Value = nil
	if err := VerifyPacketLaneMembership(root, 42, key, value, proof); err == nil {
		t.Fatal("accepted missing committed value")
	}
}

func TestPacketLaneAbsenceBindsExactLane(t *testing.T) {
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	existence, hash := packetLaneProof(key, nil)
	proof := &ics23.NonExistenceProof{Key: key, Left: existence}
	root := PacketLaneRoot{Port: "transfer", Channel: "channel-0", Lane: 1, LaneCount: 16, Height: 42, Root: hash}
	if err := VerifyPacketLaneNonMembership(root, 42, key, proof); err != nil {
		t.Fatal(err)
	}
	root.Lane = 14
	if err := VerifyPacketLaneNonMembership(root, 42, key, proof); err == nil {
		t.Fatal("accepted absence from another empty lane")
	}
}

func TestPacketLaneMalformedInnerOperationReturnsError(t *testing.T) {
	key := []byte("receipts/ports/transfer/channels/channel-0/sequences/1")
	proof, hash := packetLaneProof(key, []byte{1})
	root := PacketLaneRoot{Port: "transfer", Channel: "channel-0", Lane: 1, LaneCount: 16, Height: 42, Root: hash}
	proof.Path[0] = nil
	if err := VerifyPacketLaneMembership(root, 42, key, []byte{1}, proof); err == nil {
		t.Fatal("accepted nil inner operation")
	}
}

func TestConsecutivePacketLanesWrapWithoutCollisions(t *testing.T) {
	for count := uint32(1); count <= 64; count++ {
		for _, first := range []uint64{1, 2, 15, 16, 63, ^uint64(0) - uint64(count) + 1} {
			seen := map[uint32]bool{}
			for offset := uint32(0); offset < count; offset++ {
				lane, err := PacketLane("transfer", "channel-0", first+uint64(offset), count)
				if err != nil || seen[lane] {
					t.Fatalf("count %d first %d offset %d: duplicate or error %v", count, first, offset, err)
				}
				seen[lane] = true
			}
		}
	}
}
