package mockmodule_test

import (
	"testing"

	keepertest "sidechain/testutil/keeper"
	"sidechain/testutil/nullify"
	mockmodule "sidechain/x/mockmodule/module"
	"sidechain/x/mockmodule/types"

	"github.com/stretchr/testify/require"
)

func TestGenesis(t *testing.T) {
	genesisState := types.GenesisState{
		Params: types.DefaultParams(),
		PortId: types.PortID,
		// this line is used by starport scaffolding # genesis/test/state
	}

	k, ctx, _ := keepertest.MockmoduleKeeper(t)
	mockmodule.InitGenesis(ctx, k, genesisState)
	got := mockmodule.ExportGenesis(ctx, k)
	require.NotNil(t, got)

	nullify.Fill(&genesisState)
	nullify.Fill(got)

	require.Equal(t, genesisState.PortId, got.PortId)

	// this line is used by starport scaffolding # genesis/test/assert
}
