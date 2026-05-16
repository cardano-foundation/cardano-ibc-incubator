package probabilistic

import "fmt"

const (
	ModuleName                  = "08-cardano-probabilistic"
	KeyProbabilisticScorePrefix = "probabilisticScore"
	KeyUniquePoolsPrefix        = "uniquePools"
	KeyUniqueStakePrefix        = "uniqueStake"
	KeyAcceptedBlockHashPrefix  = "acceptedBlockHash"
)

func ProbabilisticScoreKey(height uint64) []byte {
	return []byte(fmt.Sprintf("%s/%d", KeyProbabilisticScorePrefix, height))
}

func UniquePoolsKey(height uint64) []byte {
	return []byte(fmt.Sprintf("%s/%d", KeyUniquePoolsPrefix, height))
}

func UniqueStakeKey(height uint64) []byte {
	return []byte(fmt.Sprintf("%s/%d", KeyUniqueStakePrefix, height))
}

func AcceptedBlockHashKey(height uint64) []byte {
	return []byte(fmt.Sprintf("%s/%d", KeyAcceptedBlockHashPrefix, height))
}
