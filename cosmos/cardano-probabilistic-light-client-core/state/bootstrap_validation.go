package state

import (
	"bytes"
	"fmt"
	"math"
	"strings"

	errorsmod "cosmossdk.io/errors"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Full collections are accepted only by the offline trusted bootstrap builder.
// They are never valid public IBC client or consensus records.
func validateBootstrapInput(cs ClientState) error {
	if _, err := productionRecordMap(cs.LatestCheckpointPoolProduction, cs.CurrentEpoch); err != nil {
		return err
	}
	if err := validateSettlementCredit(cs.LatestCheckpointSettlementCredit, cs.CurrentEpoch); err != nil {
		return err
	}
	if err := cs.validateNonceConfiguration(); err != nil {
		return err
	}
	if err := validatePoolRegistry(cs.LatestCheckpointPoolRegistry, cs.CurrentEpoch, math.MaxUint64); err != nil {
		return err
	}
	if len(cs.PacketLanePolicyId) != 28 {
		return fmt.Errorf("packet lane policy must be configured for this deployment")
	}
	if strings.TrimSpace(cs.ChainId) == "" {
		return errorsmod.Wrap(ErrInvalidChainID, "chain id cannot be empty string")
	}
	if len(cs.ChainId) > cmttypes.MaxChainIDLen {
		return errorsmod.Wrapf(ErrInvalidChainID, "chainID is too long; got: %d, max: %d", len(cs.ChainId), cmttypes.MaxChainIDLen)
	}
	if cs.LatestHeight == nil || cs.LatestHeight.RevisionHeight == 0 {
		return errorsmod.Wrapf(ErrInvalidHeaderHeight, "probabilistic client's latest height revision height cannot be zero")
	}
	if cs.TrustingPeriod <= 0 {
		return errorsmod.Wrap(ErrInvalidTrustingPeriod, "trusting period must be greater than zero")
	}
	if cs.MaxClockDrift <= 0 {
		return errorsmod.Wrap(ErrInvalidMaxClockDrift, "max clock drift must be greater than zero")
	}
	if len(cs.HostStateNftPolicyId) != 28 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "host_state_nft_policy_id must be 28 bytes")
	}
	if len(cs.HostStateNftTokenName) == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "host_state_nft_token_name must not be empty")
	}
	if cs.SystemStartUnixNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "system_start_unix_ns must be greater than zero")
	}
	if cs.SlotLengthNs == 0 {
		return errorsmod.Wrapf(ErrInvalidTimestamp, "slot_length_ns must be greater than zero")
	}
	if cs.SlotsPerKesPeriod == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "slots_per_kes_period must be greater than zero")
	}
	if cs.MaxKesEvolutions == 0 || cs.MaxKesEvolutions > maxSupportedKesEvolutions {
		return errorsmod.Wrapf(
			ErrIBCInvalidClient,
			"max_kes_evolutions must be between 1 and %d",
			maxSupportedKesEvolutions,
		)
	}
	if cs.ActiveSlotCoefficientNumerator == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active_slot_coefficient_numerator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientDenominator == 0 {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active_slot_coefficient_denominator must be greater than zero")
	}
	if cs.ActiveSlotCoefficientNumerator > cs.ActiveSlotCoefficientDenominator {
		return errorsmod.Wrapf(ErrIBCInvalidClient, "active slot coefficient must not exceed one")
	}
	if err := cs.validateBootstrapCheckpoint(); err != nil {
		return err
	}

	contexts, err := cs.normalizedEpochContexts()
	if err != nil {
		return err
	}
	if len(contexts) == 0 {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "at least one epoch context must be present")
	}
	if epochContextByEpoch(contexts, cs.CurrentEpoch) == nil {
		return errorsmod.Wrapf(ErrInvalidCurrentEpoch, "missing epoch context for current epoch %d", cs.CurrentEpoch)
	}
	if err := verifyStakeTablePoolBindings(epochContextByEpoch(contexts, cs.CurrentEpoch), cs.LatestCheckpointPoolRegistry); err != nil {
		return err
	}
	return nil
}

func validateBootstrapConsensus(cs ConsensusState) error {
	if _, err := productionRecordMap(cs.PoolProduction, cs.AcceptedEpoch); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validateSettlementCredit(cs.SettlementCredit, cs.AcceptedEpoch); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validatePoolRegistry(cs.PoolRegistry, cs.AcceptedEpoch, math.MaxUint64); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if err := validatePraosNonceState(cs.NonceState); err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if cs.Timestamp == 0 {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "timestamp must be a positive Unix time")
	}
	if cmttypes.ValidateHash(cs.IbcStateRoot) != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "ibc_state_root must be a 32-byte hash")
	}
	if cs.AcceptedBlockHash == "" {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "accepted_block_hash must be set")
	}
	snapshot, err := probabilisticcore.DecodePacketStateSnapshot(cs.PacketStateSnapshot)
	if err != nil {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, err.Error())
	}
	if snapshot.BlockHash != cs.AcceptedBlockHash || !bytes.Equal(snapshot.HostRoot, cs.IbcStateRoot) {
		return errorsmod.Wrap(ErrIBCInvalidConsensus, "packet snapshot does not match consensus commitment")
	}
	return nil
}
