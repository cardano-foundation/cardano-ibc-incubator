package probabilistic

import (
	"reflect"
	"testing"

	errorsmod "cosmossdk.io/errors"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/gogoproto/proto"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestCoreConversionsPreserveEveryFieldAndOwnTheirData(t *testing.T) {
	checkCoreConversion(t, &ClientState{}, toCoreClientState, fromCoreClientState)
	checkCoreConversion(t, &ConsensusState{}, toCoreConsensusState, fromCoreConsensusState)
	checkCoreConversion(t, &ProbabilisticHeader{}, toCoreProbabilisticHeader, fromCoreProbabilisticHeader)
	checkCoreConversion(t, &Misbehaviour{}, toCoreMisbehaviour, fromCoreMisbehaviour)
	checkCoreConversion(t, &Height{}, toCoreHeight, fromCoreHeight)
}

func checkCoreConversion[P proto.Message, S any](t *testing.T, message P, to func(P) *S, from func(*S) P) {
	t.Helper()
	t.Run(proto.MessageName(message), func(t *testing.T) {
		// Zero values exercise nil heights, nested messages, and slices.
		require.Equal(t, message, from(to(message)))
		var nilMessage P
		require.Nil(t, to(nilMessage))
		require.Equal(t, nilMessage, from(nil))
		fillModel(reflect.ValueOf(message).Elem(), 42)
		shared := to(message)
		roundtrip := from(shared)
		require.Equal(t, message, roundtrip)
		before, err := proto.Marshal(message)
		require.NoError(t, err)
		after, err := proto.Marshal(roundtrip)
		require.NoError(t, err)
		require.Equal(t, before, after)
		// Neither conversion may share mutable buffers or nested messages.
		fillModel(reflect.ValueOf(message).Elem(), 43)
		require.Equal(t, roundtrip, from(shared))
		fillModel(reflect.ValueOf(roundtrip).Elem(), 44)
		unchanged, err := proto.Marshal(from(shared))
		require.NoError(t, err)
		require.Equal(t, before, unchanged)
	})
}

// Populate every field so adding a protobuf field cannot silently bypass the
// conversion tests. Distinct values also expose swapped or dropped fields.
func fillModel(v reflect.Value, seed uint64) {
	switch v.Kind() {
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			fillModel(v.Field(i), seed+uint64(i))
		}
	case reflect.Pointer:
		if v.IsNil() {
			v.Set(reflect.New(v.Type().Elem()))
		}
		fillModel(v.Elem(), seed)
	case reflect.Slice:
		if v.IsNil() {
			v.Set(reflect.MakeSlice(v.Type(), 2, 2))
		}
		for i := 0; i < v.Len(); i++ {
			fillModel(v.Index(i), seed+uint64(i))
		}
	case reflect.String:
		v.SetString(string(rune(seed)))
	case reflect.Uint8, reflect.Uint32, reflect.Uint64:
		v.SetUint(seed)
	case reflect.Int64:
		v.SetInt(int64(seed))
	case reflect.Bool:
		v.SetBool(seed%2 == 0)
	default:
		panic("unsupported model field: " + v.Type().String())
	}
}

func TestCoreErrorsKeepIBCIdentityCodesAndText(t *testing.T) {
	for _, mapping := range ibcErrors {
		require.Same(t, mapping.host, adapterError(mapping.core))
		wrapped := errorsmod.Wrap(errorsmod.Wrap(mapping.core, "inner"), "outer")
		translated := adapterError(wrapped)
		require.ErrorIs(t, translated, mapping.host)
		require.Equal(t, wrapped.Error(), translated.Error())
		expectedSpace, expectedCode, _ := errorsmod.ABCIInfo(mapping.host, false)
		actualSpace, actualCode, _ := errorsmod.ABCIInfo(translated, false)
		require.Equal(t, expectedSpace, actualSpace)
		require.Equal(t, expectedCode, actualCode)
	}
	client := newProbabilisticTestClientState()
	client.HostStateNftPolicyId = nil
	require.ErrorIs(t, client.Validate(), clienttypes.ErrInvalidClient)
	require.ErrorIs(t, adapterError(state.ErrInvalidTimestamp), ErrInvalidTimestamp)
	require.Nil(t, adapterError(nil))
}
