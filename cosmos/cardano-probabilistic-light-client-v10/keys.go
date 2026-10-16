package probabilistic

import state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"

const (
	ModuleName                  = state.ModuleName
	KeyProbabilisticScorePrefix = state.KeyProbabilisticScorePrefix
	KeyUniquePoolsPrefix        = state.KeyUniquePoolsPrefix
	KeyUniqueStakePrefix        = state.KeyUniqueStakePrefix
	KeyAcceptedBlockHashPrefix  = state.KeyAcceptedBlockHashPrefix
)

func ProbabilisticScoreKey(height uint64) []byte { return state.ProbabilisticScoreKey(height) }

func UniquePoolsKey(height uint64) []byte { return state.UniquePoolsKey(height) }

func UniqueStakeKey(height uint64) []byte { return state.UniqueStakeKey(height) }

func AcceptedBlockHashKey(height uint64) []byte { return state.AcceptedBlockHashKey(height) }
