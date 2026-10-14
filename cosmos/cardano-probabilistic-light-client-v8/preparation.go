package probabilistic

import (
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

// Preparation tools build explicit trusted bootstrap inputs and transport plans.
// These helpers do not authenticate a starting checkpoint or accept a proposal.
func BuildCompactBootstrap(store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, []*ProbabilisticHeader, error) {
	compact, initial, steps, err := state.BuildCompactBootstrap(store, toCoreClientState(client), toCoreConsensusState(consensus))
	return fromCoreClientState(compact), fromCoreConsensusState(initial), mapCoreSlice(steps, fromCoreProbabilisticHeader), err
}
func BuildObservationPlan(client *ClientState, header *ProbabilisticHeader, original []byte, priorRows uint64, blocksPerStep int) ([]*ProbabilisticHeader, []byte, error) {
	plan, err := state.BuildObservationPlan(toCoreClientState(client), toCoreProbabilisticHeader(header), original, priorRows, blocksPerStep)
	if err != nil {
		return nil, nil, err
	}
	return mapCoreSlice(plan.Steps, fromCoreProbabilisticHeader), append([]byte(nil), plan.SessionID[:]...), nil
}

// Genesis builders use a completely trusted starting snapshot. Runtime imports
// use BuildCompactBootstrap and verify bounded pages before becoming usable.
func EnableSharedSnapshots(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, client *ClientState, consensus *ConsensusState) (*ClientState, *ConsensusState, error) {
	compact, initial, err := state.EnableSharedSnapshots(coreContext(ctx), coreCodec{cdc}, store, toCoreClientState(client), toCoreConsensusState(consensus))
	return fromCoreClientState(compact), fromCoreConsensusState(initial), err
}
