package cardano_test

import (
	fmt "fmt"
	cardano "sidechain/x/clients/cardano"
	"strings"
	"time"

	storetypes "cosmossdk.io/store/types"
	"github.com/cosmos/cosmos-sdk/codec"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	tmStruct "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
	ibctesting "github.com/cosmos/ibc-go/v8/testing"
	"github.com/fxamacker/cbor/v2"
)

func (suite *CardanoTestSuite) TestVerifyMembership() {
	var (
		path               *ibctesting.Path
		clientState        *cardano.ClientState
		proof              []byte
		expectedValueBytes []byte
		merklePath         exported.Path
	)
	// var defaultTimeoutHeight = clienttypes.NewHeight(1, 100000)

	// cardano height
	height := cardano.NewHeight(0, 303387)
	txHashDummy := strings.ToLower("txHashDummy")
	clientIdDummy := strings.ToLower("clientIdDummy")
	txIndexDummy := 0
	testCases := []struct {
		name     string
		malleate func(clientStore storetypes.KVStore, cdc codec.BinaryCodec)
		expPass  bool
	}{
		{"Verify Client state", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOClientStatePrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)

			// Prepare data
			trustLevel := tmStruct.DefaultTrustLevel
			latestHeight := clienttypes.Height{
				RevisionNumber: 0,
				RevisionHeight: 10,
			}
			proofSpecs := commitmenttypes.GetSDKSpecs()
			upgradePath := []string{}
			expectedClientState := tmStruct.NewClientState(chainID, trustLevel, trustingPeriod, ubdPeriod, maxClockDrift, latestHeight, proofSpecs, upgradePath)
			expectedValueBytes, _ = cdc.MarshalInterface(expectedClientState)

			proofDataClientState := cardano.ClientStateDatum{
				ChainId: []byte(chainID),
				TrustLevel: cardano.TrustLevelDatum{
					Denominator: trustLevel.Denominator,
					Numerator:   trustLevel.Numerator,
				},
				TrustingPeriod:  uint64(trustingPeriod),
				UnbondingPeriod: uint64(ubdPeriod),
				MaxClockDrift:   uint64(maxClockDrift),
				FrozenHeight:    cardano.HeightDatum{},
				LatestHeight: cardano.HeightDatum{
					RevisionNumber: latestHeight.RevisionNumber,
					RevisionHeight: latestHeight.RevisionHeight,
				},
			}
			proofDataInStore, _ := cbor.Marshal(proofDataClientState)
			clientStore.Set([]byte(utxoKey), proofDataInStore)

			// update merkle path
			merklePathClientState := commitmenttypes.NewMerklePath(host.FullClientStatePath(clientIdDummy))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathClientState, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathClientState)
			suite.Require().NoError(err)
			merklePath = merklePathClientState

		}, true},
		{"Verify Consensus state", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOConsensusStatePrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)

			// Prepare data
			consensusTimestamp := time.Time{}
			nextValsHash := []byte("dummy nextValsHash")
			rootHash := commitmenttypes.MerkleRoot{
				Hash: []byte("dummy rootHash"),
			}

			expectedConsensusState := tmStruct.NewConsensusState(consensusTimestamp, rootHash, nextValsHash)
			expectedValueBytes, _ = cdc.MarshalInterface(expectedConsensusState)

			proofConsensusState := cardano.ConsensusStateDatum{
				Timestamp:          uint64(consensusTimestamp.UnixNano()),
				NextValidatorsHash: nextValsHash,
				Root: cardano.RootHashInDatum{
					Hash: rootHash.Hash,
				},
			}
			proofDataInStore, _ := cbor.Marshal(proofConsensusState)
			keyAppend := []byte(fmt.Sprintf("/%s", height))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)

			// update merkle path
			merklePathConsensusState := commitmenttypes.NewMerklePath(host.FullConsensusStatePath(clientIdDummy, height))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathConsensusState, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathConsensusState)
			suite.Require().NoError(err)
			merklePath = merklePathConsensusState
		}, true},
		{"Verify Connection state", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOConnectionStatePrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)

			// Prepare data
			delayPeriod := uint64(60000) // dummy delay period
			connectionCounterpartyVersions := connectiontypes.GetCompatibleVersions()
			k := suite.chainA.App.GetIBCKeeper().ConnectionKeeper
			prefix := k.GetCommitmentPrefix()
			connectionStateConnectionID := ""
			expectedConnectionCounterparty := connectiontypes.NewCounterparty(clientID, connectionStateConnectionID, commitmenttypes.NewMerklePrefix(prefix.Bytes()))
			expectedConnectionEnd := connectiontypes.NewConnectionEnd(connectiontypes.INIT, expectedConnectionCounterparty.ClientId, expectedConnectionCounterparty, connectionCounterpartyVersions, delayPeriod)
			expectedValueBytes, _ = cdc.Marshal(&expectedConnectionEnd)

			var datumVersions []cardano.VersionDatum
			for i, versionValue := range connectionCounterpartyVersions {
				var features [][]byte
				for _, feature := range connectionCounterpartyVersions[i].Features {
					features = append(features, []byte(feature))
				}
				datumVersions = append(datumVersions, cardano.VersionDatum{
					Identifier: []byte(versionValue.Identifier),
					Features:   features,
				})
			}

			proofConnectionEndDatum := cardano.ConnectionEndDatum{
				ClientId: []byte(clientID),
				Versions: datumVersions,
				State: cbor.Tag{
					Number: uint64(connectiontypes.INIT) + cardano.CBOR_TAG_MAGIC_NUMBER,
				},
				Counterparty: cardano.CounterpartyDatum{
					ClientId:     []byte(clientID),
					ConnectionId: []byte(connectionStateConnectionID),
					Prefix: cardano.MerklePrefixDatum{
						KeyPrefix: prefix.Bytes(),
					},
				},
				DelayPeriod: delayPeriod,
			}
			proofDataInStore, _ := cbor.Marshal(proofConnectionEndDatum)
			clientStore.Set([]byte(utxoKey), proofDataInStore)

			// update merkle path
			merklePathConnectionState := commitmenttypes.NewMerklePath(host.ConnectionPath(connectionStateConnectionID))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathConnectionState, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathConnectionState)
			suite.Require().NoError(err)
			merklePath = merklePathConnectionState
		}, true},
		{"Verify Channel state", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOChannelStatePrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)

			// Prepare data

			channelPortID := "dummychannelportid"
			channelConnectionID := "dummychannelconnectionid"
			channelCounterpartyChannelId := "channel-123"
			channelCounterpartyHops := []string{channelConnectionID}
			channelState := channeltypes.INIT
			order := channeltypes.ORDERED
			channelCounterpartyVersion := "ics20-1"

			expectedCounterparty := channeltypes.NewCounterparty(channelPortID, channelCounterpartyChannelId)
			expectedChannelValue := channeltypes.NewChannel(
				channelState, order, expectedCounterparty,
				channelCounterpartyHops, channelCounterpartyVersion,
			)
			expectedValueBytes, _ = cdc.Marshal(&expectedChannelValue)

			var connectionHops [][]byte
			for _, hop := range channelCounterpartyHops {
				connectionHops = append(connectionHops, []byte(hop))
			}
			proofChannelData := cardano.ChannelDatum{
				State: cbor.Tag{
					Number: uint64(channelState) + cardano.CBOR_TAG_MAGIC_NUMBER,
				},
				Ordering: cbor.Tag{
					Number: uint64(order) + cardano.CBOR_TAG_MAGIC_NUMBER,
				},
				Counterparty: cardano.ChannelCounterpartyDatum{
					PortId:    []byte(channelPortID),
					ChannelId: []byte(channelCounterpartyChannelId),
				},
				ConnectionHops: connectionHops,
				Version:        []byte(channelCounterpartyVersion),
			}
			proofDataInStore, _ := cbor.Marshal(proofChannelData)
			keyAppend := []byte(fmt.Sprintf("/%s/%s", channelPortID, channelCounterpartyChannelId))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)

			// update merkle path
			// connection := path.EndpointB.GetConnection()
			merklePathChannelState := commitmenttypes.NewMerklePath(host.ChannelPath(channelPortID, channelCounterpartyChannelId))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathChannelState, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathChannelState)
			suite.Require().NoError(err)
			merklePath = merklePathChannelState
		}, true},
		{"Verify Commitments", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOPacketCommitmentPrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			channelPortID := "dummychannelportid"
			channelCounterpartyChannelId := "channel-123"

			// Prepare data
			sequence := uint64(0) // default sequence - sequence after sent packet to chainA

			merklePathCommitment := commitmenttypes.NewMerklePath(host.PacketCommitmentPath(channelPortID, channelCounterpartyChannelId, sequence))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathCommitment, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathCommitment)
			suite.Require().NoError(err)
			merklePath = merklePathCommitment

			proofDataInStore := []byte("proofPacketCommitmentData")
			expectedValueBytes = proofDataInStore
			keyAppend := []byte(fmt.Sprintf("/%s/%s/%v", channelPortID, channelCounterpartyChannelId, sequence))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)
			// clientStore.Set([]byte(utxoKey), proofDataInStore)

		}, true},
		{"Verify Acks", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOPacketAcksPrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			channelPortID := "dummychannelportid"
			channelCounterpartyChannelId := "channel-123"

			// Prepare data
			sequence := uint64(0) // default sequence - sequence after sent packet to chainA

			merklePathAck := commitmenttypes.NewMerklePath(host.PacketCommitmentPath(channelPortID, channelCounterpartyChannelId, sequence))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathAck, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathAck)
			suite.Require().NoError(err)
			merklePath = merklePathAck

			proofDataInStore := []byte("proofPacketAckData")
			expectedValueBytes = proofDataInStore
			keyAppend := []byte(fmt.Sprintf("/%s/%s/%v", channelPortID, channelCounterpartyChannelId, sequence))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)
		}, true},
		{"Verify Next Sequence Recv", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXONextSequenceRecvPrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			channelPortID := "dummychannelportid"
			channelCounterpartyChannelId := "channel-123"

			merklePathSequenceReceipt := commitmenttypes.NewMerklePath(host.NextSequenceRecvPath(channelPortID, channelCounterpartyChannelId))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathSequenceReceipt, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathSequenceReceipt)
			suite.Require().NoError(err)
			merklePath = merklePathSequenceReceipt

			proofDataInStore := []byte("proofPacketSequenceReceiptData")
			expectedValueBytes = proofDataInStore
			keyAppend := []byte(fmt.Sprintf("/%s/%s", channelPortID, channelCounterpartyChannelId))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)
		}, true},
		{"Not implemented", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, "dummy", txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			expectedValueBytes = []byte("dummy bytes")

		}, false},
		{"Height greater", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, "dummy", txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			expectedValueBytes = []byte("dummy bytes")
			height = cardano.NewHeight(0, 303388)

		}, false},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState = path.EndpointA.GetClientState().(*cardano.ClientState)
			cdc := suite.chainA.Codec

			tc.malleate(clientStore, cdc)

			err := clientState.VerifyMembership(suite.chainA.GetContext(), clientStore, cdc, height, ibctesting.DefaultDelayPeriod, ibctesting.DefaultDelayPeriod, proof, merklePath, expectedValueBytes)
			if tc.expPass {
				suite.Require().NoError(err, tc.name)
			} else {
				suite.Require().Error(err)
			}

		})

	}
}

func (suite *CardanoTestSuite) TestVerifyNonMembership() {
	var (
		path        *ibctesting.Path
		clientState *cardano.ClientState
		proof       []byte
		merklePath  exported.Path
	)

	height := cardano.NewHeight(0, 303387)
	txHashDummy := strings.ToLower("txHashDummy")
	txIndexDummy := 0
	testCases := []struct {
		name     string
		malleate func(clientStore storetypes.KVStore, cdc codec.BinaryCodec)
		expPass  bool
	}{
		{"Verify Packet Receipt Absence: Should success", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOPacketReceiptsPrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			channelPortID := "dummychannelportid"
			channelCounterpartyChannelId := "channel-123"
			sequence := uint64(0)
			// fake channel
			utxoChannelKey := []byte(cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOChannelStatePrefix, txHashDummy, fmt.Sprint(txIndexDummy)) + "/" + channelPortID + "/" + channelCounterpartyChannelId)
			clientStore.Set(utxoChannelKey, []byte{1})
			// update merkle path
			merklePathPacketReceipt := commitmenttypes.NewMerklePath(host.PacketReceiptPath(channelPortID, channelCounterpartyChannelId, sequence))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathPacketReceipt, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathPacketReceipt)
			suite.Require().NoError(err)
			merklePath = merklePathPacketReceipt

		}, true},
		{"Verify Packet Receipt Absence: Path existed", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, cardano.KeyUTXOPacketReceiptsPrefix, txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			channelPortID := "dummychannelportid"
			channelCounterpartyChannelId := "channel-123"
			sequence := uint64(0)

			// update merkle path
			merklePathPacketReceipt := commitmenttypes.NewMerklePath(host.PacketReceiptPath(channelPortID, channelCounterpartyChannelId, sequence))
			commitmentPrefix := commitmenttypes.NewMerklePrefix([]byte("ibc"))
			merklePathPacketReceipt, err := commitmenttypes.ApplyPrefix(commitmentPrefix, merklePathPacketReceipt)
			suite.Require().NoError(err)
			merklePath = merklePathPacketReceipt

			proofDataInStore := []byte("dummyByte")
			keyAppend := []byte(fmt.Sprintf("/%s/%s/%v", channelPortID, channelCounterpartyChannelId, sequence))
			clientStore.Set(append([]byte(utxoKey), keyAppend...), proofDataInStore)
		}, false},
		{"Not implemented", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, "dummy", txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)

		}, false},
		{"Height greater", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, "dummy", txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			height = cardano.NewHeight(0, 303388)

		}, false},
		{"Consensus not found", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			utxoKey := cardano.ClientUTXOIBCPath(height, "dummy", txHashDummy, fmt.Sprint(txIndexDummy))
			proofKey := strings.ReplaceAll(utxoKey, cardano.KeyUTXOsPrefix+"/", "")
			proof = []byte(proofKey)
			height = cardano.NewHeight(0, 303386)

		}, false},
		{"Proof is nil", func(clientStore storetypes.KVStore, cdc codec.BinaryCodec) {
			height = cardano.NewHeight(0, 303387)
			proof = nil
		}, false},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState = path.EndpointA.GetClientState().(*cardano.ClientState)
			cdc := suite.chainA.Codec

			tc.malleate(clientStore, cdc)

			err := clientState.VerifyNonMembership(suite.chainA.GetContext(), clientStore, cdc, height, ibctesting.DefaultDelayPeriod, ibctesting.DefaultDelayPeriod, proof, merklePath)
			if tc.expPass {
				suite.Require().NoError(err, tc.name)
			} else {
				suite.Require().Error(err)
			}

		})

	}
}
