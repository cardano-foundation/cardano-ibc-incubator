package probabilistic

import (
	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

// Preparation tools build explicit trusted bootstrap inputs and transport plans.
// These helpers do not authenticate a starting checkpoint or accept a proposal.
// The bootstrap completes only with the Mithril certificate of its stake table.
func BuildBootstrap(store storetypes.KVStore, client *ClientState, consensus *ConsensusState, mithrilCertificate []byte) (*ClientState, *ConsensusState, []*ProbabilisticHeader, error) {
	compact, initial, steps, err := state.BuildBootstrap(store, toCoreClientState(client), toCoreConsensusState(consensus), mithrilCertificate)
	return fromCoreClientState(compact), fromCoreConsensusState(initial), mapCoreSlice(steps, fromCoreProbabilisticHeader), err
}

// AnchorToMithril sets a trusted client's Mithril anchor from an aggregator
// and returns the certificate that completes its bootstrap.
func AnchorToMithril(client *ClientState, aggregator string) ([]byte, error) {
	anchored := toCoreClientState(client)
	certificate, err := state.AnchorToMithril(anchored, aggregator)
	if err != nil {
		return nil, err
	}
	*client = *fromCoreClientState(anchored)
	return certificate, nil
}
func BuildObservationPlan(client *ClientState, header *ProbabilisticHeader, original []byte, priorRows uint64, blocksPerStep int) ([]*ProbabilisticHeader, []byte, error) {
	plan, err := state.BuildObservationPlan(toCoreClientState(client), toCoreProbabilisticHeader(header), original, priorRows, blocksPerStep)
	if err != nil {
		return nil, nil, err
	}
	return mapCoreSlice(plan.Steps, fromCoreProbabilisticHeader), append([]byte(nil), plan.SessionID[:]...), nil
}

// Genesis builders use a completely trusted starting snapshot. Runtime imports
// use BuildBootstrap and verify bounded pages before becoming usable.
func InitializeFromTrustedCheckpoint(ctx sdk.Context, cdc codec.BinaryCodec, store storetypes.KVStore, client *ClientState, consensus *ConsensusState, mithrilCertificate []byte) (*ClientState, *ConsensusState, error) {
	compact, initial, err := state.InitializeFromTrustedCheckpoint(coreContext(ctx), coreCodec{cdc}, store, toCoreClientState(client), toCoreConsensusState(consensus), mithrilCertificate)
	return fromCoreClientState(compact), fromCoreConsensusState(initial), err
}
