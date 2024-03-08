package cardano_test

import (
	"testing"

	cardano "sidechain/x/clients/cardano"

	"github.com/stretchr/testify/require"
)

func TestGetListReDeregCerts(t *testing.T) {
	blockOutput := cardano.ExtractBlockOutput{
		RegisCerts: []cardano.RegisCert{
			{
				RegisPoolId:  "pool1",
				RegisPoolVrf: "pool1Vrf",
			},
			{
				RegisPoolId:  "pool2",
				RegisPoolVrf: "pool2Vrf",
			},
		},
		DeRegisCerts: []cardano.DeRegisCert{
			{
				DeRegisPoolId: "pool3",
				DeRegisEpoch:  "2",
			},
			{
				DeRegisPoolId: "pool4",
				DeRegisEpoch:  "4",
			},
		},
	}
	regisPoolIds := blockOutput.GetListRegisCertPoolId()
	deregisPoolIds := blockOutput.GetListUnregisCertPoolId()
	require.Equal(t, len(blockOutput.RegisCerts), len(regisPoolIds), "Regis pools not equal")
	require.Equal(t, len(blockOutput.DeRegisCerts), len(deregisPoolIds), "Deregis pools not equal")
}
