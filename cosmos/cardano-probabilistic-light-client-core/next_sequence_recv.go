package probabilisticcore

import codec "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/commitmentcodec"

// Cardano commits a CBOR integer while ibc-go expects an eight-byte counter.
func VerifyNextSequenceRecvValue(committedValue, expectedValue []byte) error {
	return codec.CompareNextSequenceRecv(committedValue, expectedValue)
}
