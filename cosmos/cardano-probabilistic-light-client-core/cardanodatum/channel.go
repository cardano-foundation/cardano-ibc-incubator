package cardanodatum

import (
	"bytes"
	"fmt"

	"github.com/fxamacker/cbor/v2"
)

// Channel upgrades append upgrade_sequence to the committed Aiken Channel and
// commit Upgrade and ErrorReceipt records under ibc-go's channelUpgrades paths.
// Channel ends committed before that field existed keep the five-field
// encoding, which can only authenticate upgrade sequence zero.

const (
	// Aiken records are Plutus constructor 0, which CBOR encodes as tag 121.
	plutusRecordTag = 121

	legacyChannelFields = 5
	channelFields       = 6

	// FLUSHCOMPLETE is the last ibc-go v8 channel state.
	maxChannelState = 6
	// ORDERED is the last channel ordering.
	maxChannelOrder = 2
)

// ChannelEndValue contains the protobuf Channel fields that must agree with a
// Cardano channel-end commitment, without depending on an ibc-go version.
type ChannelEndValue struct {
	State                 uint64
	Ordering              uint64
	CounterpartyPortId    string
	CounterpartyChannelId string
	ConnectionHops        []string
	Version               string
	UpgradeSequence       uint64
}

// ChannelEnd is a decoded channelEnds commitment.
type ChannelEnd struct {
	State                 uint64
	Ordering              uint64
	CounterpartyPortId    []byte
	CounterpartyChannelId []byte
	ConnectionHops        [][]byte
	Version               []byte
	UpgradeSequence       uint64
}

// UpgradeValue contains the protobuf Upgrade fields that must agree with a
// Cardano channel-upgrade commitment.
type UpgradeValue struct {
	Ordering         uint64
	ConnectionHops   []string
	Version          string
	TimeoutHeight    HeightDatum
	TimeoutTimestamp uint64
	NextSequenceSend uint64
}

// ErrorReceiptValue contains the protobuf ErrorReceipt fields that must agree
// with a Cardano upgrade-error commitment.
type ErrorReceiptValue struct {
	Sequence uint64
	Message  string
}

// DecodeChannelEnd accepts both the legacy five-field Channel and the current
// encoding with a trailing upgrade_sequence.
func DecodeChannelEnd(committed []byte) (ChannelEnd, error) {
	fields, err := decodeRecord(committed, legacyChannelFields, channelFields)
	if err != nil {
		return ChannelEnd{}, fmt.Errorf("Channel: %w", err)
	}
	var channel ChannelEnd
	if channel.State, err = decodeConstructorField(fields[0], maxChannelState); err != nil {
		return ChannelEnd{}, fmt.Errorf("Channel: invalid State: %w", err)
	}
	if channel.Ordering, err = decodeConstructorField(fields[1], maxChannelOrder); err != nil {
		return ChannelEnd{}, fmt.Errorf("Channel: invalid Ordering: %w", err)
	}
	counterparty, err := decodeRecord(fields[2], 2, 2)
	if err != nil {
		return ChannelEnd{}, fmt.Errorf("Channel: invalid Counterparty: %w", err)
	}
	if err := decodeFields(
		[]cbor.RawMessage{counterparty[0], counterparty[1], fields[3], fields[4]},
		&channel.CounterpartyPortId, &channel.CounterpartyChannelId, &channel.ConnectionHops, &channel.Version,
	); err != nil {
		return ChannelEnd{}, fmt.Errorf("Channel: %w", err)
	}
	if len(fields) == channelFields {
		if err := cbor.Unmarshal(fields[5], &channel.UpgradeSequence); err != nil {
			return ChannelEnd{}, fmt.Errorf("Channel: invalid UpgradeSequence: %w", err)
		}
	}
	return channel, nil
}

// Compare checks every field of an ibc-go v8 Channel.
func (channel ChannelEnd) Compare(expected ChannelEndValue) error {
	if err := channel.CompareWithoutUpgradeSequence(expected); err != nil {
		return err
	}
	if channel.UpgradeSequence != expected.UpgradeSequence {
		return fmt.Errorf("Channel: UpgradeSequence mismatch, expect %d, got %d", expected.UpgradeSequence, channel.UpgradeSequence)
	}
	return nil
}

// CompareWithoutUpgradeSequence serves ibc-go versions whose Channel has no
// upgrade sequence. Those endpoints cannot negotiate a channel upgrade, but the
// Cardano end can still keep the sequence of an abandoned attempt.
func (channel ChannelEnd) CompareWithoutUpgradeSequence(expected ChannelEndValue) error {
	checks := []struct {
		field string
		match bool
	}{
		{"State", channel.State == expected.State},
		{"Ordering", channel.Ordering == expected.Ordering},
		{"Counterparty PortId", string(channel.CounterpartyPortId) == expected.CounterpartyPortId},
		{"Counterparty ChannelId", string(channel.CounterpartyChannelId) == expected.CounterpartyChannelId},
		{"ConnectionHops", equalStrings(channel.ConnectionHops, expected.ConnectionHops)},
		{"Version", string(channel.Version) == expected.Version},
	}
	for _, check := range checks {
		if !check.match {
			return fmt.Errorf("Channel: %s mismatch", check.field)
		}
	}
	return nil
}

// CompareUpgrade checks a committed Aiken Upgrade:
// fields(ordering, connection_hops, version), timeout(height, timestamp) and
// next_sequence_send.
func CompareUpgrade(committed []byte, expected UpgradeValue) error {
	upgrade, err := decodeRecord(committed, 3, 3)
	if err != nil {
		return fmt.Errorf("Upgrade: %w", err)
	}
	fields, err := decodeRecord(upgrade[0], 3, 3)
	if err != nil {
		return fmt.Errorf("Upgrade: invalid Fields: %w", err)
	}
	timeout, err := decodeRecord(upgrade[1], 2, 2)
	if err != nil {
		return fmt.Errorf("Upgrade: invalid Timeout: %w", err)
	}
	height, err := decodeRecord(timeout[0], 2, 2)
	if err != nil {
		return fmt.Errorf("Upgrade: invalid Timeout Height: %w", err)
	}
	ordering, err := decodeConstructorField(fields[0], maxChannelOrder)
	if err != nil {
		return fmt.Errorf("Upgrade: invalid Ordering: %w", err)
	}
	var (
		hops                                      [][]byte
		version                                   []byte
		revisionNumber, revisionHeight, timestamp uint64
		nextSequenceSend                          uint64
	)
	if err := decodeFields(
		[]cbor.RawMessage{fields[1], fields[2], height[0], height[1], timeout[1], upgrade[2]},
		&hops, &version, &revisionNumber, &revisionHeight, &timestamp, &nextSequenceSend,
	); err != nil {
		return fmt.Errorf("Upgrade: %w", err)
	}
	checks := []struct {
		field string
		match bool
	}{
		{"Ordering", ordering == expected.Ordering},
		{"ConnectionHops", equalStrings(hops, expected.ConnectionHops)},
		{"Version", string(version) == expected.Version},
		{"Timeout Height", revisionNumber == expected.TimeoutHeight.RevisionNumber && revisionHeight == expected.TimeoutHeight.RevisionHeight},
		{"Timeout Timestamp", timestamp == expected.TimeoutTimestamp},
		{"NextSequenceSend", nextSequenceSend == expected.NextSequenceSend},
	}
	for _, check := range checks {
		if !check.match {
			return fmt.Errorf("Upgrade: %s mismatch", check.field)
		}
	}
	return nil
}

// CompareErrorReceipt checks a committed Aiken ErrorReceipt(sequence, message).
func CompareErrorReceipt(committed []byte, expected ErrorReceiptValue) error {
	receipt, err := decodeRecord(committed, 2, 2)
	if err != nil {
		return fmt.Errorf("ErrorReceipt: %w", err)
	}
	var (
		sequence uint64
		message  []byte
	)
	if err := decodeFields(receipt, &sequence, &message); err != nil {
		return fmt.Errorf("ErrorReceipt: %w", err)
	}
	if sequence != expected.Sequence {
		return fmt.Errorf("ErrorReceipt: Sequence mismatch, expect %d, got %d", expected.Sequence, sequence)
	}
	if !bytes.Equal(message, []byte(expected.Message)) {
		return fmt.Errorf("ErrorReceipt: Message mismatch")
	}
	return nil
}

// decodeRecord returns the fields of exactly one Aiken record. Checking the
// constructor keeps a different record or enum constructor from decoding as
// the expected record.
func decodeRecord(data []byte, minFields, maxFields int) ([]cbor.RawMessage, error) {
	var record cbor.RawTag
	if err := cbor.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	if record.Number != plutusRecordTag {
		return nil, fmt.Errorf("invalid record constructor")
	}
	var fields []cbor.RawMessage
	if err := cbor.Unmarshal(record.Content, &fields); err != nil {
		return nil, err
	}
	if len(fields) < minFields || len(fields) > maxFields {
		return nil, fmt.Errorf("unexpected record field count %d", len(fields))
	}
	return fields, nil
}

func decodeConstructorField(data cbor.RawMessage, maximum uint64) (uint64, error) {
	var value any
	if err := cbor.Unmarshal(data, &value); err != nil {
		return 0, err
	}
	return DecodeNullaryConstructor(value, maximum)
}

func decodeFields(fields []cbor.RawMessage, targets ...any) error {
	for i, target := range targets {
		if err := cbor.Unmarshal(fields[i], target); err != nil {
			return err
		}
	}
	return nil
}

// Connection hops are ordered, as in ibc-go's protobuf commitment.
func equalStrings(committed [][]byte, expected []string) bool {
	if len(committed) != len(expected) {
		return false
	}
	for i, value := range committed {
		if string(value) != expected[i] {
			return false
		}
	}
	return true
}
