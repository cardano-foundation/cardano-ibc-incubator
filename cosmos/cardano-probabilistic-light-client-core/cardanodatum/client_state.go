package cardanodatum

import commitmentcodec "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/commitmentcodec"

// Retain the public datum helpers while the commitment contract lives in one package.
type TendermintClientStateValue = commitmentcodec.TendermintClientStateValue

func DecodeNullaryConstructor(value any, maximum uint64) (uint64, error) {
	return commitmentcodec.DecodeNullaryConstructor(value, maximum)
}
