package probabilistic

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type acceptanceConsensusControl struct {
	GateHeight     int64
	VoteTimeHeight int64
	VoteTimeUnixNs int64
}

// Consensus still uses the persistent FilePV and ordinary CometBFT validation.
// The gate lets the driver queue signed transactions before a block is made.
// A signed vote timestamp makes the next block land exactly on a boundary.
// No application header, deadline, client state or transaction result is changed.
type acceptanceConsensusValidator struct {
	cmttypes.PrivValidator
	control string
	stopped <-chan struct{}
}

func (v *acceptanceConsensusValidator) read() (acceptanceConsensusControl, error) {
	var control acceptanceConsensusControl
	raw, err := os.ReadFile(v.control)
	if os.IsNotExist(err) {
		return control, nil
	}
	if err != nil {
		return control, err
	}
	err = json.Unmarshal(raw, &control)
	return control, err
}

func (v *acceptanceConsensusValidator) SignProposal(chainID string, proposal *cmtproto.Proposal) error {
	control, err := v.read()
	if err != nil {
		return err
	}
	if proposal.Height == control.GateHeight {
		raw, err := json.Marshal(map[string]int64{"height": proposal.Height})
		if err != nil {
			return err
		}
		if err := os.WriteFile(v.control+".paused", raw, 0600); err != nil {
			return err
		}
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			if _, err := os.Stat(v.control + ".release"); err == nil {
				break
			}
			select {
			case <-v.stopped:
				return fmt.Errorf("test consensus gate stopped")
			case <-ticker.C:
			}
		}
	}
	return v.PrivValidator.SignProposal(chainID, proposal)
}

func (v *acceptanceConsensusValidator) SignVote(chainID string, vote *cmtproto.Vote) error {
	control, err := v.read()
	if err != nil {
		return err
	}
	if vote.Height == control.VoteTimeHeight && control.VoteTimeUnixNs > 0 {
		vote.Timestamp = time.Unix(0, control.VoteTimeUnixNs).UTC()
	}
	return v.PrivValidator.SignVote(chainID, vote)
}
