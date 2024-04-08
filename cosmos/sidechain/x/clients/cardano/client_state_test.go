package cardano_test

import (
	fmt "fmt"
	"sidechain/x/clients/cardano"
	"time"

	host "github.com/cosmos/ibc-go/v8/modules/core/24-host"
	"github.com/fxamacker/cbor/v2"

	"github.com/stretchr/testify/require"

	"github.com/cosmos/cosmos-sdk/codec"
	ibctesting "github.com/cosmos/ibc-go/v8/testing"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	tmStruct "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
)

const (
	// Do not change the length of these variables
	fiftyCharChainID    = "12345678901234567890123456789012345678901234567890"
	fiftyOneCharChainID = "123456789012345678901234567890123456789012345678901"
)

var invalidProof = []byte("invalid proof")

func (suite *CardanoTestSuite) TestStatus() {
	var (
		path        *ibctesting.Path
		clientState *cardano.ClientState
	)

	testCases := []struct {
		name      string
		malleate  func()
		expStatus exported.Status
	}{
		{"client is active", func() {}, exported.Active},
		{"client is frozen", func() {
			clientState.FrozenHeight = &cardano.Height{
				RevisionNumber: 0,
				RevisionHeight: 1,
			}
			path.EndpointA.SetClientState(clientState)
		}, exported.Frozen},
		{"client status without consensus state", func() {
			newHeight := clientState.LatestHeight.Increment()
			clientState.LatestHeight = &cardano.Height{
				RevisionNumber: newHeight.GetRevisionNumber(),
				RevisionHeight: newClientHeight.GetRevisionHeight() + 1,
			}
			path.EndpointA.SetClientState(clientState)
		}, exported.Expired},
		// {"client status is expired", func() {
		// 	suite.coordinator.IncrementTimeBy(clientState.TrustingPeriod)
		// }, exported.Expired},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)
			// suite.coordinator.SetupClients(path)

			clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState = path.EndpointA.GetClientState().(*cardano.ClientState)

			tc.malleate()

			status := clientState.Status(suite.chainA.GetContext(), clientStore, suite.chainA.App.AppCodec())
			suite.Require().Equal(tc.expStatus, status)
		})

	}
}

func CreateClientCardano(endpoint *ibctesting.Endpoint) (err error) {
	// ensure counterparty has committed state
	endpoint.Counterparty.Chain.NextBlock()

	var (
		clientState    exported.ClientState
		consensusState exported.ConsensusState
	)

	switch endpoint.ClientConfig.GetClientType() {
	case cardano.ModuleName:
		// tmConfig, ok := endpoint.ClientConfig.(*TendermintConfig)
		// require.True(endpoint.Chain.TB, ok)

		// height := endpoint.Counterparty.Chain.LastHeader.GetHeight().(clienttypes.Height)
		clientState = &cardano.ClientState{
			ChainId: "1",
			LatestHeight: &cardano.Height{
				RevisionNumber: 0,
				RevisionHeight: 303387,
			},
			FrozenHeight: &cardano.Height{
				RevisionNumber: 0,
				RevisionHeight: 0,
			},
			ValidAfter:       7200,
			GenesisTime:      1705895324,
			CurrentEpoch:     2,
			EpochLength:      423000,
			SlotPerKesPeriod: 129600,
			CurrentValidatorSet: []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}},
			NextValidatorSet: []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}},
			TrustingPeriod: 950400,
			UpgradePath:    []string{},
			TokenConfigs: &cardano.TokenConfigs{
				HandlerTokenUnit:   "fe912a0d634c0901850f70fed4612f967e5b9074b3033d7e2085109a68616e646c6572",
				ClientPolicyId:     "592de1385d612694eed18d767901c4731b34663e6aec79beaca88dab",
				ConnectionPolicyId: "",
				ChannelPolicyId:    "",
			},
		}
		consensusState = &cardano.ConsensusState{
			Timestamp: 1707122673,
			Slot:      1214009,
		}
	default:
		err = fmt.Errorf("client type %s is not supported", endpoint.ClientConfig.GetClientType())
	}

	if err != nil {
		return err
	}

	msg, err := clienttypes.NewMsgCreateClient(
		clientState, consensusState, endpoint.Chain.SenderAccount.GetAddress().String(),
	)
	require.NoError(endpoint.Chain.TB, err)

	res, err := endpoint.Chain.SendMsgs(msg)
	if err != nil {
		return err
	}

	endpoint.ClientID, err = ibctesting.ParseClientIDFromEvents(res.Events)
	require.NoError(endpoint.Chain.TB, err)

	return nil
}

func SetupCardanoClientInCosmos(coord *ibctesting.Coordinator, path *ibctesting.Path) {
	err := CreateClientCardano(path.EndpointA)
	require.NoError(coord.T, err)

	err = path.EndpointB.CreateClient()
	require.NoError(coord.T, err)
}

func (suite *CardanoTestSuite) TestGetTimestampAtHeight() {
	var (
		path   *ibctesting.Path
		height exported.Height
	)
	expectedTimestamp := time.Unix(1, 0)

	testCases := []struct {
		name     string
		malleate func()
		expErr   error
	}{
		{
			"success",
			func() {},
			nil,
		},
		{
			"failure: consensus state not found for height",
			func() {
				clientState := path.EndpointA.GetClientState()
				height = clientState.GetLatestHeight().Increment()
			},
			clienttypes.ErrConsensusStateNotFound,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()

			path = NewPath(suite.chainA, suite.chainB)
			SetupCardanoClientInCosmos(suite.coordinator, path)

			clientState := path.EndpointA.GetClientState()
			height = clientState.GetLatestHeight()

			store := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)

			// grab consensusState from store and update with a predefined timestamp
			consensusState := path.EndpointA.GetConsensusState(height)
			cardanoConsensusState, ok := consensusState.(*cardano.ConsensusState)
			suite.Require().True(ok)

			cardanoConsensusState.Timestamp = uint64(expectedTimestamp.Unix())
			path.EndpointA.SetConsensusState(cardanoConsensusState, height)

			tc.malleate()

			timestamp, err := clientState.GetTimestampAtHeight(suite.chainA.GetContext(), store, suite.chainA.Codec, height)

			expPass := tc.expErr == nil
			if expPass {
				suite.Require().NoError(err)

				expectedTimestamp := uint64(expectedTimestamp.UnixNano())
				suite.Require().Equal(expectedTimestamp, timestamp)
			} else {
				suite.Require().ErrorIs(err, tc.expErr)
			}
		})
	}
}

func (suite *CardanoTestSuite) TestValidate() {
	testCases := []struct {
		name        string
		clientState *cardano.ClientState
		expPass     bool
	}{
		{
			name: "valid client",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: true,
		},
		{
			name: "valid client with nil upgrade path",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, nil, &cardano.TokenConfigs{}),
			expPass: true,
		},
		{
			name: "invalid chainID",
			clientState: cardano.NewClientState("  ", &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "invalid chainID - chainID validation did not fail for chainID of length 51! ",
			clientState: cardano.NewClientState(fiftyOneCharChainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "invalid zero trusting period",
			clientState: cardano.NewClientState(fiftyOneCharChainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 0, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "invalid revision number",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 1, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "invalid revision height",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 0}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "epoch length == 0",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 0, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "slot per kes period == 0",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 0, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{}),
			expPass: false,
		},
		{
			name: "upgrade path item empty",
			clientState: cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{"test", "", "path"}, &cardano.TokenConfigs{}),
			expPass: false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			err := tc.clientState.Validate()
			if tc.expPass {
				suite.Require().NoError(err, tc.name)
			} else {
				suite.Require().Error(err, tc.name)
			}
		})
	}
}

func (suite *CardanoTestSuite) TestInitialize() {
	testCases := []struct {
		name           string
		consensusState exported.ConsensusState
		expPass        bool
	}{
		{
			name:           "valid consensus",
			consensusState: &cardano.ConsensusState{},
			expPass:        true,
		},
		{
			name:           "invalid consensus: consensus state is solomachine consensus",
			consensusState: ibctesting.NewSolomachine(suite.T(), suite.chainA.Codec, "solomachine", "", 2).ConsensusState(),
			expPass:        false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()
			path := NewPath(suite.chainA, suite.chainB)

			clientState := cardano.NewClientState(chainID, &cardano.Height{RevisionNumber: 0, RevisionHeight: 1}, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{})

			store := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			err := clientState.Initialize(suite.chainA.GetContext(), suite.chainA.Codec, store, tc.consensusState)

			if tc.expPass {
				suite.Require().NoError(err, "valid case returned an error")
				suite.Require().True(store.Has(host.ClientStateKey()))
				suite.Require().True(store.Has(host.ConsensusStateKey(&cardano.Height{RevisionNumber: 0, RevisionHeight: 1})))
			} else {
				suite.Require().Error(err, "invalid case didn't return an error")
				suite.Require().False(store.Has(host.ClientStateKey()))
				suite.Require().False(store.Has(host.ConsensusStateKey(&cardano.Height{RevisionNumber: 0, RevisionHeight: 1})))
			}
		})
	}
}

func (suite *CardanoTestSuite) TestVerifyProofFn() {
	proofPath := "0-10/client/124ba9d050c2ba4879f402ff0da8ed99c8b38d5aaa99fcca4b8fe6ad54f8f94d/0" // dummy path
	/////// Client State
	trustLevel := tmStruct.DefaultTrustLevel
	latestHeight := clienttypes.Height{
		RevisionNumber: 0,
		RevisionHeight: 10,
	}
	proofSpecs := commitmenttypes.GetSDKSpecs()
	upgradePath := []string{}
	expectedClientState := tmStruct.NewClientState(chainID, trustLevel, trustingPeriod, ubdPeriod, maxClockDrift, latestHeight, proofSpecs, upgradePath)
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

	/////// Consensus State
	consensusTimestamp := time.Time{}
	nextValsHash := []byte("dummy nextValsHash")
	rootHash := commitmenttypes.MerkleRoot{
		Hash: []byte("dummy rootHash"),
	}

	expectedConsensusState := tmStruct.NewConsensusState(consensusTimestamp, rootHash, nextValsHash)
	proofConsensusState := cardano.ConsensusStateDatum{
		Timestamp:          uint64(consensusTimestamp.UnixNano()),
		NextValidatorsHash: nextValsHash,
		Root: cardano.RootHashInDatum{
			Hash: rootHash.Hash,
		},
	}

	/////// Connection State
	delayPeriod := uint64(60000) // dummy delay period
	connectionCounterpartyVersions := connectiontypes.GetCompatibleVersions()
	k := suite.chainA.App.GetIBCKeeper().ConnectionKeeper
	prefix := k.GetCommitmentPrefix()
	connectionStateConnectionID := ""
	expectedConnectionCounterparty := connectiontypes.NewCounterparty(clientID, connectionStateConnectionID, commitmenttypes.NewMerklePrefix(prefix.Bytes()))
	expectedConnectionEnd := connectiontypes.NewConnectionEnd(connectiontypes.INIT, expectedConnectionCounterparty.ClientId, expectedConnectionCounterparty, connectionCounterpartyVersions, delayPeriod)

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

	/////// Channel State

	channelPortID := ""
	channelConnectionID := ""
	channelCounterpartyChannelId := ""
	channelCounterpartyHops := []string{channelConnectionID}
	channelState := channeltypes.INIT
	order := channeltypes.ORDERED
	channelCounterpartyVersion := "ics20-1"

	expectedCounterparty := channeltypes.NewCounterparty(channelPortID, channelCounterpartyChannelId)
	expectedChannelValue := channeltypes.NewChannel(
		channelState, order, expectedCounterparty,
		channelCounterpartyHops, channelCounterpartyVersion,
	)
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
			ChannelId: []byte(channelConnectionID),
		},
		ConnectionHops: connectionHops,
		Version:        []byte(channelCounterpartyVersion),
	}

	testCases := []struct {
		name     string
		execFunc func(cdc codec.BinaryCodec) error
		expPass  bool
	}{
		{
			name: "valid VerifyProofClientState",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: true,
		},
		{
			name: "invalid VerifyProofClientState: Chain Id mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.ChainId = []byte("dummy chain ID")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: TrustLevel mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.TrustLevel.Denominator += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: TrustingPeriod mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.TrustingPeriod += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: UnbondingPeriod mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.UnbondingPeriod += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: MaxClockDrift mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.MaxClockDrift += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: FrozenHeight mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.FrozenHeight.RevisionHeight += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofClientState: LatestHeight mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedClientState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofDataClientState
				proofData.LatestHeight.RevisionHeight += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofClientState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "valid VerifyProofConsensusState",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedConsensusState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofConsensusState
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConsensusState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: true,
		},
		{
			name: "invalid VerifyProofConsensusState: Timestamp mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedConsensusState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofConsensusState
				proofData.Timestamp = uint64(time.Now().UnixNano())
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConsensusState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConsensusState: NextValidatorsHash mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedConsensusState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofConsensusState
				proofData.NextValidatorsHash = []byte("dummy nextValsHash invalid")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConsensusState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConsensusState: RootHash mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedConsensusState
				expectedValueBytes, err := cdc.MarshalInterface(expectedValue)
				if err != nil {
					return err
				}
				proofData := proofConsensusState
				proofData.Root.Hash = []byte("dummy Root.Hash invalid")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConsensusState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "valid VerifyProofConnectionState",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: true,
		},
		{
			name: "invalid VerifyProofConnectionState: ClientId mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.ClientId = []byte("invalid ClientId")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: Versions length mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.Versions = []cardano.VersionDatum{}
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: State mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.State = cbor.Tag{
					Number: uint64(connectiontypes.OPEN) + cardano.CBOR_TAG_MAGIC_NUMBER,
				}
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: Counterparty.ClientId mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.Counterparty.ClientId = []byte("invalid Counterparty clientId")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: Counterparty.ConnectionId mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.Counterparty.ConnectionId = []byte("invalid Counterparty ConnectionId")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: Counterparty.Prefix mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.Counterparty.Prefix.KeyPrefix = []byte("invalid Counterparty KeyPrefix")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofConnectionState: DelayPeriod mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {

				expectedValue := expectedConnectionEnd
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofConnectionEndDatum
				proofData.DelayPeriod += 1
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofConnectionState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "valid VerifyProofChannelState",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: true,
		},
		{
			name: "invalid VerifyProofChannelState: State mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofData.State = cbor.Tag{
					Number: uint64(channelState) + cardano.CBOR_TAG_MAGIC_NUMBER + 1,
				}
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofChannelState: Ordering mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofData.Ordering = cbor.Tag{
					Number: uint64(order) + cardano.CBOR_TAG_MAGIC_NUMBER + 1,
				}
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofChannelState: Counterparty.PortId mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofData.Counterparty.PortId = []byte("invalid Counterparty.PortId")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofChannelState: Counterparty.ChannelId mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofData.Counterparty.ChannelId = []byte("invalid Counterparty.ChannelId")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
		{
			name: "invalid VerifyProofChannelState: Version mismatch",
			execFunc: func(cdc codec.BinaryCodec) error {
				expectedValue := expectedChannelValue
				expectedValueBytes, err := cdc.Marshal(&expectedValue)
				if err != nil {
					return err
				}

				proofData := proofChannelData
				proofData.Version = []byte("invalid Version")
				proofDataInStore, err := cbor.Marshal(proofData)
				if err != nil {
					return err
				}
				return cardano.VerifyProofChannelState(proofPath, expectedValueBytes, proofDataInStore, cdc)
			},
			expPass: false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		suite.Run(tc.name, func() {
			suite.SetupTest()
			path := NewPath(suite.chainA, suite.chainB)
			height := cardano.Height{RevisionNumber: 0, RevisionHeight: 10}
			clientState := cardano.NewClientState(chainID, &height, 0, 1705895324, 2, 423000, 129600, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, []*cardano.Validator{{
				VrfKeyHash: "FEC17ED60CBF2EC5BE3F061FB4DE0B6EF1F20947CFBFCE5FB2783D12F3F69FF5",
				PoolId:     "pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09",
			}}, 950400, []string{}, &cardano.TokenConfigs{})

			store := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
			clientState.Initialize(suite.chainA.GetContext(), suite.chainA.Codec, store, &cardano.ConsensusState{
				Timestamp: 1707122673,
				Slot:      1214009,
			})

			cdc := suite.chainA.Codec

			err := tc.execFunc(cdc)

			if tc.expPass {
				suite.Require().NoError(err, "valid case returned an error")
			} else {
				suite.Require().Error(err, "invalid case didn't return an error")

			}
		})
	}
}
