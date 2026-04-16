package keeper

import (
	"testing"

	"cosmossdk.io/log"
	"entrypoint/x/vesseloracle/types"
)

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
