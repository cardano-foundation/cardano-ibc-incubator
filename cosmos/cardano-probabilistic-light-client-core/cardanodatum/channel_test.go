package cardanodatum

import (
	"testing"

	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
)

// Plutus records and nullary constructors as Aiken commits them.
func testRecord(fields ...any) cbor.Tag {
	return cbor.Tag{Number: plutusRecordTag, Content: fields}
}

func testConstructor(index uint64) cbor.Tag {
	return cbor.Tag{Number: plutusRecordTag + index, Content: []any{}}
}

func testEncode(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := cbor.Marshal(value)
	require.NoError(t, err)
	return encoded
}

// The legacy Channel has five fields. Channel upgrades append upgrade_sequence.
func testChannelFields(state uint64, hops ...string) []any {
	encodedHops := [][]byte{}
	for _, hop := range hops {
		encodedHops = append(encodedHops, []byte(hop))
	}
	return []any{
		testConstructor(state), testConstructor(1),
		testRecord([]byte("transfer"), []byte("channel-2")),
		encodedHops, []byte("ics20-1"),
	}
}

func testChannelValue(state, sequence uint64, hops ...string) ChannelEndValue {
	return ChannelEndValue{
		State: state, Ordering: 1, CounterpartyPortId: "transfer", CounterpartyChannelId: "channel-2",
		ConnectionHops: hops, Version: "ics20-1", UpgradeSequence: sequence,
	}
}

func TestChannelEndAcceptsLegacyAndUpgradedEncodings(t *testing.T) {
	legacy := testEncode(t, testRecord(testChannelFields(3, "connection-0")...))
	channel, err := DecodeChannelEnd(legacy)
	require.NoError(t, err)
	require.NoError(t, channel.Compare(testChannelValue(3, 0, "connection-0")))

	for state := uint64(0); state <= 6; state++ {
		for _, sequence := range []uint64{0, 1, 7, 1<<64 - 1} {
			upgraded := testEncode(t, testRecord(append(testChannelFields(state, "connection-1"), sequence)...))
			channel, err := DecodeChannelEnd(upgraded)
			require.NoError(t, err)
			require.NoError(t, channel.Compare(testChannelValue(state, sequence, "connection-1")))
			if state != 3 {
				require.Error(t, channel.Compare(testChannelValue(3, sequence, "connection-1")))
			}
		}
	}
}

// Before channel upgrades, Cardano had no sequence to commit. The five-field
// value therefore proves sequence zero and nothing else.
func TestLegacyChannelEndOnlyAuthenticatesSequenceZero(t *testing.T) {
	legacy := testEncode(t, testRecord(testChannelFields(3, "connection-0")...))
	channel, err := DecodeChannelEnd(legacy)
	require.NoError(t, err)
	for _, sequence := range []uint64{1, 2, 1<<64 - 1} {
		require.ErrorContains(t, channel.Compare(testChannelValue(3, sequence, "connection-0")), "UpgradeSequence")
		require.NoError(t, channel.CompareWithoutUpgradeSequence(testChannelValue(3, sequence, "connection-0")))
	}
}

func TestChannelEndComparisonUsesAllFields(t *testing.T) {
	committed := testEncode(t, testRecord(append(testChannelFields(5, "connection-1"), uint64(4))...))
	channel, err := DecodeChannelEnd(committed)
	require.NoError(t, err)
	fresh := func() ChannelEndValue { return testChannelValue(5, 4, "connection-1") }
	require.NoError(t, channel.Compare(fresh()))
	for name, change := range map[string]func(*ChannelEndValue){
		"state":                func(v *ChannelEndValue) { v.State = 6 },
		"ordering":             func(v *ChannelEndValue) { v.Ordering = 2 },
		"counterparty port":    func(v *ChannelEndValue) { v.CounterpartyPortId = "other" },
		"counterparty channel": func(v *ChannelEndValue) { v.CounterpartyChannelId = "channel-3" },
		"replacement hop":      func(v *ChannelEndValue) { v.ConnectionHops = []string{"connection-0"} },
		"missing hop":          func(v *ChannelEndValue) { v.ConnectionHops = nil },
		"extra hop":            func(v *ChannelEndValue) { v.ConnectionHops = []string{"connection-1", "connection-0"} },
		"version":              func(v *ChannelEndValue) { v.Version = "ics20-2" },
		"older sequence":       func(v *ChannelEndValue) { v.UpgradeSequence = 3 },
		"newer sequence":       func(v *ChannelEndValue) { v.UpgradeSequence = 5 },
	} {
		t.Run(name, func(t *testing.T) {
			v := fresh()
			change(&v)
			require.Error(t, channel.Compare(v))
		})
	}
}

// ibc-go proves the protobuf bytes of the hops in order.
func TestChannelEndConnectionHopsAreOrdered(t *testing.T) {
	committed := testEncode(t, testRecord(append(testChannelFields(3, "connection-0", "connection-1"), uint64(1))...))
	channel, err := DecodeChannelEnd(committed)
	require.NoError(t, err)
	require.NoError(t, channel.Compare(testChannelValue(3, 1, "connection-0", "connection-1")))
	expected := testChannelValue(3, 1, "connection-1", "connection-0")
	require.Error(t, channel.Compare(expected))
	require.Equal(t, []string{"connection-1", "connection-0"}, expected.ConnectionHops, "comparison must not reorder the expected value")
}

func TestChannelEndRejectsMalformedEncodings(t *testing.T) {
	fields := testChannelFields(3, "connection-0")
	replace := func(index int, value any) []any {
		changed := append([]any{}, fields...)
		changed[index] = value
		return changed
	}
	for name, value := range map[string]any{
		"untagged array":            fields,
		"other constructor":         cbor.Tag{Number: plutusRecordTag + 1, Content: fields},
		"four fields":               testRecord(fields[:4]...),
		"seven fields":              testRecord(append(append([]any{}, fields...), uint64(1), uint64(2))...),
		"state after flushcomplete": testRecord(replace(0, testConstructor(7))...),
		"state with fields":         testRecord(replace(0, cbor.Tag{Number: plutusRecordTag + 3, Content: []any{uint64(1)}})...),
		"ordering after ordered":    testRecord(replace(1, testConstructor(3))...),
		"untagged counterparty":     testRecord(replace(2, []any{[]byte("transfer"), []byte("channel-2")})...),
		"short counterparty":        testRecord(replace(2, testRecord([]byte("transfer")))...),
		"text version":              testRecord(replace(4, "ics20-1")...),
		"negative sequence":         testRecord(append(append([]any{}, fields...), int64(-1))...),
		"bytes sequence":            testRecord(append(append([]any{}, fields...), []byte{1})...),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := DecodeChannelEnd(testEncode(t, value))
			require.Error(t, err)
		})
	}
	_, err := DecodeChannelEnd(append(testEncode(t, testRecord(fields...)), 0))
	require.Error(t, err, "trailing bytes")
}

func testUpgrade(ordering uint64, hops []string, version string, height HeightDatum, timestamp, nextSequenceSend uint64) []byte {
	encodedHops := [][]byte{}
	for _, hop := range hops {
		encodedHops = append(encodedHops, []byte(hop))
	}
	encoded, _ := cbor.Marshal(testRecord(
		testRecord(testConstructor(ordering), encodedHops, []byte(version)),
		testRecord(testRecord(height.RevisionNumber, height.RevisionHeight), timestamp),
		nextSequenceSend,
	))
	return encoded
}

func TestUpgradeComparisonUsesAllFields(t *testing.T) {
	committed := testUpgrade(1, []string{"connection-1"}, "ics20-1", HeightDatum{RevisionNumber: 2, RevisionHeight: 500}, 1_700_000_600_000_000_000, 5)
	fresh := func() UpgradeValue {
		return UpgradeValue{
			Ordering: 1, ConnectionHops: []string{"connection-1"}, Version: "ics20-1",
			TimeoutHeight: HeightDatum{RevisionNumber: 2, RevisionHeight: 500}, TimeoutTimestamp: 1_700_000_600_000_000_000, NextSequenceSend: 5,
		}
	}
	require.NoError(t, CompareUpgrade(committed, fresh()))
	for name, change := range map[string]func(*UpgradeValue){
		"ordering":                func(v *UpgradeValue) { v.Ordering = 2 },
		"previous hop":            func(v *UpgradeValue) { v.ConnectionHops = []string{"connection-0"} },
		"no hops":                 func(v *UpgradeValue) { v.ConnectionHops = nil },
		"version":                 func(v *UpgradeValue) { v.Version = "" },
		"timeout revision":        func(v *UpgradeValue) { v.TimeoutHeight.RevisionNumber = 1 },
		"timeout height":          func(v *UpgradeValue) { v.TimeoutHeight.RevisionHeight = 499 },
		"timeout timestamp":       func(v *UpgradeValue) { v.TimeoutTimestamp++ },
		"zero timeout":            func(v *UpgradeValue) { v.TimeoutHeight, v.TimeoutTimestamp = HeightDatum{}, 0 },
		"next sequence send":      func(v *UpgradeValue) { v.NextSequenceSend = 6 },
		"zero next sequence send": func(v *UpgradeValue) { v.NextSequenceSend = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			v := fresh()
			change(&v)
			require.Error(t, CompareUpgrade(committed, v))
		})
	}

	// TRY proves the counterparty's INIT-stage record: no timeout and no send boundary.
	initial := testUpgrade(1, []string{"connection-1"}, "ics20-1", HeightDatum{}, 0, 0)
	require.NoError(t, CompareUpgrade(initial, UpgradeValue{Ordering: 1, ConnectionHops: []string{"connection-1"}, Version: "ics20-1"}))
	require.Error(t, CompareUpgrade(initial, fresh()))
	require.Error(t, CompareUpgrade(committed, UpgradeValue{Ordering: 1, ConnectionHops: []string{"connection-1"}, Version: "ics20-1"}))
}

func TestUpgradeRejectsMalformedEncodings(t *testing.T) {
	fields := testRecord(testConstructor(1), [][]byte{[]byte("connection-1")}, []byte("ics20-1"))
	timeout := testRecord(testRecord(uint64(0), uint64(0)), uint64(1))
	for name, value := range map[string]any{
		"untagged":          []any{fields, timeout, uint64(1)},
		"missing sequence":  testRecord(fields, timeout),
		"extra field":       testRecord(fields, timeout, uint64(1), uint64(2)),
		"ordering":          testRecord(testRecord(testConstructor(3), [][]byte{}, []byte("ics20-1")), timeout, uint64(1)),
		"fields arity":      testRecord(testRecord(testConstructor(1), [][]byte{}), timeout, uint64(1)),
		"untagged height":   testRecord(fields, testRecord([]any{uint64(0), uint64(0)}, uint64(1)), uint64(1)),
		"timeout arity":     testRecord(fields, testRecord(testRecord(uint64(0), uint64(0))), uint64(1)),
		"negative sequence": testRecord(fields, timeout, int64(-1)),
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, CompareUpgrade(testEncode(t, value), UpgradeValue{Ordering: 1, ConnectionHops: []string{"connection-1"}, Version: "ics20-1", TimeoutTimestamp: 1, NextSequenceSend: 1}))
		})
	}
}

func TestErrorReceiptComparison(t *testing.T) {
	message := "ABCI code: 28: restored channel to pre-upgrade state"
	committed := testEncode(t, testRecord(uint64(3), []byte(message)))
	require.NoError(t, CompareErrorReceipt(committed, ErrorReceiptValue{Sequence: 3, Message: message}))
	require.Error(t, CompareErrorReceipt(committed, ErrorReceiptValue{Sequence: 2, Message: message}))
	require.Error(t, CompareErrorReceipt(committed, ErrorReceiptValue{Sequence: 4, Message: message}))
	require.Error(t, CompareErrorReceipt(committed, ErrorReceiptValue{Sequence: 3, Message: message + "."}))
	require.Error(t, CompareErrorReceipt(committed, ErrorReceiptValue{Sequence: 3}))
	for name, value := range map[string]any{
		"untagged":     []any{uint64(3), []byte(message)},
		"text message": testRecord(uint64(3), message),
		"one field":    testRecord(uint64(3)),
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, CompareErrorReceipt(testEncode(t, value), ErrorReceiptValue{Sequence: 3, Message: message}))
		})
	}
}
