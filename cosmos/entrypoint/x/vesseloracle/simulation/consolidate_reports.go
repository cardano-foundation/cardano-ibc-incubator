package simulation

import (
	"math/rand"

	"entrypoint/x/vesseloracle/keeper"
	"entrypoint/x/vesseloracle/types"

	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	simtypes "github.com/cosmos/cosmos-sdk/types/simulation"
)

func SimulateMsgConsolidateReports(
	ak types.AccountKeeper,
	bk types.BankKeeper,
	k keeper.Keeper,
) simtypes.Operation {
	return func(r *rand.Rand, app *baseapp.BaseApp, ctx sdk.Context, accs []simtypes.Account, chainID string,
	) (simtypes.OperationMsg, []simtypes.FutureOperation, error) {
		simAccount, _ := simtypes.RandomAcc(r, accs)
		msg := &types.MsgConsolidateReports{
			Creator: simAccount.Address.String(),
		}

		// TODO: Handling the ConsolidateReports simulation

		return simtypes.NoOpMsg(types.ModuleName, sdk.MsgTypeURL(msg), "ConsolidateReports simulation not implemented"), nil, nil
	}
}
