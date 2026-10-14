//go:build caribic_v8_upgrade

package probabilistic

import (
	"context"
	"fmt"
	"testing"

	storetypes "cosmossdk.io/store/types"
	upgradetypes "cosmossdk.io/x/upgrade/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/module"
	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/stretchr/testify/require"
)

// Only the successor binary mounts this store and understands the upgrade.
// The existing SDK and IBC stores keep their original keys and verifier code.
func configureAcceptanceUpgrade(t *testing.T, app *simapp.SimApp, _ string) {
	key := storetypes.NewKVStoreKey(acceptanceUpgradeStore)
	app.MountKVStores(map[string]*storetypes.KVStoreKey{acceptanceUpgradeStore: key})
	info, err := app.UpgradeKeeper.ReadUpgradeInfoFromDisk()
	require.NoError(t, err)
	if info.Name == acceptanceUpgradeName {
		app.SetStoreLoader(upgradetypes.UpgradeStoreLoader(info.Height, &storetypes.StoreUpgrades{Added: []string{acceptanceUpgradeStore}}))
	}
	app.UpgradeKeeper.SetUpgradeHandler(acceptanceUpgradeName, func(ctx context.Context, plan upgradetypes.Plan, versions module.VersionMap) (module.VersionMap, error) {
		sdkCtx := sdk.UnwrapSDKContext(ctx)
		if sdkCtx.BlockHeight() != plan.Height {
			return nil, fmt.Errorf("upgrade height %d differs from plan height %d", sdkCtx.BlockHeight(), plan.Height)
		}
		sdkCtx.KVStore(key).Set([]byte("applied-height"), sdk.Uint64ToBigEndian(uint64(plan.Height)))
		return app.ModuleManager.RunMigrations(ctx, app.Configurator(), versions)
	})
}
