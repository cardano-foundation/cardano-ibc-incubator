package relayer

import (
	"context"
	"github.com/cometbft/cometbft/proto/tendermint/version"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/mock"
	"time"
)

type ProviderMock struct {
	mock.Mock
}

func (p *ProviderMock) ChainID() string {
	args := p.Called()
	return args.String(0)
}

func (p *ProviderMock) LightBlock(ctx context.Context, height int64) (*types.LightBlock, error) {
	args := p.Called(ctx, height)
	return &types.LightBlock{
		SignedHeader: &types.SignedHeader{
			Header: &types.Header{
				Version: version.Consensus{
					Block: 0,
					App:   0,
				},
				ChainID: "",
				Height:  0,
				Time:    time.Time{},
				LastBlockID: types.BlockID{
					Hash: nil,
					PartSetHeader: types.PartSetHeader{
						Total: 0,
						Hash:  nil,
					},
				},
				LastCommitHash:     nil,
				DataHash:           nil,
				ValidatorsHash:     nil,
				NextValidatorsHash: nil,
				ConsensusHash:      nil,
				AppHash:            nil,
				LastResultsHash:    nil,
				EvidenceHash:       nil,
				ProposerAddress:    nil,
			},
			Commit: &types.Commit{
				Height: 0,
				Round:  0,
				BlockID: types.BlockID{
					Hash: nil,
					PartSetHeader: types.PartSetHeader{
						Total: 0,
						Hash:  nil,
					},
				},
				Signatures: nil,
			},
		},
		ValidatorSet: &types.ValidatorSet{
			Validators: nil,
			Proposer: &types.Validator{
				Address:          nil,
				PubKey:           nil,
				VotingPower:      0,
				ProposerPriority: 0,
			},
		},
	}, args.Error(0)
}

func (p *ProviderMock) ReportEvidence(ctx context.Context, evidence types.Evidence) error {
	args := p.Called(ctx, evidence)
	return args.Error(0)
}
