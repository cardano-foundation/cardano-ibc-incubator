package probabilistic

import (
	"cosmossdk.io/log"
	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"

	"bytes"
	"encoding/json"
	"testing"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/blinklabs-io/gouroboros/cbor"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cosmos/cosmos-sdk/runtime"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
	"github.com/cosmos/ibc-go/v10/testing/simapp"
	"github.com/stretchr/testify/require"
)

func newBoundaryTestApp(t *testing.T, now time.Time) (*simapp.SimApp, sdk.Context, storetypes.KVStore) {
	t.Helper()
	app := newSnapshotTestApp(t)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	RegisterInterfaces(app.InterfaceRegistry())
	ctx := app.NewContextLegacy(false, cmtproto.Header{ChainID: "boundary-test-1", Height: 100, Time: now})
	ctx = withTestHostProgress(ctx)
	provider := clienttypes.NewStoreProvider(runtime.NewKVStoreService(app.GetKey(exported.StoreKey)))
	module := NewLightClientModule(app.AppCodec(), provider)
	app.IBCKeeper.ClientKeeper.AddRoute(ModuleName, &module)
	store := provider.ClientStore(ctx, ModuleName+"-0")
	params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
	params.AllowedClients = append(params.AllowedClients, ModuleName)
	app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
	return app, ctx, store
}

func recoveryStoreSnapshot(t *testing.T, store storetypes.KVStore) map[string][]byte {
	t.Helper()
	snapshot := map[string][]byte{}
	iterator := store.Iterator(nil, nil)
	defer func() { require.NoError(t, iterator.Close()) }()
	for ; iterator.Valid(); iterator.Next() {
		// BeginBlock advances these records even if every transaction fails.
		if bytes.HasPrefix(iterator.Key(), []byte("snapshots/v2/host/")) {
			continue
		}
		snapshot[string(iterator.Key())] = bytes.Clone(iterator.Value())
	}
	return snapshot
}

// All synthetic blocks contain the same authenticated empty body. Restore
// that body when promoting a descendant to an anchor or bridge block.
func nativeSettlementHeaderAtAnchor(t *testing.T, original *ProbabilisticHeader, height uint64) *ProbabilisticHeader {
	t.Helper()
	encoded, err := json.Marshal(original)
	require.NoError(t, err)
	var header ProbabilisticHeader
	require.NoError(t, json.Unmarshal(encoded, &header))
	var fields []cbor.RawMessage
	_, err = cbor.Decode(header.AnchorBlock.BlockCbor, &fields)
	require.NoError(t, err)
	blocks := append([]*ProbabilisticBlock{header.AnchorBlock}, header.DescendantBlocks...)
	header.BridgeBlocks, header.DescendantBlocks = nil, nil
	for _, block := range blocks {
		if block.Height.RevisionHeight <= height {
			if len(block.HeaderCbor) > 0 {
				fields[0] = block.HeaderCbor
				block.BlockCbor, err = cbor.Encode(fields)
				require.NoError(t, err)
				block.HeaderCbor = nil
			}
			if block.Height.RevisionHeight == height {
				header.AnchorBlock = block
			} else {
				header.BridgeBlocks = append(header.BridgeBlocks, block)
			}
		} else {
			header.DescendantBlocks = append(header.DescendantBlocks, block)
		}
	}
	return &header
}

// Register the same client route as the compatibility profile's simd.
func registerCapacityClient(app *simapp.SimApp) {
	InstallHostLiveness(app)
	RegisterInterfaces(app.InterfaceRegistry())
	provider := clienttypes.NewStoreProvider(runtime.NewKVStoreService(app.GetKey(exported.StoreKey)))
	module := NewLightClientModule(app.AppCodec(), provider)
	app.IBCKeeper.ClientKeeper.AddRoute(ModuleName, &module)
}

func newSnapshotTestApp(t *testing.T) *simapp.SimApp {
	t.Helper()
	app := simapp.NewSimApp(log.NewNopLogger(), dbm.NewMemDB(), nil, false, simtestutil.AppOptionsMap{flags.FlagHome: t.TempDir()})
	app.MountStores(SharedStoreKey)
	RegisterInterfaces(app.InterfaceRegistry())
	require.NoError(t, app.LoadLatestVersion())
	validator := cmttypes.NewMockPV()
	public, err := validator.GetPubKey()
	require.NoError(t, err)
	validators := cmttypes.NewValidatorSet([]*cmttypes.Validator{cmttypes.NewValidator(public, 1)})
	key := secp256k1.GenPrivKey()
	account := authtypes.NewBaseAccount(sdk.AccAddress(key.PubKey().Address()), key.PubKey(), 0, 0)
	genesis, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), app.DefaultGenesis(), validators, []authtypes.GenesisAccount{account}, banktypes.Balance{Address: account.GetAddress().String(), Coins: sdk.NewCoins(sdk.NewInt64Coin(sdk.DefaultBondDenom, 100000000000000))})
	require.NoError(t, err)
	raw, err := json.Marshal(genesis)
	require.NoError(t, err)
	_, err = app.InitChain(&abci.RequestInitChain{ConsensusParams: simtestutil.DefaultConsensusParams, AppStateBytes: raw})
	require.NoError(t, err)
	return app
}
