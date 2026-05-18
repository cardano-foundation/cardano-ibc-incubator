package probabilistic

import probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"

type HostStateDatum = probabilisticcore.HostStateDatum
type HostState = probabilisticcore.HostState

func ExtractIbcStateRootFromHostStateDatum(datumCbor []byte, expectedNftPolicyId []byte) ([]byte, error) {
	return probabilisticcore.ExtractIbcStateRootFromHostStateDatum(datumCbor, expectedNftPolicyId)
}
