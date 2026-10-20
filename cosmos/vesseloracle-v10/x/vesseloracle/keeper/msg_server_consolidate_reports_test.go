package keeper

import (
	"testing"
	"time"

	"cosmossdk.io/log"
	"cosmossdk.io/store"
	"cosmossdk.io/store/metrics"
	storetypes "cosmossdk.io/store/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/types"
)

func TestConsolidateDeparturePortDeterministic(t *testing.T) {
	testCases := []struct {
		name  string
		ports []string
		want  string
		score int
	}{
		{name: "single port", ports: []string{"USNYC"}, want: "USNYC", score: 100},
		{name: "majority beats lexical order", ports: []string{"NLRTM", "USNYC", "USNYC"}, want: "USNYC", score: 66},
		{name: "two way tie", ports: []string{"USNYC", "NLRTM", "USNYC", "NLRTM"}, want: "NLRTM", score: 50},
		{name: "three way tie", ports: []string{"USNYC", "SGSIN", "NLRTM"}, want: "NLRTM", score: 33},
		{name: "empty port in tie", ports: []string{"USNYC", ""}, want: "", score: 50},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			vessels := make([]types.Vessel, len(tc.ports))
			for i, port := range tc.ports {
				vessels[i].Depport = port
			}

			for iteration := 0; iteration < 100; iteration++ {
				port, score, err := (msgServer{}).consolidateDeparturePort(vessels)
				if err != nil {
					t.Fatalf("iteration %d: consolidateDeparturePort returned error: %v", iteration, err)
				}
				if port == nil {
					t.Fatalf("iteration %d: expected port %q, got nil", iteration, tc.want)
				}
				if *port != tc.want || score != tc.score {
					t.Fatalf("iteration %d: expected port %q with score %d, got port %q with score %d", iteration, tc.want, tc.score, *port, score)
				}
			}
		})
	}
}

func TestConsolidateReportsDeterministic(t *testing.T) {
	key := storetypes.NewKVStoreKey(types.StoreKey)
	db := dbm.NewMemDB()
	stateStore := store.NewCommitMultiStore(db, log.NewNopLogger(), metrics.NewNoOpMetrics())
	stateStore.MountStoreWithDB(key, storetypes.StoreTypeIAVL, db)
	if err := stateStore.LoadLatestVersion(); err != nil {
		t.Fatalf("load latest version: %v", err)
	}

	blockTime := time.Date(2024, time.January, 1, 0, 0, 0, 123456789, time.UTC)
	ctx := sdk.NewContext(stateStore, cmtproto.Header{
		ChainID: "vesseloracle-test-0",
		Height:  1,
		Time:    blockTime,
	}, false, log.NewNopLogger())
	server := msgServer{Keeper: Keeper{
		cdc:          types.ModuleCdc,
		storeService: runtime.NewKVStoreService(key),
		logger:       log.NewNopLogger(),
	}}
	if err := server.SetParams(ctx, types.DefaultParams()); err != nil {
		t.Fatalf("set params: %v", err)
	}

	const imo = "9525338"
	eta := uint64(blockTime.Add(24 * time.Hour).Unix())
	for i := 0; i < 8; i++ {
		port := "USNYC"
		if i%2 == 1 {
			port = "NLRTM"
		}
		server.SetVessel(ctx, types.Vessel{
			Imo:     imo,
			Ts:      uint64(blockTime.Unix()) - uint64(i),
			Source:  "test",
			Depport: port,
			Eta:     eta,
		})
	}

	want := types.ConsolidatedDataReport{
		Imo:            imo,
		Ts:             uint64(blockTime.Unix()),
		TotalSamples:   8,
		EtaMeanCleaned: eta,
		EtaMeanAll:     eta,
		Depport:        "NLRTM",
		DepportScore:   50,
	}
	for iteration := 0; iteration < 100; iteration++ {
		// Replay the message against the same initial state each time.
		cachedCtx, _ := ctx.CacheContext()
		response, err := server.ConsolidateReports(sdk.WrapSDKContext(cachedCtx), &types.MsgConsolidateReports{Imo: imo})
		if err != nil {
			t.Fatalf("iteration %d: ConsolidateReports returned error: %v", iteration, err)
		}
		if response.Imo != want.Imo || response.Ts != want.Ts {
			t.Fatalf("iteration %d: unexpected response: %+v", iteration, response)
		}
		report, found := server.GetConsolidatedDataReport(cachedCtx, imo, want.Ts)
		if !found || report != want {
			t.Fatalf("iteration %d: expected stored report %+v, got %+v (found %t)", iteration, want, report, found)
		}
		if reports := server.GetAllConsolidatedDataReport(cachedCtx); len(reports) != 1 {
			t.Fatalf("iteration %d: expected one stored report, got %d", iteration, len(reports))
		}
	}
}

func TestConsolidateEtaAccumulatesVarianceAcrossSamples(t *testing.T) {
	server := msgServer{
		Keeper: Keeper{logger: log.NewNopLogger()},
	}

	vesselData := []types.Vessel{
		{Eta: 10},
		{Eta: 20},
		{Eta: 30},
		{Eta: 40},
	}

	etaMeanCleaned, etaStdCleaned, etaMeanAll, etaStdAll, numOutliers, err := server.consolidateEta(vesselData)
	if err != nil {
		t.Fatalf("consolidateEta returned error: %v", err)
	}

	if etaMeanAll != 25 {
		t.Fatalf("expected all-sample mean 25, got %d", etaMeanAll)
	}

	if etaStdAll != 11 {
		t.Fatalf("expected all-sample std 11, got %d", etaStdAll)
	}

	if numOutliers != 1 {
		t.Fatalf("expected 1 outlier, got %d", numOutliers)
	}

	if etaMeanCleaned != 30 {
		t.Fatalf("expected cleaned mean 30, got %d", etaMeanCleaned)
	}

	if etaStdCleaned != 8 {
		t.Fatalf("expected cleaned std 8, got %d", etaStdCleaned)
	}
}
