package cardano_test

import (
	"github.com/blinklabs-io/gouroboros/ledger"
	"reflect"
	"testing"

	cardano "sidechain/x/clients/cardano"

	"github.com/stretchr/testify/require"
)

func TestMarshalInterface(t *testing.T) {
	i := []ledger.RegisCert{
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
	i := []ledger.RegisCert{
		{
			Flag:         1,
			RegisPoolId:  "RegisPoolId",
			RegisPoolVrf: "RegisPoolVrf",
		},
	}
	iBytes, _ := cardano.MarshalInterface(i)
	var o []ledger.RegisCert
	cardano.UnmarshalInterface(iBytes, &o)
	require.Equal(t, true, reflect.DeepEqual(i, o), "TestUnmarshalInterface: Not equal")
}

func TestMarshalUnmarshalUTXO(t *testing.T) {
	utxo := ledger.UTXOOutput{
		TxHash:      "dummyTxHash",
		OutputIndex: "1",
		Tokens: []ledger.UTXOOutputToken{{
			TokenAssetName: "lovelace",
			TokenValue:     "1",
		}},
		DatumHex: "",
	}
	iBytes := cardano.MustMarshalUTXO(utxo)
	output := cardano.MustUnmarshalUTXO(iBytes)
	require.Equal(t, true, reflect.DeepEqual(utxo, output), "TestMarshalUnmarshalUTXO: Not equal")
}
