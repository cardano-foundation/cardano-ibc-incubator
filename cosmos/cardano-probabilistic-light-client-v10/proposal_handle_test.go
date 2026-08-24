package probabilistic

import (
	"bytes"
	"encoding/hex"
	"testing"
	"time"

	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/stretchr/testify/require"
)

func TestIsMatchingClientStateIgnoresEpochVerificationState(t *testing.T) {
	subject := newProbabilisticTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	subject.FrozenHeight = NewHeight(0, 9)
	subject.CurrentEpoch = 7
	subject.TrustingPeriod = 24 * time.Hour
	subject.ChainId = "cardano-old"
	subject.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
	}

	substitute := newProbabilisticTestClientState()
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
	substitute.CurrentEpochStartSlot = 200
	substitute.CurrentEpochEndSlotExclusive = 300

	require.True(t, IsMatchingClientState(*subject, *substitute))
}

func TestIsMatchingClientStateRejectsStaticParameterMismatch(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*ClientState)
	}{
		{
			name: "host state token",
			mutate: func(substitute *ClientState) {
				substitute.HostStateNftTokenName = []byte("different-host-state")
			},
		},
		{
			name: "slots per KES period",
			mutate: func(substitute *ClientState) {
				substitute.SlotsPerKesPeriod++
			},
		},
		{
			name: "max KES evolutions",
			mutate: func(substitute *ClientState) {
				substitute.MaxKesEvolutions--
			},
		},
		{
			name: "max clock drift",
			mutate: func(substitute *ClientState) {
				substitute.MaxClockDrift++
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			subject := newProbabilisticTestClientState()
			substitute := newProbabilisticTestClientState()
			tc.mutate(substitute)

			require.False(t, IsMatchingClientState(*subject, *substitute))
		})
	}
}

func TestZeroCustomFieldsDropsEpochVerificationState(t *testing.T) {
	clientState := newProbabilisticTestClientState()
	clientState.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
		makeRecoveryEpochContext(8, 100, 200, 0x08),
	}
	require.NoError(t, syncCurrentEpochFields(clientState, clientState.EpochContexts, 8))

	zeroed, ok := clientState.ZeroCustomFields().(*ClientState)
	require.True(t, ok)
	require.Nil(t, zeroed.EpochContexts)
	require.Empty(t, zeroed.EpochStakeDistribution)
	require.Empty(t, zeroed.EpochNonce)
	require.Equal(t, clientState.SlotsPerKesPeriod, zeroed.SlotsPerKesPeriod)
	require.Equal(t, clientState.MaxKesEvolutions, zeroed.MaxKesEvolutions)
	require.Nil(t, zeroed.OperationalCertificateCounterHistoryStartHeight)
	require.Zero(t, zeroed.CurrentEpochStartSlot)
	require.Zero(t, zeroed.CurrentEpochEndSlotExclusive)
	require.Equal(t, clientState.SystemStartUnixNs, zeroed.SystemStartUnixNs)
	require.Equal(t, clientState.SlotLengthNs, zeroed.SlotLengthNs)
	require.Zero(t, zeroed.MaxClockDrift)
	require.Zero(t, zeroed.LatestCheckpointSlot)
	require.Zero(t, zeroed.LatestCheckpointTimestamp)
}

func TestCheckSubstituteAndUpdateStateAcceptsDifferentEpochContext(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-substitute")

	subject := newProbabilisticTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	subject.CurrentEpoch = 7
	subject.TrustingPeriod = 24 * time.Hour
	subject.ChainId = "cardano-old"
	subject.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(7, 0, 100, 0x07),
	}
	require.NoError(t, syncCurrentEpochFields(subject, subject.EpochContexts, 7))
	subject.FrozenHeight = NewHeight(0, 5)
	setTestCheckpoint(t, subject, subject.LatestHeight, "subject-hash-10", 7, 10)
	setClientState(subjectStore, cdc, subject)

	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.CurrentEpoch = 9
	substitute.TrustingPeriod = 48 * time.Hour
	substitute.ChainId = "cardano-new"
	substitute.EpochContexts = []*EpochContext{
		makeRecoveryEpochContext(8, 100, 200, 0x08),
		makeRecoveryEpochContext(9, 200, 300, 0x09),
	}
	require.NoError(t, syncCurrentEpochFields(substitute, substitute.EpochContexts, 9))
	substitute.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: bytes.Repeat([]byte{0x29}, 28), SequenceNumber: 6},
	}
	setClientState(substituteStore, cdc, substitute)

	consensusState := newProbabilisticTestConsensusState("hash-20")
	consensusState.AcceptedEpoch = 9
	consensusTimestamp, timestampErr := substitute.DeriveTimestampFromSlot(20)
	require.NoError(t, timestampErr)
	consensusState.Timestamp = consensusTimestamp
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
	require.Equal(t, substitute.LatestCheckpointOperationalCertificateCounters, recoveredClient.LatestCheckpointOperationalCertificateCounters)
	require.Equal(t, uint64(20), recoveredClient.OperationalCertificateCounterHistoryStartHeight.RevisionHeight)
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

func TestCheckSubstituteAndUpdateStateRejectsOperationalCertificateCounterRegression(t *testing.T) {
	poolID := bytes.Repeat([]byte{0x2c}, 28)
	for _, tc := range []struct {
		name               string
		substituteCounters []*OperationalCertificateCounter
	}{
		{
			name: "lower counter",
			substituteCounters: []*OperationalCertificateCounter{
				{PoolId: poolID, SequenceNumber: 5},
			},
		},
		{
			name:               "omitted pool",
			substituteCounters: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cdc := newProbabilisticTestCodec()
			ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-current-subject-counter-regression")
			_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-current-substitute-counter-regression")

			subject := newProbabilisticTestClientState()
			subject.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
				{PoolId: poolID, SequenceNumber: 6},
			}
			setClientState(subjectStore, cdc, subject)

			substitute := newProbabilisticTestClientState()
			substitute.LatestHeight = NewHeight(0, 20)
			setTestCheckpoint(t, substitute, substitute.LatestHeight, "hash-20", 7, 0)
			substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)
			substitute.LatestCheckpointOperationalCertificateCounters = tc.substituteCounters
			setClientState(substituteStore, cdc, substitute)
			consensusState := newProbabilisticTestConsensusState("hash-20")
			setConsensusState(substituteStore, cdc, consensusState, substitute.LatestHeight)
			setConsensusMetadataWithValues(
				substituteStore,
				substitute.LatestHeight,
				clienttypes.NewHeight(0, 50),
				123456789,
			)

			err := subject.CheckSubstituteAndUpdateState(
				ctx,
				cdc,
				subjectStore,
				substituteStore,
				substitute,
			)
			require.ErrorContains(t, err, "operational certificate counter")
			require.ErrorContains(t, err, "regressed from 6")

			unchanged, found := getClientState(subjectStore, cdc)
			require.True(t, found)
			require.Equal(t, subject.LatestHeight, unchanged.LatestHeight)
			require.Equal(t, subject.LatestCheckpointOperationalCertificateCounters, unchanged.LatestCheckpointOperationalCertificateCounters)
		})
	}
}

func TestIBCGenesisValidationAcceptsOperationalCertificateState(t *testing.T) {
	clientID := ModuleName + "-0"
	clientState := newProbabilisticTestClientState()
	consensusState := newProbabilisticTestConsensusState("initial-hash")
	genesis := clienttypes.NewGenesisState(
		[]clienttypes.IdentifiedClientState{clienttypes.NewIdentifiedClientState(clientID, clientState)},
		clienttypes.ClientsConsensusStates{clienttypes.NewClientConsensusStates(
			clientID,
			[]clienttypes.ConsensusStateWithHeight{
				clienttypes.NewConsensusStateWithHeight(clienttypes.NewHeight(0, 10), consensusState),
			},
		)},
		nil,
		clienttypes.DefaultParams(),
		false,
		1,
	)
	require.NoError(t, genesis.Validate())
}

func TestCheckSubstituteAndUpdateStateRejectsCardanoCheckpointRegression(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-rootless-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-behind-substitute")
	subject := newProbabilisticTestClientState()
	subject.LatestHeight = NewHeight(0, 10)
	setTestCheckpoint(t, subject, NewHeight(0, 100), "checkpoint-100", 7, 100)
	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)

	err := subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute)
	require.ErrorContains(t, err, "substitute Cardano checkpoint")
	require.ErrorContains(t, err, "must be newer than subject checkpoint")
}

func TestRecoveryFromLegacyRootBearingSubstitutePersistsTemporalCursor(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-legacy-recovery-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-legacy-recovery-substitute")

	subject := newProbabilisticTestClientState()
	setTestCheckpoint(t, subject, subject.LatestHeight, "subject-10", 7, 10)
	setClientState(subjectStore, cdc, subject)

	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	substitute.LatestCheckpointHeight = NewHeight(0, 20)
	substitute.LatestCheckpointBlockHash = "hash-20"
	substitute.LatestCheckpointEpoch = 7
	substitute.LatestCheckpointSlot = 0
	substitute.LatestCheckpointTimestamp = 0
	substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)
	setClientState(substituteStore, cdc, substitute)

	expectedTimestamp, err := substitute.DeriveTimestampFromSlot(20)
	require.NoError(t, err)
	consensusState := newProbabilisticTestConsensusState("hash-20")
	consensusState.Timestamp = expectedTimestamp
	setConsensusState(substituteStore, cdc, consensusState, substitute.LatestHeight)
	setConsensusMetadataWithValues(substituteStore, substitute.LatestHeight, clienttypes.NewHeight(0, 50), 123456789)

	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute))
	recovered, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(20), recovered.LatestCheckpointSlot)
	require.Equal(t, expectedTimestamp, recovered.LatestCheckpointTimestamp)
	require.NotZero(t, recovered.LatestCheckpointSlot)
	require.NotZero(t, recovered.LatestCheckpointTimestamp)
}

func TestRecoveryFromRootlessSubstituteStartsCounterHistoryAtCheckpoint(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-rootless-recovery-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-rootless-recovery-substitute")
	subject := newProbabilisticTestClientState()
	setTestCheckpoint(t, subject, subject.LatestHeight, "subject-10", 7, 10)
	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	setTestCheckpoint(t, substitute, NewHeight(0, 30), "checkpoint-30", 7, 30)
	substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)
	poolID := bytes.Repeat([]byte{0x2b}, 28)
	substitute.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolID, SequenceNumber: 6},
	}
	consensusState := newProbabilisticTestConsensusState("root-20")
	setConsensusState(substituteStore, cdc, consensusState, substitute.LatestHeight)
	setConsensusMetadataWithValues(substituteStore, substitute.LatestHeight, clienttypes.NewHeight(0, 50), 123456789)

	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute))
	recovered, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(30), recovered.OperationalCertificateCounterHistoryStartHeight.RevisionHeight)
	latestTrusted, err := recovered.latestTrustedBlockState(subjectStore, cdc)
	require.NoError(t, err)
	require.Equal(t, uint64(30), latestTrusted.height.RevisionHeight)
	require.Equal(t, uint64(6), latestTrusted.operationalCertificateCounters[hex.EncodeToString(poolID)])

	_, err = recovered.trustedBlockStateAtHeight(subjectStore, cdc, NewHeight(0, 20))
	require.ErrorContains(t, err, "operational certificate counter history is unavailable")
	retainedRoot, found := GetConsensusState(subjectStore, cdc, NewHeight(0, 20))
	require.True(t, found)
	require.Equal(t, consensusState.IbcStateRoot, retainedRoot.IbcStateRoot)
}

func TestCheckSubstituteAndUpdateStateReplacesOperationalCertificateState(t *testing.T) {
	cdc := newProbabilisticTestCodec()
	ctx, subjectStore := newProbabilisticTestClientStore(t, "probabilistic-recovery-subject")
	_, substituteStore := newProbabilisticTestClientStore(t, "probabilistic-recovery-substitute")

	poolID := bytes.Repeat([]byte{0x2b}, 28)
	subject := newProbabilisticTestClientState()
	require.NoError(t, subject.persistOperationalCertificateCounterSnapshot(
		subjectStore,
		NewHeight(0, 11),
		[]*OperationalCertificateCounter{{PoolId: poolID, SequenceNumber: 4}},
	))
	setTestCheckpoint(t, subject, NewHeight(0, 11), "subject-checkpoint-11", 7, 11)
	setClientState(subjectStore, cdc, subject)
	require.NotEmpty(t, subjectStore.Get(operationalCertificateCounterHistoryKey(NewHeight(0, 11))))

	substitute := newProbabilisticTestClientState()
	substitute.LatestHeight = NewHeight(0, 20)
	setTestCheckpoint(t, substitute, substitute.LatestHeight, "hash-20", 7, 20)
	substitute.OperationalCertificateCounterHistoryStartHeight = NewHeight(0, 20)
	substitute.LatestCheckpointOperationalCertificateCounters = []*OperationalCertificateCounter{
		{PoolId: poolID, SequenceNumber: 6},
	}
	setClientState(substituteStore, cdc, substitute)
	consensusState := newProbabilisticTestConsensusState("hash-20")
	consensusTimestamp, timestampErr := substitute.DeriveTimestampFromSlot(20)
	require.NoError(t, timestampErr)
	consensusState.Timestamp = consensusTimestamp
	setConsensusState(substituteStore, cdc, consensusState, substitute.LatestHeight)
	setConsensusMetadataWithValues(substituteStore, substitute.LatestHeight, clienttypes.NewHeight(0, 50), 123456789)

	require.NoError(t, subject.CheckSubstituteAndUpdateState(ctx, cdc, subjectStore, substituteStore, substitute))
	recovered, found := getClientState(subjectStore, cdc)
	require.True(t, found)
	require.Equal(t, uint64(62), recovered.MaxKesEvolutions)
	require.Equal(t, uint64(20), recovered.OperationalCertificateCounterHistoryStartHeight.RevisionHeight)
	require.Equal(t, substitute.LatestCheckpointOperationalCertificateCounters, recovered.LatestCheckpointOperationalCertificateCounters)
	require.Empty(t, subjectStore.Get(operationalCertificateCounterHistoryKey(NewHeight(0, 11))))
	counters, err := recovered.operationalCertificateCounterMapAtHeight(subjectStore, recovered.LatestCheckpointHeight)
	require.NoError(t, err)
	require.ErrorContains(t, advanceOperationalCertificateCounter(counters, poolID, 5), "older than authenticated counter 6")
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
