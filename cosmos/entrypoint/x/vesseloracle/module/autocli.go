package vesseloracle

import (
	autocliv1 "cosmossdk.io/api/cosmos/autocli/v1"

	modulev1 "entrypoint/api/vesseloracle/vesseloracle"
)

// AutoCLIOptions implements the autocli.HasAutoCLIConfig interface.
func (am AppModule) AutoCLIOptions() *autocliv1.ModuleOptions {
	return &autocliv1.ModuleOptions{
		Query: &autocliv1.ServiceCommandDescriptor{
			Service: modulev1.Query_ServiceDesc.ServiceName,
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "Params",
					Use:       "params",
					Short:     "Shows the parameters of the module",
				},
				{
					RpcMethod: "VesselAll",
					Use:       "list-vessel",
					Short:     "List all vessel",
				},
				{
					RpcMethod:      "Vessel",
					Use:            "show-vessel [id]",
					Short:          "Shows a vessel",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}},
				},
				{
					RpcMethod: "ConsolidatedDataReportAll",
					Use:       "list-consolidated-data-report",
					Short:     "List all consolidated-data-report",
				},
				{
					RpcMethod:      "ConsolidatedDataReport",
					Use:            "show-consolidated-data-report [id]",
					Short:          "Shows a consolidated-data-report",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}},
				},
				// this line is used by ignite scaffolding # autocli/query
			},
		},
		Tx: &autocliv1.ServiceCommandDescriptor{
			Service:              modulev1.Msg_ServiceDesc.ServiceName,
			EnhanceCustomCommand: true, // only required if you want to use the custom command
			RpcCommandOptions: []*autocliv1.RpcCommandOptions{
				{
					RpcMethod: "UpdateParams",
					Skip:      true, // skipped because authority gated
				},
				{
					RpcMethod:      "CreateVessel",
					Use:            "create-vessel [imo] [ts] [lat] [lon] [speed] [course] [heading] [adt] [eta] [name] [destport] [depport] [mmsi]",
					Short:          "Create a new vessel",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}, {ProtoField: "lat"}, {ProtoField: "lon"}, {ProtoField: "speed"}, {ProtoField: "course"}, {ProtoField: "heading"}, {ProtoField: "adt"}, {ProtoField: "eta"}, {ProtoField: "name"}, {ProtoField: "destport"}, {ProtoField: "depport"}, {ProtoField: "mmsi"}},
				},
				{
					RpcMethod:      "UpdateVessel",
					Use:            "update-vessel [imo] [ts] [lat] [lon] [speed] [course] [heading] [adt] [eta] [name] [destport] [depport] [mmsi]",
					Short:          "Update vessel",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}, {ProtoField: "lat"}, {ProtoField: "lon"}, {ProtoField: "speed"}, {ProtoField: "course"}, {ProtoField: "heading"}, {ProtoField: "adt"}, {ProtoField: "eta"}, {ProtoField: "name"}, {ProtoField: "destport"}, {ProtoField: "depport"}, {ProtoField: "mmsi"}},
				},
				{
					RpcMethod:      "DeleteVessel",
					Use:            "delete-vessel [imo] [ts]",
					Short:          "Delete vessel",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}},
				},
				{
					RpcMethod:      "ConsolidateReports",
					Use:            "consolidate-reports [imo]",
					Short:          "Send a consolidate-reports tx",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}},
				},
				{
					RpcMethod:      "CreateConsolidatedDataReport",
					Use:            "create-consolidated-data-report [imo] [ts] [totalSamples] [etaOutliers] [etaMeanCleaned] [etaMeanAll] [etaStdCleaned] [etaStdAll] [depportScore] [depport]",
					Short:          "Create a new consolidated-data-report",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}, {ProtoField: "totalSamples"}, {ProtoField: "etaOutliers"}, {ProtoField: "etaMeanCleaned"}, {ProtoField: "etaMeanAll"}, {ProtoField: "etaStdCleaned"}, {ProtoField: "etaStdAll"}, {ProtoField: "depportScore"}, {ProtoField: "depport"}},
				},
				{
					RpcMethod:      "UpdateConsolidatedDataReport",
					Use:            "update-consolidated-data-report [imo] [ts] [totalSamples] [etaOutliers] [etaMeanCleaned] [etaMeanAll] [etaStdCleaned] [etaStdAll] [depportScore] [depport]",
					Short:          "Update consolidated-data-report",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}, {ProtoField: "totalSamples"}, {ProtoField: "etaOutliers"}, {ProtoField: "etaMeanCleaned"}, {ProtoField: "etaMeanAll"}, {ProtoField: "etaStdCleaned"}, {ProtoField: "etaStdAll"}, {ProtoField: "depportScore"}, {ProtoField: "depport"}},
				},
				{
					RpcMethod:      "DeleteConsolidatedDataReport",
					Use:            "delete-consolidated-data-report [imo] [ts]",
					Short:          "Delete consolidated-data-report",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}},
				},
				{
					RpcMethod:      "TransmitReport",
					Use:            "transmit-report [imo] [ts]",
					Short:          "Send a transmit-report tx",
					PositionalArgs: []*autocliv1.PositionalArgDescriptor{{ProtoField: "imo"}, {ProtoField: "ts"}},
				},
				// this line is used by ignite scaffolding # autocli/tx
			},
		},
	}
}
