package probabilistic

import (
	"strconv"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

const (
	EventTypeProbabilisticHeaderAccepted = "probabilistic_header_accepted"
	EventTypeProbabilisticHeaderRejected = "probabilistic_header_rejected"
	EventTypeProbabilisticClientFrozen   = "probabilistic_client_frozen"

	AttributeKeyClientID                = "client_id"
	AttributeKeyReason                  = "reason"
	AttributeKeyTrustedHeight           = "trusted_height"
	AttributeKeyAcceptedHeight          = "accepted_height"
	AttributeKeyAcceptedBlockHash       = "accepted_block_hash"
	AttributeKeyAcceptedEpoch           = "accepted_epoch"
	AttributeKeyPreviousEpoch           = "previous_epoch"
	AttributeKeyRollover                = "rollover"
	AttributeKeyDescendantDepth         = "descendant_depth"
	AttributeKeyUniquePoolsCount        = "unique_pools_count"
	AttributeKeyUniqueStakeBps          = "unique_stake_bps"
	AttributeKeySecurityScoreBps        = "security_score_bps"
	AttributeKeyThresholdDepth          = "threshold_depth"
	AttributeKeyThresholdUniquePools    = "threshold_unique_pools"
	AttributeKeyThresholdUniqueStakeBps = "threshold_unique_stake_bps"
	AttributeKeyFrozenHeight            = "frozen_height"
)

func emitProbabilisticHeaderAcceptedEvent(
	ctx sdk.Context,
	clientID string,
	header *ProbabilisticHeader,
	clientState *ClientState,
	consensusState *ConsensusState,
	previousEpoch uint64,
) {
	if header == nil || header.AnchorBlock == nil || clientState == nil || consensusState == nil {
		return
	}

	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeProbabilisticHeaderAccepted,
			sdk.NewAttribute(AttributeKeyClientID, clientID),
			sdk.NewAttribute(AttributeKeyTrustedHeight, heightString(header.TrustedHeight)),
			sdk.NewAttribute(AttributeKeyAcceptedHeight, heightString(header.GetHeight())),
			sdk.NewAttribute(AttributeKeyAcceptedBlockHash, consensusState.AcceptedBlockHash),
			sdk.NewAttribute(AttributeKeyAcceptedEpoch, strconv.FormatUint(consensusState.AcceptedEpoch, 10)),
			sdk.NewAttribute(AttributeKeyPreviousEpoch, strconv.FormatUint(previousEpoch, 10)),
			sdk.NewAttribute(AttributeKeyRollover, strconv.FormatBool(consensusState.AcceptedEpoch != previousEpoch)),
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

func emitProbabilisticHeaderRejectedEvent(
	ctx sdk.Context,
	clientID string,
	header *ProbabilisticHeader,
	err error,
) {
	if header == nil || err == nil {
		return
	}

	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeProbabilisticHeaderRejected,
			sdk.NewAttribute(AttributeKeyClientID, clientID),
			sdk.NewAttribute(AttributeKeyTrustedHeight, heightString(header.TrustedHeight)),
			sdk.NewAttribute(AttributeKeyAcceptedHeight, heightString(header.GetHeight())),
			sdk.NewAttribute(AttributeKeyReason, err.Error()),
		),
	)
}

func emitProbabilisticClientFrozenEvent(ctx sdk.Context, clientID string, frozenHeight exported.Height) {
	ctx.EventManager().EmitEvent(
		sdk.NewEvent(
			EventTypeProbabilisticClientFrozen,
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
