package simulation

import (
	"math/rand"
	"strconv"

	"entrypoint/x/vesseloracle/keeper"
	"entrypoint/x/vesseloracle/types"

	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	moduletestutil "github.com/cosmos/cosmos-sdk/types/module/testutil"
	simtypes "github.com/cosmos/cosmos-sdk/types/simulation"
	"github.com/cosmos/cosmos-sdk/x/simulation"
)

// Prevent strconv unused error
var _ = strconv.IntSize

func SimulateMsgCreateConsolidatedDataReport(
	ak types.AccountKeeper,
	bk types.BankKeeper,
	k keeper.Keeper,
) simtypes.Operation {
	return func(r *rand.Rand, app *baseapp.BaseApp, ctx sdk.Context, accs []simtypes.Account, chainID string,
	) (simtypes.OperationMsg, []simtypes.FutureOperation, error) {
		simAccount, _ := simtypes.RandomAcc(r, accs)

		i := r.Int()
		msg := &types.MsgCreateConsolidatedDataReport{
			Creator: simAccount.Address.String(),
			Imo:     strconv.Itoa(i),
			Ts:      uint64(i),
		}

		_, found := k.GetConsolidatedDataReport(ctx, msg.Imo, msg.Ts)
		if found {
			return simtypes.NoOpMsg(types.ModuleName, sdk.MsgTypeURL(msg), "ConsolidatedDataReport already exist"), nil, nil
		}

		txCtx := simulation.OperationInput{
			R:               r,
			App:             app,
			TxGen:           moduletestutil.MakeTestEncodingConfig().TxConfig,
			Cdc:             nil,
			Msg:             msg,
			Context:         ctx,
			SimAccount:      simAccount,
			ModuleName:      types.ModuleName,
			CoinsSpentInMsg: sdk.NewCoins(),
			AccountKeeper:   ak,
			Bankkeeper:      bk,
		}
		return simulation.GenAndDeliverTxWithRandFees(txCtx)
	}
}

func SimulateMsgUpdateConsolidatedDataReport(
	ak types.AccountKeeper,
	bk types.BankKeeper,
	k keeper.Keeper,
) simtypes.Operation {
	return func(r *rand.Rand, app *baseapp.BaseApp, ctx sdk.Context, accs []simtypes.Account, chainID string,
	) (simtypes.OperationMsg, []simtypes.FutureOperation, error) {
		var (
			simAccount                = simtypes.Account{}
			consolidatedDataReport    = types.ConsolidatedDataReport{}
			msg                       = &types.MsgUpdateConsolidatedDataReport{}
			allConsolidatedDataReport = k.GetAllConsolidatedDataReport(ctx)
			found                     = false
		)
		for _, obj := range allConsolidatedDataReport {
			simAccount, found = FindAccount(accs, obj.Creator)
			if found {
				consolidatedDataReport = obj
				break
			}
		}
		if !found {
			return simtypes.NoOpMsg(types.ModuleName, sdk.MsgTypeURL(msg), "consolidatedDataReport creator not found"), nil, nil
		}
		msg.Creator = simAccount.Address.String()

		msg.Imo = consolidatedDataReport.Imo
		msg.Ts = consolidatedDataReport.Ts

		txCtx := simulation.OperationInput{
			R:               r,
			App:             app,
			TxGen:           moduletestutil.MakeTestEncodingConfig().TxConfig,
			Cdc:             nil,
			Msg:             msg,
			Context:         ctx,
			SimAccount:      simAccount,
			ModuleName:      types.ModuleName,
			CoinsSpentInMsg: sdk.NewCoins(),
			AccountKeeper:   ak,
			Bankkeeper:      bk,
		}
		return simulation.GenAndDeliverTxWithRandFees(txCtx)
	}
}

func SimulateMsgDeleteConsolidatedDataReport(
	ak types.AccountKeeper,
	bk types.BankKeeper,
	k keeper.Keeper,
) simtypes.Operation {
	return func(r *rand.Rand, app *baseapp.BaseApp, ctx sdk.Context, accs []simtypes.Account, chainID string,
	) (simtypes.OperationMsg, []simtypes.FutureOperation, error) {
		var (
			simAccount                = simtypes.Account{}
			consolidatedDataReport    = types.ConsolidatedDataReport{}
			msg                       = &types.MsgUpdateConsolidatedDataReport{}
			allConsolidatedDataReport = k.GetAllConsolidatedDataReport(ctx)
			found                     = false
		)
		for _, obj := range allConsolidatedDataReport {
			simAccount, found = FindAccount(accs, obj.Creator)
			if found {
				consolidatedDataReport = obj
				break
			}
		}
		if !found {
			return simtypes.NoOpMsg(types.ModuleName, sdk.MsgTypeURL(msg), "consolidatedDataReport creator not found"), nil, nil
		}
		msg.Creator = simAccount.Address.String()

		msg.Imo = consolidatedDataReport.Imo
		msg.Ts = consolidatedDataReport.Ts

		txCtx := simulation.OperationInput{
			R:               r,
			App:             app,
			TxGen:           moduletestutil.MakeTestEncodingConfig().TxConfig,
			Cdc:             nil,
			Msg:             msg,
			Context:         ctx,
			SimAccount:      simAccount,
			ModuleName:      types.ModuleName,
			CoinsSpentInMsg: sdk.NewCoins(),
			AccountKeeper:   ak,
			Bankkeeper:      bk,
		}
		return simulation.GenAndDeliverTxWithRandFees(txCtx)
	}
}
