package cardano_test

import (
	"reflect"
	"testing"

	cardano "sidechain/x/clients/cardano"

	"github.com/stretchr/testify/require"
)

func TestMarshalInterface(t *testing.T) {
	i := []cardano.RegisCert{
		{
			Flag:         1,
			RegisPoolId:  "RegisPoolId",
			RegisPoolVrf: "RegisPoolVrf",
		},
	}
	_, err := cardano.MarshalInterface(i)
	require.NoError(t, err, "TestMarshalInterface: Should not thrown error")
}

func TestUnmarshalInterface(t *testing.T) {
	i := []cardano.RegisCert{
		{
			Flag:         1,
			RegisPoolId:  "RegisPoolId",
			RegisPoolVrf: "RegisPoolVrf",
		},
	}
	iBytes, _ := cardano.MarshalInterface(i)
	var o []cardano.RegisCert
	cardano.UnmarshalInterface(iBytes, &o)
	require.Equal(t, true, reflect.DeepEqual(i, o), "TestUnmarshalInterface: Not equal")
}

func TestMarshalUnmarshalUTXO(t *testing.T) {
	utxo := cardano.UTXOOutput{
		TxHash:      "dummyTxHash",
		OutputIndex: "1",
		Tokens: []cardano.UTXOOutputToken{{
			TokenAssetName: "lovelace",
			TokenValue:     "1",
		}},
		DatumHex: "",
	}
	iBytes := cardano.MustMarshalUTXO(utxo)
	output := cardano.MustUnmarshalUTXO(iBytes)
	require.Equal(t, true, reflect.DeepEqual(utxo, output), "TestMarshalUnmarshalUTXO: Not equal")
}
