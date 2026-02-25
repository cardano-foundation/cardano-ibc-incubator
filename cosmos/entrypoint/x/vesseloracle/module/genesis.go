package vesseloracle

import (
	sdk "github.com/cosmos/cosmos-sdk/types"

	"entrypoint/x/vesseloracle/keeper"
	"entrypoint/x/vesseloracle/types"
)

// InitGenesis initializes the module's state from a provided genesis state.
func InitGenesis(ctx sdk.Context, k keeper.Keeper, genState types.GenesisState) {
	// this line is used by starport scaffolding # genesis/module/init
	k.SetPort(ctx, genState.PortId)
	// Only try to bind to port if it is not already bound, since we may already own
	// port capability from capability InitGenesis
	if k.ShouldBound(ctx, genState.PortId) {
		// module binds to the port on InitChain
		// and claims the returned capability
		err := k.BindPort(ctx, genState.PortId)
		if err != nil {
			panic("could not claim port capability: " + err.Error())
		}
	}

	// Set all the vessel
	for _, elem := range genState.VesselList {
		k.SetVessel(ctx, elem)
	}
	// Set all the consolidatedDataReport
	for _, elem := range genState.ConsolidatedDataReportList {
		k.SetConsolidatedDataReport(ctx, elem)
	}
	// this line is used by starport scaffolding # genesis/module/init
	if err := k.SetParams(ctx, genState.Params); err != nil {
		panic(err)
	}
}

// ExportGenesis returns the module's exported genesis.
func ExportGenesis(ctx sdk.Context, k keeper.Keeper) *types.GenesisState {
	genesis := types.DefaultGenesis()
	genesis.Params = k.GetParams(ctx)

	genesis.PortId = k.GetPort(ctx)
	genesis.VesselList = k.GetAllVessel(ctx)
	genesis.ConsolidatedDataReportList = k.GetAllConsolidatedDataReport(ctx)
	// this line is used by starport scaffolding # genesis/module/export

	return genesis
}
