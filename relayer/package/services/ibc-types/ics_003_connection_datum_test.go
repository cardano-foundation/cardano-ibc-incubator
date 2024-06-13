package ibc_types

import (
	"encoding/hex"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDecodeConnectionDatumSchema(t *testing.T) {
	t.Run("Decode Connection Datum Schema Successful", func(t *testing.T) {
		connectionDatumEncoded := "d8799fd8799f4c6962635f636c69656e742d309fd8799f413080ffffd87a80d8799f4b73696465636861696e2d304c636f6e6e656374696f6e2d30d8799f4a6b65795f707265666978ffff00ffd8799f4378797a43616263ffff"

		var connectionDatum ConnectionDatumSchema
		datumBytes, _ := hex.DecodeString(connectionDatumEncoded)
		err := cbor.Unmarshal(datumBytes, &connectionDatum)
		require.Equal(t, nil, err)
		require.Equal(t, "ibc_client-0", string(connectionDatum.State.ClientId))
		require.Equal(t, "connection-0", string(connectionDatum.State.Counterparty.ConnectionId))
	})
}
