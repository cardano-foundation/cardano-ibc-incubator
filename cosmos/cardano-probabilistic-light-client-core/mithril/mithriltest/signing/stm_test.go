package signing

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAggregationChoosesCompressedSignatureOrder(t *testing.T) {
	params := &StmParameters{K: 1, M: 1, PhiF: 1}
	registration := &KeyReg{Keys: map[*VerificationKey]Stake{}}
	initializers := make([]*StmInitializer, 2)
	for index := range initializers {
		initializer, err := new(StmInitializer).Setup(params, 100)
		require.NoError(t, err)
		registration.Keys[initializer.Pk] = initializer.Stake
		initializers[index] = initializer
	}
	closed, err := registration.Close()
	require.NoError(t, err)
	clerk := FromRegistration(params, closed)
	message := []byte("local aggregation order")
	var signatures []*StmSig
	for _, initializer := range initializers {
		signer, err := initializer.NewSigner(closed)
		require.NoError(t, err)
		signature, err := signer.Sign(message)
		require.NoError(t, err)
		require.NotNil(t, signature)
		signatures = append(signatures, signature)
	}
	winner := signatures[0]
	if bytes.Compare(signatures[1].Sigma.ToBytes(), winner.Sigma.ToBytes()) < 0 {
		winner = signatures[1]
	}
	for _, ordered := range [][]*StmSig{signatures, {signatures[1], signatures[0]}} {
		aggregate, err := clerk.Aggregate(ordered, message)
		require.NoError(t, err)
		require.Len(t, aggregate.Signatures, 1)
		require.Equal(t, winner.Sigma.ToBytes(), aggregate.Signatures[0].Sig.Sigma.ToBytes())
		require.NoError(t, aggregate.Verify(message, clerk.ComputeAVK(), params))
	}
}
