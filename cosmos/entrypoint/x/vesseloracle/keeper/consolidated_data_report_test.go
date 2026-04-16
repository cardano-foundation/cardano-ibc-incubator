package keeper

import (
	"testing"

	"cosmossdk.io/log"
	"cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"entrypoint/x/vesseloracle/types"
)

func TestGetLatestConsolidatedDataReportByImoUsesKeyOrder(t *testing.T) {
	key := storetypes.NewKVStoreKey(types.StoreKey)
	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())

	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	if err := stateStore.LoadLatestVersion(); err != nil {
		t.Fatalf("load latest version: %v", err)
	}

	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "entrypoint-test",
		Height:  1,
	}, false, log.NewNopLogger())

	keeper := Keeper{
		cdc:          types.ModuleCdc,
		storeService: runtime.NewKVStoreService(key),
		logger:       log.NewNopLogger(),
	}

	keeper.SetConsolidatedDataReport(ctx, types.ConsolidatedDataReport{Imo: "9525338", Ts: 10})
	keeper.SetConsolidatedDataReport(ctx, types.ConsolidatedDataReport{Imo: "9525338", Ts: 30})
	keeper.SetConsolidatedDataReport(ctx, types.ConsolidatedDataReport{Imo: "9525338", Ts: 20})
	keeper.SetConsolidatedDataReport(ctx, types.ConsolidatedDataReport{Imo: "1234567", Ts: 99})

	report, found := keeper.GetLatestConsolidatedDataReportByImo(ctx, "9525338")
	if !found {
		t.Fatal("expected latest consolidated report to be found")
	}

	if report.Imo != "9525338" {
		t.Fatalf("expected IMO 9525338, got %s", report.Imo)
	}

	if report.Ts != 30 {
		t.Fatalf("expected latest timestamp 30, got %d", report.Ts)
	}
}
