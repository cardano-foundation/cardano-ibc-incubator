package keeper

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	"entrypoint/x/vesseloracle/types"

	errorsmod "cosmossdk.io/errors"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
)

func (k msgServer) consolidateDeparturePort(vesselData []types.Vessel) (depport *string, score int, err error) {
	if vesselData == nil || len(vesselData) == 0 {
		return nil, 0, fmt.Errorf("Cannot determine consolidated departure port for empty vessel set.")
	}

	var portMap map[string]int
	portMap = make(map[string]int)

	for _, vessel := range vesselData {
		portMap[vessel.Depport] = portMap[vessel.Depport] + 1
	}

	maxPort := ""
	maxCount := 0
	for port, count := range portMap {
		if count > maxCount {
			maxPort = port
			maxCount = count
		}
	}

	score = (100 * maxCount) / len(vesselData)

	return &maxPort, score, nil
}

func (k msgServer) consolidateEta(vesselData []types.Vessel) (etaMeanCleaned uint64, etaStdCleaned uint64, etaMeanAll uint64, etaStdAll uint64, numOutliers int32, err error) {
	if vesselData == nil || len(vesselData) == 0 {
		return 0, 0, 0, 0, 0, fmt.Errorf("Cannot determine eta for empty vessel set.")
	}

	var samples uint64 = uint64(len(vesselData))

	etaMeanAll = 0
	for _, vessel := range vesselData {
		etaMeanAll = etaMeanAll + (vessel.Eta / samples)
	}

	etaStdAll = 0
	for _, vessel := range vesselData {
		etaStdAll = uint64((int64(vessel.Eta) - int64(etaMeanAll)) * (int64(vessel.Eta) - int64(etaMeanAll)))
	}
	etaStdAll = uint64(math.Sqrt(float64(etaStdAll / samples)))

	// determine outlier interval as 1 sigma environment
	oneSigmaMin := etaMeanAll - etaStdAll
	oneSigmaMax := etaMeanAll + etaStdAll
	twoSigmaMin := etaMeanAll - 2*etaStdAll
	twoSigmaMax := etaMeanAll + 2*etaStdAll

	etaMeanAllUtc := time.Unix(int64(etaMeanAll), 0).UTC()
	oneSigmaMinUtc := time.Unix(int64(oneSigmaMin), 0).UTC()
	oneSigmaMaxUtc := time.Unix(int64(oneSigmaMax), 0).UTC()
	twoSigmaMinUtc := time.Unix(int64(twoSigmaMin), 0).UTC()
	twoSigmaMaxUtc := time.Unix(int64(twoSigmaMax), 0).UTC()

	k.Logger().Info("Eta environment ALL UTC", "mean", etaMeanAllUtc, "oneSigmaMin", oneSigmaMinUtc, "oneSigmaMax", oneSigmaMaxUtc, "twoSigmaMin", twoSigmaMinUtc, "twoSigmaMax", twoSigmaMaxUtc)
	k.Logger().Info("Eta environment ALL EPOCH", "mean", etaMeanAll, "sigma", etaStdAll)

	// determine the median to account for outliers and skewed mean value
	orderedVesselData := make([]types.Vessel, len(vesselData))
	copy(orderedVesselData, vesselData)
	sort.Slice(orderedVesselData, func(i, j int) bool {
		return orderedVesselData[i].Eta < orderedVesselData[j].Eta
	})
	etaMedianAll := orderedVesselData[len(orderedVesselData)/2].Eta
	oneSigmaMedianMin := etaMedianAll - etaStdAll
	oneSigmaMedianMax := etaMedianAll + etaStdAll
	etaMedianAllUtc := time.Unix(int64(etaMedianAll), 0).UTC()
	oneSigmaMedianMinUtc := time.Unix(int64(oneSigmaMedianMin), 0).UTC()
	oneSigmaMedianMaxUtc := time.Unix(int64(oneSigmaMedianMax), 0).UTC()
	k.Logger().Info("Median environment ALL", "median", etaMedianAllUtc, "min", oneSigmaMedianMinUtc, "max", oneSigmaMedianMaxUtc)

	numOutliers = 0
	etaMeanCleaned = 0
	for _, vessel := range vesselData {
		if vessel.Eta >= oneSigmaMedianMin && vessel.Eta <= oneSigmaMedianMax {
			etaMeanCleaned = etaMeanCleaned + vessel.Eta
		} else {
			numOutliers++
		}
	}

	if uint64(numOutliers) < samples {
		etaMeanCleaned = etaMeanCleaned / (samples - uint64(numOutliers))

		etaStdCleaned = 0
		for _, vessel := range vesselData {
			if vessel.Eta >= oneSigmaMedianMin && vessel.Eta <= oneSigmaMedianMax {
				etaStdCleaned = uint64((int64(vessel.Eta) - int64(etaMeanCleaned)) * (int64(vessel.Eta) - int64(etaMeanCleaned)))
			}
		}
		etaStdCleaned = uint64(math.Sqrt(float64(etaStdCleaned / (samples - uint64(numOutliers)))))

		oneSigmaMinCleaned := etaMeanCleaned - etaStdCleaned
		oneSigmaMaxCleaned := etaMeanCleaned + etaStdCleaned
		twoSigmaMinCleaned := etaMeanCleaned - 2*etaStdCleaned
		twoSigmaMaxCleaned := etaMeanCleaned + 2*etaStdCleaned

		etaMeanCleanedUtc := time.Unix(int64(etaMeanCleaned), 0).UTC()
		oneSigmaMinCleanedUtc := time.Unix(int64(oneSigmaMinCleaned), 0).UTC()
		oneSigmaMaxCleanedUtc := time.Unix(int64(oneSigmaMaxCleaned), 0).UTC()
		twoSigmaMinCleanedUtc := time.Unix(int64(twoSigmaMinCleaned), 0).UTC()
		twoSigmaMaxCleanedUtc := time.Unix(int64(twoSigmaMaxCleaned), 0).UTC()

		k.Logger().Info("Eta environment CLEANED UTC", "mean", etaMeanCleanedUtc, "oneSigmaMin", oneSigmaMinCleanedUtc, "oneSigmaMax", oneSigmaMaxCleanedUtc, "twoSigmaMin", twoSigmaMinCleanedUtc, "twoSigmaMax", twoSigmaMaxCleanedUtc)
		k.Logger().Info("Eta environment CLEANED EPOCH", "mean", etaMeanCleaned, "sigma", etaStdCleaned)
	}

	return etaMeanCleaned, etaStdCleaned, etaMeanAll, etaStdAll, numOutliers, nil
}

func (k msgServer) ConsolidateVesselData(ctx sdk.Context, imo string) (*types.ConsolidatedDataReport, error) {
	k.Logger().Info("Calling ConsolidateVesselData")
	vesselData := k.GetVesselsInWindow(ctx, imo, k.GetConsolidationWindowIntervalWidth(ctx), k.GetConsolidationWindowMaxItemCount(ctx))
	if vesselData != nil && len(vesselData) >= int(k.GetConsolidationWindowMinItemCount(ctx)) {
		departurePort, departurePortScore, err := k.consolidateDeparturePort(vesselData)
		if err != nil {
			return nil, errorsmod.Wrap(sdkerrors.ErrLogic, fmt.Sprintf("Unable to consolidate departure port. %v", err))
		}

		etaMeanCleaned, etaStdCleaned, etaMeanAll, etaStdAll, numOutliers, err := k.consolidateEta(vesselData)
		if err != nil {
			return nil, errorsmod.Wrap(sdkerrors.ErrLogic, fmt.Sprintf("Unable to consolidate eta. %v", err))
		}

		var consolidateDataReport = types.ConsolidatedDataReport{
			Imo:            imo,
			Ts:             uint64(time.Now().Unix()),
			TotalSamples:   int32(len(vesselData)),
			EtaOutliers:    numOutliers,
			EtaMeanCleaned: etaMeanCleaned,
			EtaStdCleaned:  etaStdCleaned,
			EtaMeanAll:     etaMeanAll,
			EtaStdAll:      etaStdAll,
			Depport:        *departurePort,
			DepportScore:   int32(departurePortScore),
		}
		k.Logger().Info("Consolidated Data Report generated", "report", consolidateDataReport)
		return &consolidateDataReport, nil
	}

	return nil, errorsmod.Wrap(sdkerrors.ErrLogic, fmt.Sprint("Unable to consolidate.", vesselData))
}

func (k msgServer) ConsolidateReports(goCtx context.Context, msg *types.MsgConsolidateReports) (*types.MsgConsolidateReportsResponse, error) {
	ctx := sdk.UnwrapSDKContext(goCtx)

	consolidatedReport, err := k.ConsolidateVesselData(ctx, msg.Imo)
	if err != nil {
		return nil, err
	}

	k.SetConsolidatedDataReport(ctx, *consolidatedReport)

	return &types.MsgConsolidateReportsResponse{
		Imo: consolidatedReport.Imo,
		Ts:  consolidatedReport.Ts,
	}, nil
}
