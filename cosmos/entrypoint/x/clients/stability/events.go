package stability

import (
	"strconv"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/ibc-go/v10/modules/core/exported"
)

const (
	EventTypeStabilityHeaderAccepted = "stability_header_accepted"
	EventTypeStabilityHeaderRejected = "stability_header_rejected"
	EventTypeStabilityClientFrozen   = "stability_client_frozen"

	AttributeKeyClientID                = "client_id"
	AttributeKeyReason                  = "reason"
	AttributeKeyTrustedHeight           = "trusted_height"
	AttributeKeyAcceptedHeight          = "accepted_height"
	AttributeKeyAcceptedBlockHash       = "accepted_block_hash"
	AttributeKeyAcceptedEpoch           = "accepted_epoch"
	AttributeKeyDescendantDepth         = "descendant_depth"
	AttributeKeyUniquePoolsCount        = "unique_pools_count"
	AttributeKeyUniqueStakeBps          = "unique_stake_bps"
	AttributeKeySecurityScoreBps        = "security_score_bps"
	AttributeKeyThresholdDepth          = "threshold_depth"
	AttributeKeyThresholdUniquePools    = "threshold_unique_pools"
	AttributeKeyThresholdUniqueStakeBps = "threshold_unique_stake_bps"
	AttributeKeyFrozenHeight            = "frozen_height"
)

func emitStabilityHeaderAcceptedEvent(
	ctx sdk.Context,
	clientID string,
	header *StabilityHeader,
	clientState *ClientState,
	consensusState *ConsensusState,
) {
	if header == nil || header.AnchorBlock == nil || clientState == nil || consensusState == nil {
		return
	}

	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeStabilityHeaderAccepted,
			sdk.NewAttribute(AttributeKeyClientID, clientID),
			sdk.NewAttribute(AttributeKeyTrustedHeight, heightString(header.TrustedHeight)),
			sdk.NewAttribute(AttributeKeyAcceptedHeight, heightString(header.GetHeight())),
			sdk.NewAttribute(AttributeKeyAcceptedBlockHash, consensusState.AcceptedBlockHash),
			sdk.NewAttribute(AttributeKeyAcceptedEpoch, strconv.FormatUint(consensusState.AcceptedEpoch, 10)),
			sdk.NewAttribute(AttributeKeyDescendantDepth, strconv.Itoa(len(header.DescendantBlocks))),
			sdk.NewAttribute(AttributeKeyUniquePoolsCount, strconv.FormatUint(consensusState.UniquePoolsCount, 10)),
			sdk.NewAttribute(AttributeKeyUniqueStakeBps, strconv.FormatUint(consensusState.UniqueStakeBps, 10)),
			sdk.NewAttribute(AttributeKeySecurityScoreBps, strconv.FormatUint(consensusState.SecurityScoreBps, 10)),
			sdk.NewAttribute(AttributeKeyThresholdDepth, strconv.FormatUint(clientState.HeuristicParams.ThresholdDepth, 10)),
			sdk.NewAttribute(AttributeKeyThresholdUniquePools, strconv.FormatUint(clientState.HeuristicParams.ThresholdUniquePools, 10)),
			sdk.NewAttribute(AttributeKeyThresholdUniqueStakeBps, strconv.FormatUint(clientState.HeuristicParams.ThresholdUniqueStakeBps, 10)),
		),
	)
}

func emitStabilityHeaderRejectedEvent(
	ctx sdk.Context,
	clientID string,
	header *StabilityHeader,
	err error,
) {
	if header == nil || err == nil {
		return
	}

	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeStabilityHeaderRejected,
			sdk.NewAttribute(AttributeKeyClientID, clientID),
			sdk.NewAttribute(AttributeKeyTrustedHeight, heightString(header.TrustedHeight)),
			sdk.NewAttribute(AttributeKeyAcceptedHeight, heightString(header.GetHeight())),
			sdk.NewAttribute(AttributeKeyReason, err.Error()),
		),
	)
}

func emitStabilityClientFrozenEvent(ctx sdk.Context, clientID string, frozenHeight exported.Height) {
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeStabilityClientFrozen,
			sdk.NewAttribute(AttributeKeyClientID, clientID),
			sdk.NewAttribute(AttributeKeyFrozenHeight, heightString(frozenHeight)),
			sdk.NewAttribute(AttributeKeyReason, "misbehaviour"),
		),
	)
}

func heightString(height exported.Height) string {
	if height == nil {
		return ""
	}
	return height.String()
}
