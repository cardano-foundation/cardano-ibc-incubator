package probabilisticcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	ics23 "github.com/cosmos/ics23/go"
)

const MaxPacketLanes = 64

var packetLanePort = regexp.MustCompile(`^[a-zA-Z0-9._+\-#\[\]<>]{2,128}$`)

func laneChannelIdentity(port, channel string) ([]byte, error) {
	if !packetLanePort.MatchString(port) || !strings.HasPrefix(channel, "channel-") {
		return nil, fmt.Errorf("invalid packet lane port or channel")
	}
	sequence := strings.TrimPrefix(channel, "channel-")
	number, err := strconv.ParseUint(sequence, 10, 64)
	if err != nil || strconv.FormatUint(number, 10) != sequence {
		return nil, fmt.Errorf("non-canonical packet lane channel")
	}
	return append(laneFrame(port), laneFrame(channel)...), nil
}

func laneFrame(value string) []byte {
	result := make([]byte, 4+len(value))
	binary.BigEndian.PutUint32(result, uint32(len(value)))
	copy(result[4:], value)
	return result
}

func laneDomain(name string) []byte {
	return []byte("cardano-ibc/" + name + "/v1\x00")
}

func PacketLane(port, channel string, sequence uint64, count uint32) (uint32, error) {
	if count == 0 || count > MaxPacketLanes || sequence == 0 {
		return 0, fmt.Errorf("invalid packet lane count or sequence")
	}
	_, err := laneChannelIdentity(port, channel)
	if err != nil {
		return 0, err
	}
	return uint32(sequence % uint64(count)), nil
}

func PacketLaneTokenName(port, channel string, lane, count uint32) ([]byte, error) {
	if count == 0 || count > MaxPacketLanes || lane >= count {
		return nil, fmt.Errorf("invalid packet lane")
	}
	identity, err := laneChannelIdentity(port, channel)
	if err != nil {
		return nil, err
	}
	preimage := append(laneDomain("packet-lane-token"), identity...)
	preimage = binary.BigEndian.AppendUint32(preimage, lane)
	hash := sha256.Sum256(preimage)
	return hash[:], nil
}

type PacketLaneKey struct {
	Kind     string
	Port     string
	Channel  string
	Sequence uint64
}

func ParsePacketLaneKey(key []byte) (PacketLaneKey, error) {
	parts := strings.Split(string(key), "/")
	if len(parts) != 7 || parts[1] != "ports" || parts[3] != "channels" || parts[5] != "sequences" {
		return PacketLaneKey{}, fmt.Errorf("not a canonical packet key")
	}
	if parts[0] != "commitments" && parts[0] != "receipts" && parts[0] != "acks" {
		return PacketLaneKey{}, fmt.Errorf("not a packet key")
	}
	if _, err := laneChannelIdentity(parts[2], parts[4]); err != nil {
		return PacketLaneKey{}, err
	}
	sequence, err := strconv.ParseUint(parts[6], 10, 64)
	if err != nil || sequence == 0 || strconv.FormatUint(sequence, 10) != parts[6] {
		return PacketLaneKey{}, fmt.Errorf("non-canonical packet sequence")
	}
	return PacketLaneKey{parts[0], parts[2], parts[4], sequence}, nil
}

// PacketLaneRoot must come from authenticated consensus state at Height.
// A relayer-supplied root or a root borrowed from another height is not evidence.
type PacketLaneRoot struct {
	Port      string
	Channel   string
	Lane      uint32
	LaneCount uint32
	Height    uint64
	Version   uint64
	Root      []byte
}

func (root PacketLaneRoot) ValidateKey(height uint64, key []byte) error {
	if height == 0 || root.Height != height || len(root.Root) != sha256.Size {
		return fmt.Errorf("packet lane root does not match proof height")
	}
	parsed, err := ParsePacketLaneKey(key)
	if err != nil {
		return err
	}
	lane, err := PacketLane(parsed.Port, parsed.Channel, parsed.Sequence, root.LaneCount)
	if err != nil {
		return err
	}
	if parsed.Port != root.Port || parsed.Channel != root.Channel || lane != root.Lane {
		return fmt.Errorf("packet key does not belong to authenticated lane")
	}
	return nil
}

func VerifyPacketLaneMembership(root PacketLaneRoot, height uint64, key, value []byte, proof *ics23.ExistenceProof) error {
	if err := root.ValidateKey(height, key); err != nil {
		return err
	}
	if proof == nil || len(value) == 0 || !bytes.Equal(proof.Key, key) || !bytes.Equal(proof.Value, value) {
		return fmt.Errorf("packet membership requires an exact nonempty key and value")
	}
	if err := validatePacketLanePath(proof.Path); err != nil {
		return err
	}
	return VerifyIbcStateMembershipWithExistenceProof(root.Root, key, value, proof, nil)
}

func VerifyPacketLaneNonMembership(root PacketLaneRoot, height uint64, key []byte, proof *ics23.NonExistenceProof) error {
	if err := root.ValidateKey(height, key); err != nil {
		return err
	}
	if proof == nil || !bytes.Equal(proof.Key, key) || proof.Left == nil || !bytes.Equal(proof.Left.Key, key) {
		return fmt.Errorf("packet non-membership requires an exact key")
	}
	if proof.Right != nil {
		return fmt.Errorf("unexpected right neighbour in sparse packet proof")
	}
	if err := validatePacketLanePath(proof.Left.Path); err != nil {
		return err
	}
	return VerifyIbcStateNonMembershipWithNonExistenceProof(root.Root, key, proof)
}

func validatePacketLanePath(path []*ics23.InnerOp) error {
	if len(path) != 64 {
		return fmt.Errorf("packet lane proof requires 64 inner operations")
	}
	for _, op := range path {
		if op == nil || op.Hash != ics23.HashOp_SHA256 {
			return fmt.Errorf("invalid packet lane inner operation")
		}
	}
	return nil
}
