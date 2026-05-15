package stability

import (
	"bytes"
	"fmt"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	upgradetypes "cosmossdk.io/x/upgrade/types"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v10/modules/core/02-client/types"
	commitmenttypesv2 "github.com/cosmos/ibc-go/v10/modules/core/23-commitment/types/v2"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

func (cs *ClientState) VerifyUpgradeAndUpdateState(
	ctx sdk.Context,
	cdc codec.BinaryCodec,
	clientStore storetypes.KVStore,
	newClientBz []byte,
	newConsStateBz []byte,
	upgradedClient *ClientState,
	upgradedConsState *ConsensusState,
	upgradeClientProof []byte,
	upgradeConsensusStateProof []byte,
) error {
	if len(cs.UpgradePath) == 0 {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "cannot upgrade client, no upgrade path set")
	}
	for i, part := range cs.UpgradePath {
		if part == "" {
			return errorsmod.Wrapf(clienttypes.ErrInvalidUpgradeClient, "upgrade path segment %d cannot be empty", i)
		}
	}
	if cs.Status(ctx, clientStore, cdc) != exported.Active {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "client must be active to upgrade")
	}
	if upgradedClient == nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidClient, "upgraded client state must not be nil")
	}
	if upgradedConsState == nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidConsensus, "upgraded consensus state must not be nil")
	}
	if err := upgradedClient.Validate(); err != nil {
		return errorsmod.Wrap(err, "upgraded client state failed validation")
	}
	if err := upgradedConsState.ValidateBasic(); err != nil {
		return errorsmod.Wrap(err, "upgraded consensus state failed validation")
	}
	// The relayer supplies the bytes, but must not get to choose the client's
	// security posture. Chain/epoch context may move forward; verifier-chosen
	// parameters such as thresholds, timing, upgrade path, and HostState identity
	// must be byte-for-byte preserved.
	if err := cs.validateUpgradeSafety(upgradedClient); err != nil {
		return err
	}

	upgradeHeight := cs.LatestHeight
	if upgradeHeight == nil || upgradeHeight.IsZero() {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "upgrade height must be the current latest height")
	}

	// The first upgrade version is deliberately narrow: Cardano must have
	// already been accepted at the exact height where it committed the upgraded
	// client and consensus states. This avoids planned-future-height semantics.
	clientPath := constructUpgradeClientMerklePath(cs.UpgradePath, upgradeHeight)
	if err := cs.VerifyMembership(ctx, clientStore, cdc, upgradeHeight, 0, 0, upgradeClientProof, clientPath, newClientBz); err != nil {
		return errorsmod.Wrapf(err, "upgraded client proof failed. Path: %s", clientPath.GetKeyPath())
	}

	consensusPath := constructUpgradeConsStateMerklePath(cs.UpgradePath, upgradeHeight)
	if err := cs.VerifyMembership(ctx, clientStore, cdc, upgradeHeight, 0, 0, upgradeConsensusStateProof, consensusPath, newConsStateBz); err != nil {
		return errorsmod.Wrapf(err, "upgraded consensus state proof failed. Path: %s", consensusPath.GetKeyPath())
	}

	upgradedClient.FrozenHeight = ZeroHeight()
	setClientState(clientStore, cdc, upgradedClient)
	setConsensusState(clientStore, cdc, upgradedConsState, upgradedClient.LatestHeight)
	setConsensusMetadata(ctx, clientStore, upgradedClient.LatestHeight)
	setStabilityTelemetry(clientStore, upgradedClient.LatestHeight, upgradedConsState)
	return nil
}

func (cs *ClientState) validateUpgradeSafety(upgradedClient *ClientState) error {
	if cs.ClientType() != upgradedClient.ClientType() {
		return errorsmod.Wrapf(clienttypes.ErrInvalidClientType, "upgraded client type mismatch: expected %s got %s", cs.ClientType(), upgradedClient.ClientType())
	}
	if cs.LatestHeight == nil || upgradedClient.LatestHeight == nil {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "current and upgraded latest heights must be set")
	}
	if !upgradedClient.LatestHeight.EQ(cs.LatestHeight) {
		return errorsmod.Wrapf(clienttypes.ErrInvalidUpgradeClient, "upgraded latest height %s must equal current latest height %s", upgradedClient.LatestHeight, cs.LatestHeight)
	}
	if !bytes.Equal(upgradedClient.HostStateNftPolicyId, cs.HostStateNftPolicyId) {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "host_state_nft_policy_id cannot change during upgrade")
	}
	if !bytes.Equal(upgradedClient.HostStateNftTokenName, cs.HostStateNftTokenName) {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "host_state_nft_token_name cannot change during upgrade")
	}
	if upgradedClient.TrustingPeriod != cs.TrustingPeriod {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "trusting_period cannot change during upgrade")
	}
	if !equalHeuristicParams(upgradedClient.HeuristicParams, cs.HeuristicParams) {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "heuristic_params cannot change during upgrade")
	}
	if !equalStringSlices(upgradedClient.UpgradePath, cs.UpgradePath) {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "upgrade_path cannot change during upgrade")
	}
	if upgradedClient.SystemStartUnixNs != cs.SystemStartUnixNs {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "system_start_unix_ns cannot change during upgrade")
	}
	if upgradedClient.SlotLengthNs != cs.SlotLengthNs {
		return errorsmod.Wrap(clienttypes.ErrInvalidUpgradeClient, "slot_length_ns cannot change during upgrade")
	}
	return nil
}

func setStabilityTelemetry(clientStore storetypes.KVStore, height *Height, consensusState *ConsensusState) {
	if height == nil || consensusState == nil {
		return
	}
	clientStore.Set(StabilityScoreKey(height.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.SecurityScoreBps))
	clientStore.Set(UniquePoolsKey(height.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.UniquePoolsCount))
	clientStore.Set(UniqueStakeKey(height.RevisionHeight), sdk.Uint64ToBigEndian(consensusState.UniqueStakeBps))
	clientStore.Set(AcceptedBlockHashKey(height.RevisionHeight), []byte(consensusState.AcceptedBlockHash))
}

func constructUpgradeClientMerklePath(upgradePath []string, height exported.Height) commitmenttypesv2.MerklePath {
	return constructUpgradeMerklePath(upgradePath, height, upgradetypes.KeyUpgradedClient)
}

func constructUpgradeConsStateMerklePath(upgradePath []string, height exported.Height) commitmenttypesv2.MerklePath {
	return constructUpgradeMerklePath(upgradePath, height, upgradetypes.KeyUpgradedConsState)
}

func constructUpgradeMerklePath(upgradePath []string, height exported.Height, suffix string) commitmenttypesv2.MerklePath {
	parts := make([]string, 0, len(upgradePath)+2)
	parts = append(parts, upgradePath...)
	parts = append(parts, fmt.Sprintf("%d", height.GetRevisionHeight()), suffix)
	// Cardano's IBC commitment tree stores the full logical path as the final
	// MerklePath element, matching the rest of this client verifier.
	return commitmenttypesv2.NewMerklePath([]byte(strings.Join(parts, "/")))
}

func equalHeuristicParams(a, b *HeuristicParams) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.ThresholdDepth == b.ThresholdDepth &&
		a.ThresholdUniquePools == b.ThresholdUniquePools &&
		a.ThresholdUniqueStakeBps == b.ThresholdUniqueStakeBps &&
		a.DepthWeightBps == b.DepthWeightBps &&
		a.PoolsWeightBps == b.PoolsWeightBps &&
		a.StakeWeightBps == b.StakeWeightBps
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
