package state

import (
	"bytes"
	"fmt"
	"math"

	errorsmod "cosmossdk.io/errors"
	core "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

func clonePraosNonceState(s *PraosNonceState) *PraosNonceState {
	if s == nil {
		return nil
	}
	return &PraosNonceState{
		EpochNonce: bytes.Clone(s.EpochNonce), EvolvingNonce: bytes.Clone(s.EvolvingNonce),
		CandidateNonce: bytes.Clone(s.CandidateNonce), LastAppliedBlockNonce: bytes.Clone(s.LastAppliedBlockNonce),
		LastEpochBlockNonce: bytes.Clone(s.LastEpochBlockNonce),
	}
}

func praosNonceStatesEqual(a, b *PraosNonceState) bool {
	if a == nil || b == nil {
		return a == b
	}
	return bytes.Equal(a.EpochNonce, b.EpochNonce) && bytes.Equal(a.EvolvingNonce, b.EvolvingNonce) &&
		bytes.Equal(a.CandidateNonce, b.CandidateNonce) && bytes.Equal(a.LastAppliedBlockNonce, b.LastAppliedBlockNonce) &&
		bytes.Equal(a.LastEpochBlockNonce, b.LastEpochBlockNonce)
}

func validatePraosNonceState(s *PraosNonceState) error {
	if s == nil {
		return errorsmod.Wrap(ErrIBCInvalidClient, "authenticated Praos nonce state is missing, bootstrap or migration must supply it")
	}
	if len(s.EpochNonce) != 32 {
		return errorsmod.Wrap(ErrIBCInvalidClient, "checkpoint epoch nonce must be 32 bytes")
	}
	for _, field := range []struct {
		name  string
		value []byte
	}{
		{"evolving_nonce", s.EvolvingNonce}, {"candidate_nonce", s.CandidateNonce},
		{"last_applied_block_nonce", s.LastAppliedBlockNonce}, {"last_epoch_block_nonce", s.LastEpochBlockNonce},
	} {
		if err := core.ValidatePraosNonce(field.value); err != nil {
			return errorsmod.Wrapf(ErrIBCInvalidClient, "%s: %v", field.name, err)
		}
	}
	return nil
}

func (cs ClientState) validateNonceConfiguration() error {
	if cs.RandomnessStabilisationWindowSlots == 0 {
		return errorsmod.Wrap(ErrIBCInvalidClient, "randomness_stabilisation_window_slots must be configured")
	}
	if err := validatePraosNonceState(cs.LatestCheckpointNonceState); err != nil {
		return err
	}
	if !bytes.Equal(cs.EpochNonce, cs.LatestCheckpointNonceState.EpochNonce) {
		return errorsmod.Wrap(ErrIBCInvalidClient, "current epoch nonce must match checkpoint nonce state")
	}
	return nil
}

// nonceTracker is a private continuation of the state at the trusted cursor.
// A settlement descendant advances only this copy, never the anchor snapshot.
type nonceTracker struct {
	state               *PraosNonceState
	height, slot, epoch uint64
	hash                string
}

func newNonceTracker(trusted *trustedBlockState) (*nonceTracker, error) {
	if trusted == nil || trusted.height == nil {
		return nil, fmt.Errorf("nonce tracker trusted cursor is missing")
	}
	if err := validatePraosNonceState(trusted.nonceState); err != nil {
		return nil, err
	}
	return &nonceTracker{state: clonePraosNonceState(trusted.nonceState), height: trusted.height.RevisionHeight,
		slot: trusted.slot, epoch: trusted.epoch, hash: trusted.blockHash}, nil
}

func (n *nonceTracker) tick(cs *ClientState, height, slot, epoch uint64, prevHash string) error {
	if n.height == math.MaxUint64 || height != n.height+1 || !equalBlockHashes(prevHash, n.hash) {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "nonce header does not connect to trusted chain")
	}
	if slot <= n.slot || epoch < n.epoch {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "nonce header slot or epoch did not advance")
	}
	if epoch > n.epoch {
		// Native Praos ticks before validating the first new-epoch header.
		// Use the old saved contribution, then advance it. EvolvingNonce does
		// not reset, including contributions after the candidate cutoff.
		next, err := core.CombinePraosNonces(n.state.CandidateNonce, n.state.LastEpochBlockNonce)
		if err != nil {
			return err
		}
		n.state.EpochNonce = next
		n.state.LastEpochBlockNonce = bytes.Clone(n.state.LastAppliedBlockNonce)
		n.epoch = epoch
	}
	return nil
}

func equalBlockHashes(a, b string) bool { return bytes.EqualFold([]byte(a), []byte(b)) }

func (n *nonceTracker) apply(cs *ClientState, block *authenticatedProbabilisticBlock, verifiedVRFOutput []byte) error {
	contribution, err := core.PraosNonceContribution(verifiedVRFOutput)
	if err != nil {
		return err
	}
	evolving, err := core.CombinePraosNonces(n.state.EvolvingNonce, contribution)
	if err != nil {
		return err
	}
	_, nextEpochStart, err := cs.epochSlotBounds(block.epoch)
	if err != nil {
		return err
	}
	if block.slot > math.MaxUint64-cs.RandomnessStabilisationWindowSlots {
		return errorsmod.Wrap(ErrInvalidAcceptedBlock, "nonce cutoff slot arithmetic overflows uint64")
	}
	n.state.EvolvingNonce = evolving
	// Strictly before the cutoff. A header exactly at it does not contribute
	// to CandidateNonce, but still contributes to EvolvingNonce.
	if block.slot+cs.RandomnessStabilisationWindowSlots < nextEpochStart {
		n.state.CandidateNonce = bytes.Clone(evolving)
	}
	// This is the header's previous-block hash, not the header's own hash.
	n.state.LastAppliedBlockNonce, err = core.PraosPreviousHashNonce(block.prevHash)
	if err != nil {
		return err
	}
	n.height, n.slot, n.hash = block.height, block.slot, block.hash
	return nil
}
