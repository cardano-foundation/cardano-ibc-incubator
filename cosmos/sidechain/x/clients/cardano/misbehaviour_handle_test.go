package cardano_test

import (
	cardano "sidechain/x/clients/cardano"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	ibctesting "github.com/cosmos/ibc-go/v8/testing"
)

func NewUpdateBlockData() *cardano.BlockData {
	return &cardano.BlockData{
		Height: &cardano.Height{
			RevisionNumber: 0,
			RevisionHeight: 303388,
		},
		Slot:       1214030,
		Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
		PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
		EpochNo:    3,
		HeaderCbor: headerCbor,
		BodyCbor:   bodyCbor,
		EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
		Timestamp:  1707122694,
		ChainId:    chainID,
	}
}

func (suite *CardanoTestSuite) TestVerifyMisbehaviour() {
	blockDataUpdate := NewUpdateBlockData()
	var clientState exported.ClientState
	var (
		path         *ibctesting.Path
		misbehaviour exported.ClientMessage
	)

	testCases := []struct {
		name     string
		malleate func()
		expPass  bool
	}{
		{
			"valid fork misbehaviour", func() {
				misbehaviour = &cardano.Misbehaviour{
					BlockData1: NewUpdateBlockData(),
					BlockData2: NewUpdateBlockData(),
				}
			},
			true,
		},
		{
			"Not found Blockdata1 consensus state", func() {
				blockData := NewUpdateBlockData()
				blockData.Height.RevisionHeight += 10
				misbehaviour = &cardano.Misbehaviour{
					BlockData1: blockData,
					BlockData2: NewUpdateBlockData(),
				}
			},
			false,
		},
		{
			"Not found Blockdata2 consensus state", func() {
				blockData := NewUpdateBlockData()
				blockData.Height.RevisionHeight += 10
				misbehaviour = &cardano.Misbehaviour{
					BlockData1: NewUpdateBlockData(),
					BlockData2: blockData,
				}
			},
			false,
		},
		{
			"CheckMisbehaviourBlockData Block1 invalid", func() {
				blockData := NewUpdateBlockData()
				blockData.Slot += 1
				misbehaviour = &cardano.Misbehaviour{
					BlockData1: blockData,
					BlockData2: NewUpdateBlockData(),
				}
			},
			false,
		},
		{
			"CheckMisbehaviourBlockData Block2 invalid", func() {
				blockData := NewUpdateBlockData()
				blockData.BodyCbor = "80"
				misbehaviour = &cardano.Misbehaviour{
					BlockData1: NewUpdateBlockData(),
					BlockData2: blockData,
				}
			},
			false,
		},
	}

	for _, tc := range testCases {
		tc := tc

		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			clientState = path.EndpointA.GetClientState()
			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)

			tc.malleate()

			err := clientState.VerifyClientMessage(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, misbehaviour)

			if tc.expPass {
				suite.Require().NoError(err)
			} else {
				suite.Require().Error(err)
			}
		})
	}
}

func (suite *CardanoTestSuite) TestCheckForMisbehaviour() {
	blockDataUpdate := NewUpdateBlockData()
	var clientState exported.ClientState
	var clientStore storetypes.KVStore
	var (
		path         *ibctesting.Path
		misbehaviour exported.ClientMessage
	)

	testCases := []struct {
		name           string
		malleate       func()
		expMisbehavior bool
	}{
		{
			"BlockData: valid", func() {
				misbehaviour = blockDataUpdate
			},
			false,
		},
		{
			"BlockData: consensus found and equal", func() {
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				misbehaviour = blockDataUpdate
			},
			false,
		},
		{
			"BlockData: consensus found and not equal", func() {
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				tmpBlock := NewUpdateBlockData()
				tmpBlock.Slot += 1
				misbehaviour = tmpBlock
			},
			true,
		},
		{
			"Misbehaviour: Height equal and hash equal", func() {
				misbehaviour = cardano.NewMisbehaviour(clientID, NewUpdateBlockData(), NewUpdateBlockData())
			},
			false,
		},
		{
			"Misbehaviour: Height equal and hash not equal", func() {
				blockData := NewUpdateBlockData()
				blockData.Hash = "dummybash"
				misbehaviour = cardano.NewMisbehaviour(clientID, blockData, NewUpdateBlockData())
			},
			true,
		},
		{
			"Misbehaviour: Height not equal, valid", func() {
				blockData := NewUpdateBlockData()
				blockData.Height.RevisionHeight += 1
				blockData.Timestamp += 1
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockData)
				misbehaviour = cardano.NewMisbehaviour(clientID, blockData, NewUpdateBlockData())
			},
			false,
		},
		{
			"Misbehaviour: Height not equal, Block1 not after Block2", func() {
				blockData := NewUpdateBlockData()
				blockData.Height.RevisionHeight += 1
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockData)
				misbehaviour = cardano.NewMisbehaviour(clientID, blockData, NewUpdateBlockData())
			},
			true,
		},
		{
			"Misbehaviour: Height not equal, Consensus Exist, but not equal", func() {
				blockData := NewUpdateBlockData()
				blockData.Height.RevisionHeight += 1
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockData)
				blockData.Slot += 1
				misbehaviour = cardano.NewMisbehaviour(clientID, blockData, NewUpdateBlockData())
			},
			true,
		},
		{
			"Misbehaviour: Height not equal, Consensus not Exist", func() {
				blockData := NewUpdateBlockData()
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockDataUpdate)
				clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, blockData)
				blockData.Height.RevisionHeight += 1
				misbehaviour = cardano.NewMisbehaviour(clientID, blockData, NewUpdateBlockData())
			},
			true,
		},
	}

	for _, tc := range testCases {
		tc := tc

		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			clientState = path.EndpointA.GetClientState()
			clientStore = suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)

			tc.malleate()

			res := clientState.CheckForMisbehaviour(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, misbehaviour)

			suite.Require().Equal(tc.expMisbehavior, res)
		})
	}
}
