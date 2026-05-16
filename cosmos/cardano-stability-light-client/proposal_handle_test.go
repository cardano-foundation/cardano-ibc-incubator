package stability

import (
	"bytes"
	"testing"
	"time"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestIsMatchingClientStateIgnoresEpochVerificationState(t *testing.T) {
	subject := newStabilityTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	subject.FrozenHeight = NewHeight(0, 9)
	subject.CurrentEpoch = 7
	subject.TrustingPeriod = 24 * time.Hour
	subject.ChainId = "cardano-old"
	subject.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
	}

	substitute := newStabilityTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.FrozenHeight = ZeroHeight()
	substitute.CurrentEpoch = 9
	substitute.TrustingPeriod = 48 * time.Hour
	substitute.ChainId = "cardano-new"
	substitute.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(8, 100, 200, 0x08),
		makeRecoveryEpochContext(9, 200, 300, 0x09),
	}
	substitute.EpochStakeDistribution = []*StakeDistributionEntry{
		{
			PoolId:     "pool-z",
			Stake:      50_000,
			VrfKeyHash: bytes.Repeat([]byte{0x1a}, 32),
		},
	}
	substitute.EpochNonce = bytes.Repeat([]byte{0x1b}, 32)
	substitute.SlotsPerKesPeriod = 777
	substitute.CurrentEpochStartSlot = 200
	substitute.CurrentEpochEndSlotExclusive = 300

	require.True(t, IsMatchingClientState(*subject, *substitute))
}

func TestIsMatchingClientStateRejectsStaticParameterMismatch(t *testing.T) {
	subject := newStabilityTestClientState()
	substitute := newStabilityTestClientState()
	substitute.HostStateNftTokenName = []byte("different-host-state")

	require.False(t, IsMatchingClientState(*subject, *substitute))
}

func TestZeroCustomFieldsDropsEpochVerificationState(t *testing.T) {
	clientState := newStabilityTestClientState()
	clientState.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
		makeRecoveryEpochContext(8, 100, 200, 0x08),
	}
	require.NoError(t, syncLegacyEpochContextFields(clientState, clientState.EpochContexts, 8))

	zeroed, ok := clientState.ZeroCustomFields().(*ClientState)
	require.True(t, ok)
	require.Nil(t, zeroed.EpochContexts)
	require.Empty(t, zeroed.EpochStakeDistribution)
	require.Empty(t, zeroed.EpochNonce)
	require.Zero(t, zeroed.SlotsPerKesPeriod)
	require.Zero(t, zeroed.CurrentEpochStartSlot)
	require.Zero(t, zeroed.CurrentEpochEndSlotExclusive)
	require.NotNil(t, zeroed.HeuristicParams)
	require.Equal(t, clientState.SystemStartUnixNs, zeroed.SystemStartUnixNs)
	require.Equal(t, clientState.SlotLengthNs, zeroed.SlotLengthNs)
}

func TestCheckSubstituteAndUpdateStateAcceptsDifferentEpochContext(t *testing.T) {
	cdc := newStabilityTestCodec()
	ctx, subjectStore := newStabilityTestClientStore(t, "stability-subject")
	_, substituteStore := newStabilityTestClientStore(t, "stability-substitute")

	subject := newStabilityTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	subject.CurrentEpoch = 7
	subject.TrustingPeriod = 24 * time.Hour
	subject.ChainId = "cardano-old"
	subject.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
	}
	require.NoError(t, syncLegacyEpochContextFields(subject, subject.EpochContexts, 7))
	subject.FrozenHeight = NewHeight(0, 5)
	setClientState(subjectStore, cdc, subject)

	substitute := newStabilityTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.CurrentEpoch = 9
	substitute.TrustingPeriod = 48 * time.Hour
	substitute.ChainId = "cardano-new"
	substitute.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(8, 100, 200, 0x08),
		makeRecoveryEpochContext(9, 200, 300, 0x09),
	}
	require.NoError(t, syncLegacyEpochContextFields(substitute, substitute.EpochContexts, 9))
	setClientState(substituteStore, cdc, substitute)

	consensusState := newStabilityTestConsensusState("hash-20")
	consensusState.AcceptedEpoch = 9
	setConsensusState(substituteStore, cdc, consensusState, substitute.LatestHeight)
	setConsensusMetadataWithValues(substituteStore, substitute.LatestHeight, clienttypes.NewHeight(0, 50), 123456789)

	err := subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute)
	require.NoError(t, err)

	recoveredClient, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, substitute.LatestHeight.String(), recoveredClient.LatestHeight.String())
	require.EqualValues(t, substitute.CurrentEpoch, recoveredClient.CurrentEpoch)
	require.Equal(t, substitute.ChainId, recoveredClient.ChainId)
	require.Equal(t, substitute.TrustingPeriod, recoveredClient.TrustingPeriod)
	require.NotNil(t, recoveredClient.FrozenHeight)
	require.True(t, recoveredClient.FrozenHeight.IsZero())

	contexts, err := recoveredClient.normalizedEpochContexts()
	require.NoError(t, err)
	require.Len(t, contexts, 2)
	require.EqualValues(t, 8, contexts[0].Epoch)
	require.EqualValues(t, 9, contexts[1].Epoch)
	require.Equal(t, substitute.EpochNonce, recoveredClient.EpochNonce)
	require.EqualValues(t, substitute.CurrentEpochStartSlot, recoveredClient.CurrentEpochStartSlot)
	require.EqualValues(t, substitute.CurrentEpochEndSlotExclusive, recoveredClient.CurrentEpochEndSlotExclusive)

	recoveredConsensus, found := GetConsensusState(subjectStore, cdc, substitute.LatestHeight)
	require.True(t, found)
	require.EqualValues(t, 9, recoveredConsensus.AcceptedEpoch)

	processedHeight, found := GetProcessedHeight(subjectStore, substitute.LatestHeight)
	require.True(t, found)
	require.Equal(t, clienttypes.NewHeight(0, 50).String(), processedHeight.String())

	processedTime, found := GetProcessedTime(subjectStore, substitute.LatestHeight)
	require.True(t, found)
	require.EqualValues(t, 123456789, processedTime)
}

func makeRecoveryEpochContext(epoch, startSlot, endSlot uint64, seed byte) *EpochContext {
	return &EpochContext{
		Epoch:                 epoch,
		EpochStartSlot:        startSlot,
		EpochEndSlotExclusive: endSlot,
		EpochNonce:            bytes.Repeat([]byte{seed}, 32),
		SlotsPerKesPeriod:     129600,
		StakeDistribution: []*StakeDistributionEntry{
			{
				PoolId:     "pool-a",
				Stake:      10_000,
				VrfKeyHash: bytes.Repeat([]byte{seed + 1}, 32),
			},
		},
	}
}
