package probabilistic

import (
	storetypes "cosmossdk.io/store/types"
	"encoding/json"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	abci "github.com/cometbft/cometbft/abci/types"
	sdk "github.com/cosmos/cosmos-sdk/types"

	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/spf13/cobra"

	"cosmossdk.io/core/appmodule"

	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/types/module"
)

var (
	_ module.AppModuleBasic = (*AppModuleBasic)(nil)
	_ appmodule.AppModule   = (*AppModule)(nil)
)

type AppModuleBasic struct{}

func (AppModuleBasic) IsOnePerModuleType()                         {}
func (AppModuleBasic) IsAppModule()                                {}
func (AppModuleBasic) Name() string                                { return ModuleName }
func (AppModule) IsOnePerModuleType()                              {}
func (AppModule) IsAppModule()                                     {}
func (AppModuleBasic) RegisterLegacyAminoCodec(*codec.LegacyAmino) {}
func (AppModuleBasic) RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	RegisterInterfaces(registry)
}
func (AppModuleBasic) DefaultGenesis(cdc codec.JSONCodec) json.RawMessage {
	return json.RawMessage(`{"objects":[]}`)
}
func (AppModuleBasic) ValidateGenesis(cdc codec.JSONCodec, config client.TxEncodingConfig, bz json.RawMessage) error {
	return state.ValidateSnapshotGenesis(bz)
}
func (AppModuleBasic) RegisterGRPCGatewayRoutes(clientCtx client.Context, mux *runtime.ServeMux) {}
func (AppModuleBasic) GetTxCmd() *cobra.Command                                                  { return nil }
func (AppModuleBasic) GetQueryCmd() *cobra.Command                                               { return nil }

type AppModule struct {
	AppModuleBasic
	cdc               codec.BinaryCodec
	provider          SnapshotStoreProvider
	lightClientModule LightClientModule
}

func NewAppModule(lightClientModule LightClientModule) AppModule {
	return AppModule{lightClientModule: lightClientModule, cdc: lightClientModule.cdc, provider: lightClientModule.storeProvider}
}

// WithStorage wires destination queries and permissionless maintenance. The
// application must mount SharedStoreKey in its commit multistore.
func (m AppModule) WithStorage(cdc codec.BinaryCodec, provider SnapshotStoreProvider) AppModule {
	m.cdc = cdc
	m.provider = provider
	return m
}
func (m AppModule) RegisterServices(configurator module.Configurator) {
	if m.cdc == nil || m.provider == nil {
		return
	}
	server := storageServer{m.cdc, m.provider}
	RegisterQueryServer(configurator.QueryServer(), server)
	RegisterMsgServer(configurator.MsgServer(), server)
}
func (m AppModule) InitGenesis(ctx sdk.Context, cdc codec.JSONCodec, bz json.RawMessage) []abci.ValidatorUpdate {
	if len(bz) == 0 {
		return nil
	}
	if err := state.ImportSnapshotGenesis(ctx.KVStore(SharedStoreKey), bz); err != nil {
		panic(err)
	}
	return nil
}
func (m AppModule) ExportGenesis(ctx sdk.Context, cdc codec.JSONCodec) json.RawMessage {
	raw, err := state.ExportSnapshotGenesis(ctx.KVStore(SharedStoreKey))
	if err != nil {
		panic(err)
	}
	return raw
}
func (AppModule) ConsensusVersion() uint64 { return 2 }

var SharedStoreKey = storetypes.NewKVStoreKey(ModuleName)
