package vesseloracle_test

import (
	"testing"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/keeper"
	vesselmodule "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/module"
	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/vesseloracle-v10/x/vesseloracle/types"
)

func TestPublicIntegrationSurface(t *testing.T) {
	var _ = keeper.NewKeeper
	var _ = vesselmodule.NewAppModule

	if types.ModuleName != "vesseloracle" {
		t.Fatalf("unexpected module name: %s", types.ModuleName)
	}
	if types.QueryConsolidatedDataReportPath != "/vesseloracle.vesseloracle.Query/ConsolidatedDataReport" {
		t.Fatalf("unexpected consolidated report query path: %s", types.QueryConsolidatedDataReportPath)
	}
	if types.QueryLatestConsolidatedDataReportPath != "/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport" {
		t.Fatalf("unexpected latest report query path: %s", types.QueryLatestConsolidatedDataReportPath)
	}
}
