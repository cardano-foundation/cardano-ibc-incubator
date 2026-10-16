package probabilistic

import (
	"encoding/binary"

	storetypes "cosmossdk.io/store/types"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

var hostProgressKey = []byte("probabilisticHost/continuity")
var previousHostProgressKey = []byte("probabilisticHost/previousContinuity")

type hostProgressContextKey struct{}
type hostProgressProvider func(sdk.Context) *state.HostProgress

// HostApplication exposes the existing IBC store and SDK block/transaction hooks.
// InstallHostLiveness must run after the host sets its ante handler and before sealing.
type HostApplication interface {
	GetKey(string) *storetypes.KVStoreKey
	BeginBlocker(sdk.Context) (sdk.BeginBlock, error)
	SetBeginBlocker(sdk.BeginBlocker)
	AnteHandler() sdk.AnteHandler
	SetAnteHandler(sdk.AnteHandler)
}

// InstallHostLiveness records every host block before transactions execute.
// Missing records start a fresh window, including when upgrading an existing host.
// The ante wrapper only supplies evidence. It never prevents challenges executing.
func InstallHostLiveness(app HostApplication) {
	key := app.GetKey("ibc")
	if key == nil || app.AnteHandler() == nil {
		panic("probabilistic host requires IBC store and ante handler")
	}
	app.SetBeginBlocker(func(ctx sdk.Context) (sdk.BeginBlock, error) {
		store := ctx.KVStore(key)
		previous := store.Get(hostProgressKey)
		progress, err := state.AdvanceHostProgress(state.Context{Time: ctx.BlockTime(), Height: ctx.BlockHeight()}, decodeHostProgress(previous))
		if err != nil {
			return sdk.BeginBlock{}, err
		}
		if len(previous) != 0 {
			store.Set(previousHostProgressKey, previous)
		}
		store.Set(hostProgressKey, encodeHostProgress(progress))
		return app.BeginBlocker(ctx)
	})
	ante := app.AnteHandler()
	app.SetAnteHandler(func(ctx sdk.Context, tx sdk.Tx, simulate bool) (sdk.Context, error) {
		// Snapshot before IBC ante verification. SDK simulation can keep an
		// older context while the underlying store advances during verification.
		store := ctx.MultiStore().GetKVStore(key)
		currentBytes, previousBytes := store.Get(hostProgressKey), store.Get(previousHostProgressKey)
		progress := decodeHostProgress(currentBytes)
		if progress == nil || progress.Height != ctx.BlockHeight() {
			progress = decodeHostProgress(previousBytes)
		}
		charged := false
		chargeReads := func(current sdk.Context) {
			if !charged {
				config := current.KVGasConfig()
				current.GasMeter().ConsumeGas(2*config.ReadCostFlat+uint64(len(hostProgressKey)+len(previousHostProgressKey)+len(currentBytes)+len(previousBytes))*config.ReadCostPerByte, "probabilistic host continuity reads")
				charged = true
			}
		}
		// IBC ante decorators can verify proofs. Supply the immutable record
		// first, then charge the reads with the gas meter installed by the host.
		ctx = ctx.WithValue(hostProgressContextKey{}, hostProgressProvider(func(current sdk.Context) *state.HostProgress {
			chargeReads(current)
			return progress
		}))
		result, err := ante(ctx, tx, simulate)
		if !result.IsZero() {
			chargeReads(result)
		}
		return result, err
	})
}

func encodeHostProgress(p *state.HostProgress) []byte {
	data := make([]byte, 32)
	binary.BigEndian.PutUint64(data, uint64(p.Height))
	binary.BigEndian.PutUint64(data[8:], p.TimeUnixNs)
	binary.BigEndian.PutUint64(data[16:], p.PreviousTimeUnixNs)
	binary.BigEndian.PutUint64(data[24:], p.ResumeUsableAfterUnixNs)
	return data
}
func decodeHostProgress(data []byte) *state.HostProgress {
	if len(data) != 32 {
		return nil
	}
	return &state.HostProgress{Height: int64(binary.BigEndian.Uint64(data)), TimeUnixNs: binary.BigEndian.Uint64(data[8:]), PreviousTimeUnixNs: binary.BigEndian.Uint64(data[16:]), ResumeUsableAfterUnixNs: binary.BigEndian.Uint64(data[24:])}
}
func verifyHostUsability(ctx sdk.Context, current state.Context, deadline uint64) error {
	var progress *state.HostProgress
	if provider, ok := ctx.Value(hostProgressContextKey{}).(hostProgressProvider); ok {
		progress = provider(ctx)
	}
	return state.VerifyHostWindow(current, deadline, progress)
}
