package relayer

import (
	"context"
	"fmt"
	"github.com/cardano/relayer/v1/cosmjs-types/go/github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	"github.com/cardano/relayer/v1/package/services"
	"github.com/cardano/relayer/v1/package/services_mock"
	"github.com/cardano/relayer/v1/relayer/chains/cardano"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/module"
	"github.com/cardano/relayer/v1/relayer/provider"
	"github.com/cometbft/cometbft/proto/tendermint/crypto"
	cometproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proto/tendermint/version"
	tmtypes "github.com/cometbft/cometbft/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"testing"
	"time"
)

func TestCheckOuroborosMisbehavior(t *testing.T) {
	testCases := []struct {
		name           string
		proposedHeader *module.BlockData
		cachedHeader   provider.IBCHeader
		gwResponse     string
		gwErr          error
	}{
		{
			name: "cachedHeader is not nil",
			proposedHeader: &module.BlockData{
				Height: &module.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				Slot:       0,
				Hash:       "",
				PrevHash:   "",
				EpochNo:    0,
				HeaderCbor: "",
				BodyCbor:   "",
				EpochNonce: "",
				Timestamp:  0,
				ChainId:    "",
			},
			cachedHeader: provider.CardanoIBCHeader{
				CardanoBlockData: &module.BlockData{
					Height: &module.Height{
						RevisionNumber: 0,
						RevisionHeight: 0,
					},
					Slot:       0,
					Hash:       "",
					PrevHash:   "",
					EpochNo:    0,
					HeaderCbor: "",
					BodyCbor:   "",
					EpochNonce: "",
					Timestamp:  0,
					ChainId:    "",
				},
			},
			gwResponse: string([]byte{10, 0}),
		},
		{
			name: "cachedHeader is nil, not behavior",
			proposedHeader: &module.BlockData{
				Height: &module.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				Slot:       0,
				Hash:       "",
				PrevHash:   "",
				EpochNo:    0,
				HeaderCbor: "",
				BodyCbor:   "",
				EpochNonce: "",
				Timestamp:  0,
				ChainId:    "",
			},
			gwResponse: string([]byte{10, 0}),
		},
		{
			name: "cachedHeader is nil, gw err",
			proposedHeader: &module.BlockData{
				Height: &module.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				Slot:       0,
				Hash:       "",
				PrevHash:   "",
				EpochNo:    0,
				HeaderCbor: "",
				BodyCbor:   "",
				EpochNonce: "",
				Timestamp:  0,
				ChainId:    "",
			},
			gwResponse: string([]byte{10, 0}),
			gwErr:      fmt.Errorf("gwerr"),
		},
		{
			name: "misbehavior",
			proposedHeader: &module.BlockData{
				Height: &module.Height{
					RevisionNumber: 0,
					RevisionHeight: 303388,
				},
				Slot:       1214030,
				Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
				PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
				EpochNo:    2,
				HeaderCbor: "828a1a0004a11c1a0012864e582040b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7",
				BodyCbor:   "818379055e61393030383238323538323062393931353364663339653838376461656537303336323235613730",
				EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
				Timestamp:  1707122694,
				ChainId:    "42",
			},
			gwResponse: string([]byte{10, 0}),
			cachedHeader: provider.CardanoIBCHeader{
				CardanoBlockData: &module.BlockData{
					Height: &module.Height{
						RevisionNumber: 0,
						RevisionHeight: 303388,
					},
					Slot:       1214030,
					Hash:       "149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
					PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
					EpochNo:    2,
					HeaderCbor: "828a1a0004a11c1a0012864e582040b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7",
					BodyCbor:   "818379055e61393030383238323538323062393931353364663339653838376461656537303336323235613730",
					EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
					Timestamp:  1707122696,
					ChainId:    "42",
				},
			},
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(services_mock.ClientQueryService)
			mockService.On("BlockData", context.Background(),
				&types.QueryBlockDataRequest{
					Height: tc.proposedHeader.Height.RevisionHeight,
				}, []grpc.CallOption(nil)).Return(
				"type.googleapis.com/ibc.clients.cardano.v1.BlockData", tc.gwResponse, tc.gwErr)
			cc := &cardano.CardanoProvider{GateWay: services.Gateway{
				ClientQueryService: mockService,
			}}

			response, err := provider.CheckOuroborosMisbehavior(context.Background(), "", tc.proposedHeader, tc.cachedHeader, cc)
			if err != nil {
				require.Error(t, err)
			} else {
				if tc.name == "misbehavior" {
					require.NotEmpty(t, response)
				}
				if tc.name == "cachedHeader is not nil" {
					require.Empty(t, response)
				}
			}
		})
	}
}

func TestCheckTendermintMisbehaviour(t *testing.T) {
	testCases := []struct {
		name           string
		proposedHeader *tmclient.Header
		cachedHeader   provider.IBCHeader
	}{
		{
			name: "cachedHeader is nil, not misbehavior",
			proposedHeader: &tmclient.Header{
				SignedHeader: &cometproto.SignedHeader{
					Header: &cometproto.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  9,
						Time:    time.Time{},
						LastBlockId: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
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
					Commit: &cometproto.Commit{
						Height: 0,
						Round:  0,
						BlockID: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TrustedValidators: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
			},
			cachedHeader: nil,
		},
		{
			name: "cachedHeader is nil, QueryIBCHeader fail, not misbehavior",
			proposedHeader: &tmclient.Header{
				SignedHeader: &cometproto.SignedHeader{
					Header: &cometproto.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  0,
						Time:    time.Time{},
						LastBlockId: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
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
					Commit: &cometproto.Commit{
						Height: 0,
						Round:  0,
						BlockID: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TrustedValidators: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
			},
			cachedHeader: nil,
		},
		{
			name: "cachedHeader not nil, not misbehavior",
			proposedHeader: &tmclient.Header{
				SignedHeader: &cometproto.SignedHeader{
					Header: &cometproto.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  9,
						Time:    time.Time{},
						LastBlockId: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
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
					Commit: &cometproto.Commit{
						Height: 0,
						Round:  0,
						BlockID: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TrustedValidators: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
			},
			cachedHeader: provider.TendermintIBCHeader{
				SignedHeader: &tmtypes.SignedHeader{
					Header: &tmtypes.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  9,
						Time:    time.Time{},
						LastBlockID: tmtypes.BlockID{
							Hash: nil,
							PartSetHeader: tmtypes.PartSetHeader{
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
					Commit: &tmtypes.Commit{
						Height: 0,
						Round:  0,
						BlockID: tmtypes.BlockID{
							Hash: nil,
							PartSetHeader: tmtypes.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &tmtypes.ValidatorSet{
					Validators: nil,
					Proposer: &tmtypes.Validator{
						Address:          nil,
						PubKey:           nil,
						VotingPower:      0,
						ProposerPriority: 0,
					},
				},
				TrustedValidators: &tmtypes.ValidatorSet{
					Validators: nil,
					Proposer: &tmtypes.Validator{
						Address:          nil,
						PubKey:           nil,
						VotingPower:      0,
						ProposerPriority: 0,
					},
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
		},
		{
			name: "misbehavior",
			proposedHeader: &tmclient.Header{
				SignedHeader: &cometproto.SignedHeader{
					Header: &cometproto.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  9,
						Time:    time.Time{},
						LastBlockId: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: []byte{},
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &cometproto.Commit{
						Height: 0,
						Round:  0,
						BlockID: cometproto.BlockID{
							Hash: nil,
							PartSetHeader: cometproto.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
				TrustedValidators: &cometproto.ValidatorSet{
					Validators: nil,
					Proposer: &cometproto.Validator{
						Address: nil,
						PubKey: crypto.PublicKey{
							Sum: nil,
						},
						VotingPower:      0,
						ProposerPriority: 0,
					},
					TotalVotingPower: 0,
				},
			},
			cachedHeader: provider.TendermintIBCHeader{
				SignedHeader: &tmtypes.SignedHeader{
					Header: &tmtypes.Header{
						Version: version.Consensus{
							Block: 0,
							App:   0,
						},
						ChainID: "",
						Height:  9,
						Time:    time.Time{},
						LastBlockID: tmtypes.BlockID{
							Hash: nil,
							PartSetHeader: tmtypes.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						LastCommitHash:     nil,
						DataHash:           nil,
						ValidatorsHash:     nil,
						NextValidatorsHash: []byte("NextValidatorsHash"),
						ConsensusHash:      nil,
						AppHash:            nil,
						LastResultsHash:    nil,
						EvidenceHash:       nil,
						ProposerAddress:    nil,
					},
					Commit: &tmtypes.Commit{
						Height: 0,
						Round:  0,
						BlockID: tmtypes.BlockID{
							Hash: nil,
							PartSetHeader: tmtypes.PartSetHeader{
								Total: 0,
								Hash:  nil,
							},
						},
						Signatures: nil,
					},
				},
				ValidatorSet: &tmtypes.ValidatorSet{
					Validators: nil,
					Proposer: &tmtypes.Validator{
						Address:          nil,
						PubKey:           nil,
						VotingPower:      0,
						ProposerPriority: 0,
					},
				},
				TrustedValidators: &tmtypes.ValidatorSet{
					Validators: nil,
					Proposer: &tmtypes.Validator{
						Address:          nil,
						PubKey:           nil,
						VotingPower:      0,
						ProposerPriority: 0,
					},
				},
				TrustedHeight: clienttypes.Height{
					RevisionNumber: 0,
					RevisionHeight: 0,
				},
			},
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			mockService := new(ProviderMock)
			mockService.On("LightBlock", context.Background(), tc.proposedHeader.Header.Height).Return(nil)
			cc := cosmos.CosmosProvider{LightProvider: mockService}
			response, err := provider.CheckTendermintMisbehaviour(context.Background(),
				"clientId", tc.proposedHeader, tc.cachedHeader, &cc)
			if tc.proposedHeader.Header.Height == 0 {
				require.Error(t, err)
			}
			if tc.name == "misbehavior" {
				require.NotEmpty(t, response)
			} else {
				require.Empty(t, response)

			}
		})
	}
}
