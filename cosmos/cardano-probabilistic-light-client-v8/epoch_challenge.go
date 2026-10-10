package probabilistic

import (
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

const EpochContextChallengePeriod = state.EpochContextChallengePeriod

func (cs ClientState) epochChallenge(epoch uint64) *EpochContextChallenge {
	for _, challenge := range cs.EpochContextChallenges {
		if challenge != nil && challenge.Epoch == epoch {
			return challenge
		}
	}
	return nil
}
func (cs ClientState) verifyEpochUsable(ctx sdk.Context, epoch uint64) error {
	return adapterError(toCoreClientState(&cs).VerifyEpochUsable(coreContext(ctx), epoch))
}
