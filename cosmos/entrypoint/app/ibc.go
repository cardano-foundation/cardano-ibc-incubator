package app

import (
	asyncicqmodule "entrypoint/x/asyncicq/module"
	ibcmithril "entrypoint/x/clients/mithril"
	ibcstability "entrypoint/x/clients/stability"

	"cosmossdk.io/core/appmodule"
	storetypes "cosmossdk.io/store/types"
	cdctypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	govtypes "github.com/cosmos/cosmos-sdk/x/gov/types"
	govv1beta1 "github.com/cosmos/cosmos-sdk/x/gov/types/v1beta1"
	paramstypes "github.com/cosmos/cosmos-sdk/x/params/types"
	pfmrouter "github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v10/packetforward"
	pfmrouterkeeper "github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v10/packetforward/keeper"
	pfmroutertypes "github.com/cosmos/ibc-apps/middleware/packet-forward-middleware/v10/packetforward/types"
	icamodule "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts"
	icacontroller "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/controller"
	icacontrollerkeeper "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/controller/keeper"
	icacontrollertypes "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/controller/types"
	icahost "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/host"
	icahostkeeper "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/host/keeper"
	icahosttypes "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/host/types"
	icatypes "github.com/cosmos/ibc-go/v10/modules/apps/27-interchain-accounts/types"
	"github.com/cosmos/ibc-go/v10/modules/apps/transfer"
	ibctransfer "github.com/cosmos/ibc-go/v10/modules/apps/transfer"
	ibctransferkeeper "github.com/cosmos/ibc-go/v10/modules/apps/transfer/keeper"
	ibctransfertypes "github.com/cosmos/ibc-go/v10/modules/apps/transfer/types"
	ibc "github.com/cosmos/ibc-go/v10/modules/core"
	ibcclienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	ibcconnectiontypes "github.com/cosmos/ibc-go/v10/modules/core/03-connection/types"
	porttypes "github.com/cosmos/ibc-go/v10/modules/core/05-port/types"
	ibcexported "github.com/cosmos/ibc-go/v10/modules/core/exported"
	ibckeeper "github.com/cosmos/ibc-go/v10/modules/core/keeper"
	solomachine "github.com/cosmos/ibc-go/v10/modules/light-clients/06-solomachine"
	ibctm "github.com/cosmos/ibc-go/v10/modules/light-clients/07-tendermint"
	// this line is used by starport scaffolding # ibc/app/import
)

const (
	vesseloracleConsolidatedDataReportQueryPath       = "/vesseloracle.vesseloracle.Query/ConsolidatedDataReport"
	vesseloracleLatestConsolidatedDataReportQueryPath = "/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport"
)

// registerIBCModules register IBC keepers and non dependency inject modules.
func (app *App) registerIBCModules() {
	// set up non depinject support modules store keys
	if err := app.RegisterStores(
		storetypes.NewKVStoreKey(ibcexported.StoreKey),
		storetypes.NewKVStoreKey(ibctransfertypes.StoreKey),
		storetypes.NewKVStoreKey(pfmroutertypes.StoreKey),
		storetypes.NewKVStoreKey(icahosttypes.StoreKey),
		storetypes.NewKVStoreKey(icacontrollertypes.StoreKey),
		storetypes.NewTransientStoreKey(paramstypes.TStoreKey),
	); err != nil {
		panic(err)
	}

	// register the key tables for legacy param subspaces
	keyTable := ibcclienttypes.ParamKeyTable()
	keyTable.RegisterParamSet(&ibcconnectiontypes.Params{})
	app.ParamsKeeper.Subspace(ibcexported.ModuleName).WithKeyTable(keyTable)
	app.ParamsKeeper.Subspace(ibctransfertypes.ModuleName).WithKeyTable(ibctransfertypes.ParamKeyTable())
	app.ParamsKeeper.Subspace(icacontrollertypes.SubModuleName).WithKeyTable(icacontrollertypes.ParamKeyTable())
	app.ParamsKeeper.Subspace(icahosttypes.SubModuleName).WithKeyTable(icahosttypes.ParamKeyTable())
	// Packet-forward middleware still accepts a legacy params subspace for
	// migration purposes, but v10 no longer exposes a dedicated ParamKeyTable.
	app.ParamsKeeper.Subspace(pfmroutertypes.ModuleName)

	// The v10 core keeper no longer depends on capability keepers or scoped keepers.
	app.IBCKeeper = ibckeeper.NewKeeper(
		app.appCodec,
		runtime.NewKVStoreService(app.GetKey(ibcexported.StoreKey)),
		app.GetSubspace(ibcexported.ModuleName),
		app.UpgradeKeeper,
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)

	// Register the proposal types
	// Deprecated: Avoid adding new handlers, instead use the new proposal flow
	// by granting the governance module the right to execute the message.
	// See: https://docs.cosmos.network/main/modules/gov#proposal-messages
	govRouter := govv1beta1.NewRouter()
	govRouter.AddRoute(govtypes.RouterKey, govv1beta1.ProposalHandler)

	// Packet-forward middleware still wraps the transfer module in v10, but it now
	// sits directly above core IBC without ibc-fee in the stack.
	app.PFMRouterKeeper = pfmrouterkeeper.NewKeeper(
		app.appCodec,
		runtime.NewKVStoreService(app.GetKey(pfmroutertypes.StoreKey)),
		nil, // Will be zero-value here. Reference is set later on with SetTransferKeeper.
		app.IBCKeeper.ChannelKeeper,
		app.BankKeeper,
		app.IBCKeeper.ChannelKeeper,
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)

	// Create IBC transfer keeper
	app.TransferKeeper = ibctransferkeeper.NewKeeper(
		app.appCodec,
		runtime.NewKVStoreService(app.GetKey(ibctransfertypes.StoreKey)),
		app.GetSubspace(ibctransfertypes.ModuleName),
		app.PFMRouterKeeper,
		app.IBCKeeper.ChannelKeeper,
		app.MsgServiceRouter(),
		app.AccountKeeper,
		app.BankKeeper,
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)

	// Must be called on PFMRouter AFTER TransferKeeper initialized
	app.PFMRouterKeeper.SetTransferKeeper(app.TransferKeeper)

	// Create Transfer Stack (from bottom to top of stack)
	// - core IBC
	// - pfm
	// - transfer
	//
	// This is how transfer stack will work in the end:
	// * RecvPacket -> IBC core -> PFM -> Transfer (AddRoute)
	// * SendPacket -> Transfer -> PFM -> IBC core (ICS4Wrapper)
	var transferStack porttypes.IBCModule
	transferStack = transfer.NewIBCModule(app.TransferKeeper)
	transferStack = pfmrouter.NewIBCMiddleware(
		transferStack,
		app.PFMRouterKeeper,
		0, // retries on timeout
		pfmrouterkeeper.DefaultForwardTransferPacketTimeoutTimestamp,
	)

	// Create interchain account keepers
	app.ICAHostKeeper = icahostkeeper.NewKeeper(
		app.appCodec,
		runtime.NewKVStoreService(app.GetKey(icahosttypes.StoreKey)),
		app.GetSubspace(icahosttypes.SubModuleName),
		app.IBCKeeper.ChannelKeeper,
		app.IBCKeeper.ChannelKeeper,
		app.AccountKeeper,
		app.MsgServiceRouter(),
		app.GRPCQueryRouter(),
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)
	app.ICAControllerKeeper = icacontrollerkeeper.NewKeeper(
		app.appCodec,
		runtime.NewKVStoreService(app.GetKey(icacontrollertypes.StoreKey)),
		app.GetSubspace(icacontrollertypes.SubModuleName),
		app.IBCKeeper.ChannelKeeper,
		app.IBCKeeper.ChannelKeeper,
		app.MsgServiceRouter(),
		authtypes.NewModuleAddress(govtypes.ModuleName).String(),
	)
	app.GovKeeper.SetLegacyRouter(govRouter)

	// integration point for custom authentication modules
	var noAuthzModule porttypes.IBCModule
	icaControllerIBCModule := icacontroller.NewIBCMiddlewareWithAuth(noAuthzModule, app.ICAControllerKeeper)
	icaHostIBCModule := icahost.NewIBCModule(app.ICAHostKeeper)

	// Create static IBC router, add transfer route, then set and seal it
	// Keep the async-ICQ host generic by declaring its query-policy here in app
	// wiring rather than inside the host module package.
	ibcRouter := porttypes.NewRouter().
		AddRoute(ibctransfertypes.ModuleName, transferStack).
		AddRoute(icacontrollertypes.SubModuleName, icaControllerIBCModule).
		AddRoute(icahosttypes.SubModuleName, icaHostIBCModule).
		AddRoute(asyncicqmodule.PortID, asyncicqmodule.NewIBCModule(app.GRPCQueryRouter(), []string{
			vesseloracleConsolidatedDataReportQueryPath,
			vesseloracleLatestConsolidatedDataReportQueryPath,
		}))

	// this line is used by starport scaffolding # ibc/app/module

	app.IBCKeeper.SetRouter(ibcRouter)

	clientKeeper := app.IBCKeeper.ClientKeeper
	storeProvider := clientKeeper.GetStoreProvider()
	tmLightClientModule := ibctm.NewLightClientModule(app.appCodec, storeProvider)
	smLightClientModule := solomachine.NewLightClientModule(app.appCodec, storeProvider)
	mithrilLightClientModule := ibcmithril.NewLightClientModule(app.appCodec, storeProvider)
	stabilityLightClientModule := ibcstability.NewLightClientModule(app.appCodec, storeProvider)

	clientKeeper.AddRoute(ibctm.ModuleName, &tmLightClientModule)
	clientKeeper.AddRoute(solomachine.ModuleName, &smLightClientModule)
	clientKeeper.AddRoute(ibcmithril.ModuleName, &mithrilLightClientModule)
	clientKeeper.AddRoute(ibcstability.ModuleName, &stabilityLightClientModule)

	// register IBC modules
	if err := app.RegisterModules(
		ibc.NewAppModule(app.IBCKeeper),
		ibctransfer.NewAppModule(app.TransferKeeper),
		pfmrouter.NewAppModule(app.PFMRouterKeeper, app.GetSubspace(pfmroutertypes.ModuleName)),
		icamodule.NewAppModule(&app.ICAControllerKeeper, &app.ICAHostKeeper),
		ibctm.NewAppModule(tmLightClientModule),
		ibcmithril.NewAppModule(mithrilLightClientModule),
		ibcstability.NewAppModule(stabilityLightClientModule),
		solomachine.NewAppModule(smLightClientModule),
	); err != nil {
		panic(err)
	}
}

// Since the IBC modules don't support dependency injection, we need to
// manually register the modules on the client side.
// This needs to be removed after IBC supports App Wiring.
func RegisterIBC(registry cdctypes.InterfaceRegistry) map[string]appmodule.AppModule {
	modules := map[string]appmodule.AppModule{
		ibcexported.ModuleName:      ibc.AppModule{},
		ibctransfertypes.ModuleName: ibctransfer.AppModule{},
		pfmroutertypes.ModuleName:   pfmrouter.AppModule{},
		icatypes.ModuleName:         icamodule.AppModule{},
		ibctm.ModuleName:            ibctm.NewAppModule(ibctm.LightClientModule{}),
		ibcmithril.ModuleName:       ibcmithril.NewAppModule(ibcmithril.LightClientModule{}),
		ibcstability.ModuleName:     ibcstability.NewAppModule(ibcstability.LightClientModule{}),
		solomachine.ModuleName:      solomachine.NewAppModule(solomachine.LightClientModule{}),
	}

	for _, module := range modules {
		if mod, ok := module.(interface {
			RegisterInterfaces(registry cdctypes.InterfaceRegistry)
		}); ok {
			mod.RegisterInterfaces(registry)
		}
	}

	return modules
}
