package stability

import "fmt"

const (
	ModuleName                     = "08-cardano-stability"
	KeyStabilityScorePrefix        = "stabilityScore"
	KeyUniquePoolsPrefix           = "uniquePools"
	KeyUniqueStakePrefix           = "uniqueStake"
	KeyAcceptedBlockHashPrefix     = "acceptedBlockHash"
)

func StabilityScoreKey(height uint64) []byte {
	return []byte(fmt.Sprintf("%s/%d", KeyStabilityScorePrefix, height))
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
