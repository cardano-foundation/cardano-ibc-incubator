package cardano_test

import (
	"encoding/hex"
	"github.com/blinklabs-io/gouroboros/ledger"
	cardano "sidechain/x/clients/cardano"
	"time"

	ibctesting "github.com/cosmos/ibc-go/v8/testing"
	"github.com/fxamacker/cbor/v2"
)

func (suite *CardanoTestSuite) TestTryMatchAndSaveIBCType() {
	var (
		path         *ibctesting.Path
		tokenConfigs cardano.TokenConfigs
		utxo         ledger.UTXOOutput
	)

	testCases := []struct {
		name      string
		malleate  func()
		expOutput string
	}{
		{
			name: "successful match clientToken",
			malleate: func() {
				mapConsensusStates := map[cardano.HeightDatum]cardano.ConsensusStateDatum{
					cardano.HeightDatum{RevisionNumber: 0, RevisionHeight: 1}: cardano.ConsensusStateDatum{Timestamp: 1111111, NextValidatorsHash: []byte("NextValidatorsHash1"), Root: cardano.RootHashInDatum{Hash: []byte("RootHashInDatum1")}},
				}
				clientDatum := cardano.ClientDatum{
					State: cardano.ClientDatumState{
						ConsensusStates: mapConsensusStates,
					},
					Token: cardano.TokenDatum{
						PolicyId: []byte("dummy PolicyId"),
						Name:     []byte("dummy Name"),
					},
				}
				clientDatumBytes, _ := cbor.Marshal(clientDatum)
				utxo = ledger.UTXOOutput{
					TxHash:      "124ba9d050c2ba4879f402ff0da8ed99c8b38d5aaa99fcca4b8fe6ad54f8f94d",
					OutputIndex: "0",
					Tokens: []ledger.UTXOOutputToken{
						{TokenAssetName: "lovelace", TokenValue: "1"},
						{TokenAssetName: tokenConfigs.ClientPolicyId + cardano.IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, cardano.KeyUTXOClientStateTokenPrefix) + "31", TokenValue: "1"},
					},
					DatumHex: hex.EncodeToString(clientDatumBytes),
				}
			},
			expOutput: cardano.KeyUTXOClientStatePrefix,
		},
		{
			name: "successful match connectionToken",
			malleate: func() {
				connectionDatum := cardano.ConnectionDatum{
					State: cardano.ConnectionEndDatum{
						ClientId: []byte("ClientId"),
						Versions: []cardano.VersionDatum{},
						State: cbor.Tag{
							Number: 121,
						},
						Counterparty: cardano.CounterpartyDatum{
							ClientId:     []byte("Counterparty ClientId"),
							ConnectionId: []byte("Counterparty ConnectionId"),
							Prefix:       cardano.MerklePrefixDatum{KeyPrefix: []byte("MerklePrefixDatum")},
						},
						DelayPeriod: 0,
					},
					Token: cardano.TokenDatum{
						PolicyId: []byte("dummy PolicyId"),
						Name:     []byte("dummy Name"),
					},
				}
				connectionDatumBytes, _ := cbor.Marshal(connectionDatum)
				utxo = ledger.UTXOOutput{
					TxHash:      "124ba9d050c2ba4879f402ff0da8ed99c8b38d5aaa99fcca4b8fe6ad54f8f94d",
					OutputIndex: "0",
					Tokens: []ledger.UTXOOutputToken{
						{TokenAssetName: "lovelace", TokenValue: "1"},
						{TokenAssetName: tokenConfigs.ConnectionPolicyId + cardano.IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, cardano.KeyUTXOConnectionStatePrefix) + "31", TokenValue: "1"},
					},
					DatumHex: hex.EncodeToString(connectionDatumBytes),
				}
			},
			expOutput: cardano.KeyUTXOConnectionStatePrefix,
		},
		{
			name: "successful match channelToken",
			malleate: func() {
				channelDatum := cardano.ChannelDatum{
					State: cbor.Tag{
						Number: 121,
					},
					Ordering: cbor.Tag{
						Number: 121,
					},
					Counterparty: cardano.ChannelCounterpartyDatum{},
					ConnectionHops: [][]byte{
						[]byte("ConnectionHops1"),
						[]byte("ConnectionHops2"),
					},
					Version: []byte("Version"),
				}
				channelDatumState := cardano.ChannelDatumState{
					Channel:          channelDatum,
					NextSequenceSend: 2,
					NextSequenceRecv: 1,
					NextSequenceAck:  1,
					PacketCommitment: map[uint64][]byte{
						0: []byte("dummy PacketCommitment 0"),
						1: []byte("dummy PacketCommitment 1"),
					},
					PacketReceipt: map[uint64][]byte{
						0: []byte("dummy PacketReceipt 0"),
					},
					PacketAcknowledgement: map[uint64][]byte{
						0: []byte("dummy PacketAcknowledgement 0"),
					},
				}
				channelDatumWithPort := cardano.ChannelDatumWithPort{
					State:  channelDatumState,
					PortId: []byte("dummy-port"),
					Token: cardano.TokenDatum{
						PolicyId: []byte(tokenConfigs.ConnectionPolicyId),
						Name:     []byte(cardano.IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, cardano.KeyUTXOChannelStatePrefix) + "31"),
					},
				}
				channelDatumBytes, _ := cbor.Marshal(channelDatumWithPort)
				utxo = ledger.UTXOOutput{
					TxHash:      "124ba9d050c2ba4879f402ff0da8ed99c8b38d5aaa99fcca4b8fe6ad54f8f94d",
					OutputIndex: "0",
					Tokens: []ledger.UTXOOutputToken{
						{TokenAssetName: "lovelace", TokenValue: "1"},
						{TokenAssetName: tokenConfigs.ConnectionPolicyId + cardano.IBCTokenPrefix(tokenConfigs.HandlerTokenUnit, cardano.KeyUTXOChannelStatePrefix) + "31", TokenValue: "1"},
					},
					DatumHex: hex.EncodeToString(channelDatumBytes),
				}
			},
			expOutput: cardano.KeyUTXOChannelStatePrefix,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			tc.malleate()

			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			actualOutput := cardano.TryMatchAndSaveIBCType(suite.chainA.GetContext(), utxo, tokenConfigs, clientStore, cardano.Height{RevisionNumber: 0, RevisionHeight: 5})
			suite.Require().Equal(tc.expOutput, actualOutput)
		})
	}
}

func (suite *CardanoTestSuite) TestGetNeighboringConsensusStates() {
	cs01 := cardano.NewConsensusState(uint64(time.Now().UTC().UnixNano()), 1)
	cs04 := cardano.NewConsensusState(uint64(time.Now().UTC().UnixNano()), 4)
	cs49 := cardano.NewConsensusState(uint64(time.Now().UTC().UnixNano()), 9)
	height01 := cardano.NewHeight(0, 1)
	height04 := cardano.NewHeight(0, 4)
	height49 := cardano.NewHeight(4, 9)

	// Set iteration keys and consensus states
	cardano.SetIterationKey(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), height01)
	suite.chainA.App.GetIBCKeeper().ClientKeeper.SetClientConsensusState(suite.chainA.GetContext(), "testClient", height01, cs01)
	cardano.SetIterationKey(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), height04)
	suite.chainA.App.GetIBCKeeper().ClientKeeper.SetClientConsensusState(suite.chainA.GetContext(), "testClient", height04, cs04)
	cardano.SetIterationKey(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), height49)
	suite.chainA.App.GetIBCKeeper().ClientKeeper.SetClientConsensusState(suite.chainA.GetContext(), "testClient", height49, cs49)

	prevCs01, ok := cardano.GetPreviousConsensusState(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), suite.chainA.Codec, height01)
	suite.Require().Nil(prevCs01, "consensus state exists before lowest consensus state")
	suite.Require().False(ok)
	prevCs49, ok := cardano.GetPreviousConsensusState(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), suite.chainA.Codec, height49)
	suite.Require().Equal(cs04, prevCs49, "previous consensus state is not returned correctly")
	suite.Require().True(ok)

	nextCs01, ok := cardano.GetNextConsensusState(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), suite.chainA.Codec, height01)
	suite.Require().Equal(cs04, nextCs01, "next consensus state not returned correctly")
	suite.Require().True(ok)
	nextCs49, ok := cardano.GetNextConsensusState(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), "testClient"), suite.chainA.Codec, height49)
	suite.Require().Nil(nextCs49, "next consensus state exists after highest consensus state")
	suite.Require().False(ok)
}

func (suite *CardanoTestSuite) TestGetSetClientSPOs() {
	var (
		path *ibctesting.Path
	)
	suite.SetupTest()

	path = NewPath(suite.chainA, suite.chainB)
	SetupCardanoClientInCosmos(suite.coordinator, path)
	clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
	cardano.UpdateRegisterCert(clientStore, []ledger.RegisCert{
		{RegisPoolId: "pool1", RegisPoolVrf: "pool1Vrf1"}, {RegisPoolId: "pool2", RegisPoolVrf: "pool2Vrf1"}, {RegisPoolId: "pool3", RegisPoolVrf: "pool3Vrf1"},
	}, 3, 303387)

	cardano.UpdateUnregisterCert(clientStore, []ledger.DeRegisCert{
		{DeRegisPoolId: "pool1", DeRegisEpoch: "1"}, {DeRegisPoolId: "pool2", DeRegisEpoch: "1"},
	}, 303387)
	valSet := cardano.CalValidatorsNewEpoch(clientStore, 2, 3)
	suite.Require().Equal(2, len(valSet))
	heightTest := cardano.Height{
		RevisionNumber: 0,
		RevisionHeight: 303387,
	}
	_, found := cardano.GetProcessedHeight(clientStore, heightTest)
	suite.Require().True(found)
}
