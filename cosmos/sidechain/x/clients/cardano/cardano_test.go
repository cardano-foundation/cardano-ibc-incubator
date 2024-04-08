package cardano_test

import (
	"encoding/json"
	sidechainapp "sidechain/app"
	"sidechain/x/clients/cardano"
	"testing"
	"time"

	"cosmossdk.io/log"
	sdkmath "cosmossdk.io/math"
	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cosmos/cosmos-db"
	"github.com/stretchr/testify/require"
	testifysuite "github.com/stretchr/testify/suite"

	"github.com/cosmos/cosmos-sdk/baseapp"
	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/cosmos-sdk/server"
	"github.com/cosmos/cosmos-sdk/testutil/mock"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"

	cmtbytes "github.com/cometbft/cometbft/libs/bytes"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"

	ibctesting "github.com/cosmos/ibc-go/v8/testing"
	ibctestingmock "github.com/cosmos/ibc-go/v8/testing/mock"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	cryptocodec "github.com/cosmos/cosmos-sdk/crypto/codec"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	ibctypes "github.com/cosmos/ibc-go/v8/modules/core/types"
	ibctm "github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint"
)

const (
	chainID                        = "sidechain"
	chainIDRevision0               = "sidechain-revision-0"
	chainIDRevision1               = "sidechain-revision-1"
	clientID                       = "sidechainnet"
	trustingPeriod   time.Duration = time.Hour * 24 * 7 * 2
	ubdPeriod        time.Duration = time.Hour * 24 * 7 * 3
	maxClockDrift    time.Duration = time.Second * 10
)

var (
	height          = clienttypes.NewHeight(0, 4)
	newClientHeight = clienttypes.NewHeight(1, 1)
	upgradePath     = []string{"upgrade", "upgradedIBCState"}
)

var (
	ChainIDPrefix = "testchain"
	// to disable revision format, set ChainIDSuffix to ""
	ChainIDSuffix   = "-1"
	globalStartTime = time.Date(2024, 2, 5, 8, 45, 54, 0, time.UTC)
	TimeIncrement   = time.Second * 5
)

type CardanoTestSuite struct {
	testifysuite.Suite

	coordinator *ibctesting.Coordinator

	// testing chains used for convenience and readability
	chainA *ibctesting.TestChain
	chainB *ibctesting.TestChain

	// TODO: deprecate usage in favor of testing package
	ctx        sdk.Context
	cdc        codec.Codec
	privVal    cmttypes.PrivValidator
	valSet     *cmttypes.ValidatorSet
	signers    map[string]cmttypes.PrivValidator
	valsHash   cmtbytes.HexBytes
	header     *ibctm.Header
	now        time.Time
	headerTime time.Time
	clientTime time.Time
}

var DefaultTestingAppInit = SetupTestingApp

func SetupTestingApp() (ibctesting.TestingApp, map[string]json.RawMessage) {
	db := dbm.NewMemDB()

	appOptions := make(simtestutil.AppOptionsMap, 0)
	appOptions[flags.FlagHome] = sidechainapp.DefaultNodeHome
	appOptions[server.FlagInvCheckPeriod] = 5

	app, _ := sidechainapp.New(log.NewNopLogger(), db, nil, true, appOptions)
	return app, app.DefaultGenesis()
}

// SetupWithGenesisValSet initializes a new SimApp with a validator set and genesis accounts
// that also act as delegators. For simplicity, each validator is bonded with a delegation
// of one consensus engine unit (10^6) in the default token of the simapp from first genesis
// account. A Nop logger is set in SimApp.
func SetupWithGenesisValSetNew(tb testing.TB, valSet *cmttypes.ValidatorSet, genAccs []authtypes.GenesisAccount, chainID string, powerReduction sdkmath.Int, balances ...banktypes.Balance) ibctesting.TestingApp {
	tb.Helper()
	app, genesisState := DefaultTestingAppInit()

	// ensure baseapp has a chain-id set before running InitChain
	baseapp.SetChainID(chainID)(app.GetBaseApp())

	// set genesis accounts
	authGenesis := authtypes.NewGenesisState(authtypes.DefaultParams(), genAccs)
	genesisState[authtypes.ModuleName] = app.AppCodec().MustMarshalJSON(authGenesis)

	validators := make([]stakingtypes.Validator, 0, len(valSet.Validators))
	delegations := make([]stakingtypes.Delegation, 0, len(valSet.Validators))

	bondAmt := sdk.TokensFromConsensusPower(1, powerReduction)

	for _, val := range valSet.Validators {
		pk, err := cryptocodec.FromCmtPubKeyInterface(val.PubKey)
		require.NoError(tb, err)
		pkAny, err := codectypes.NewAnyWithValue(pk)
		require.NoError(tb, err)
		validator := stakingtypes.Validator{
			OperatorAddress:   sdk.ValAddress(val.Address).String(),
			ConsensusPubkey:   pkAny,
			Jailed:            false,
			Status:            stakingtypes.Bonded,
			Tokens:            bondAmt,
			DelegatorShares:   sdkmath.LegacyOneDec(),
			Description:       stakingtypes.Description{},
			UnbondingHeight:   int64(0),
			UnbondingTime:     time.Unix(0, 0).UTC(),
			Commission:        stakingtypes.NewCommission(sdkmath.LegacyZeroDec(), sdkmath.LegacyZeroDec(), sdkmath.LegacyZeroDec()),
			MinSelfDelegation: sdkmath.ZeroInt(),
		}

		validators = append(validators, validator)
		delegations = append(delegations, stakingtypes.NewDelegation(genAccs[0].GetAddress().String(), sdk.ValAddress(val.Address).String(), sdkmath.LegacyOneDec()))
	}

	// set validators and delegations
	var stakingGenesis stakingtypes.GenesisState
	app.AppCodec().MustUnmarshalJSON(genesisState[stakingtypes.ModuleName], &stakingGenesis)

	bondDenom := stakingGenesis.Params.BondDenom

	// add bonded amount to bonded pool module account
	balances = append(balances, banktypes.Balance{
		Address: authtypes.NewModuleAddress(stakingtypes.BondedPoolName).String(),
		Coins:   sdk.Coins{sdk.NewCoin(bondDenom, bondAmt.Mul(sdkmath.NewInt(int64(len(valSet.Validators)))))},
	})

	// set validators and delegations
	stakingGenesis = *stakingtypes.NewGenesisState(stakingGenesis.Params, validators, delegations)
	genesisState[stakingtypes.ModuleName] = app.AppCodec().MustMarshalJSON(&stakingGenesis)

	// update total supply
	bankGenesis := banktypes.NewGenesisState(banktypes.DefaultGenesisState().Params, balances, sdk.NewCoins(), []banktypes.Metadata{}, []banktypes.SendEnabled{})
	genesisState[banktypes.ModuleName] = app.AppCodec().MustMarshalJSON(bankGenesis)

	var ibcGenesisState ibctypes.GenesisState
	app.AppCodec().MustUnmarshalJSON(genesisState["ibc"], &ibcGenesisState)
	ibcGenesisState.ClientGenesis.Params.AllowedClients = append(ibcGenesisState.ClientGenesis.Params.AllowedClients, cardano.ModuleName)
	genesisState["ibc"] = app.AppCodec().MustMarshalJSON(&ibcGenesisState)

	stateBytes, err := json.MarshalIndent(genesisState, "", " ")
	require.NoError(tb, err)

	// init chain will set the validator set and initialize the genesis accounts
	_, err = app.InitChain(
		&abci.RequestInitChain{
			ChainId:         chainID,
			Validators:      []abci.ValidatorUpdate{},
			AppStateBytes:   stateBytes,
			ConsensusParams: simtestutil.DefaultConsensusParams,
		},
	)
	require.NoError(tb, err)

	return app
}

func NewTestChainWithValSet(tb testing.TB, coord *ibctesting.Coordinator, chainID string, valSet *cmttypes.ValidatorSet, signers map[string]cmttypes.PrivValidator) *ibctesting.TestChain {
	tb.Helper()
	genAccs := []authtypes.GenesisAccount{}
	genBals := []banktypes.Balance{}
	senderAccs := []ibctesting.SenderAccount{}

	// generate genesis accounts
	for i := 0; i < ibctesting.MaxAccounts; i++ {
		senderPrivKey := secp256k1.GenPrivKey()
		acc := authtypes.NewBaseAccount(senderPrivKey.PubKey().Address().Bytes(), senderPrivKey.PubKey(), uint64(i), 0)
		amount, ok := sdkmath.NewIntFromString("10000000000000000000")
		require.True(tb, ok)

		// add sender account
		balance := banktypes.Balance{
			Address: acc.GetAddress().String(),
			Coins:   sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, amount)),
		}

		genAccs = append(genAccs, acc)
		genBals = append(genBals, balance)

		senderAcc := ibctesting.SenderAccount{
			SenderAccount: acc,
			SenderPrivKey: senderPrivKey,
		}

		senderAccs = append(senderAccs, senderAcc)
	}
	app := SetupWithGenesisValSetNew(tb, valSet, genAccs, chainID, sdk.DefaultPowerReduction, genBals...)

	// create current header and call begin block
	header := cmtproto.Header{
		ChainID: chainID,
		Height:  1,
		Time:    coord.CurrentTime.UTC(),
	}

	txConfig := app.GetTxConfig()

	// create an account to send transactions from
	chain := &ibctesting.TestChain{
		TB:             tb,
		Coordinator:    coord,
		ChainID:        chainID,
		App:            app,
		CurrentHeader:  header,
		QueryServer:    app.GetIBCKeeper(),
		TxConfig:       txConfig,
		Codec:          app.AppCodec(),
		Vals:           valSet,
		NextVals:       valSet,
		Signers:        signers,
		SenderPrivKey:  senderAccs[0].SenderPrivKey,
		SenderAccount:  senderAccs[0].SenderAccount,
		SenderAccounts: senderAccs,
	}

	// commit genesis block
	chain.NextBlock()

	return chain
}

// NewTestChain initializes a new test chain with a default of 4 validators
// Use this function if the tests do not need custom control over the validator set
func NewTestChain(t *testing.T, coord *ibctesting.Coordinator, chainID string) *ibctesting.TestChain {
	t.Helper()
	// generate validators private/public key
	var (
		validatorsPerChain = 4
		validators         []*cmttypes.Validator
		signersByAddress   = make(map[string]cmttypes.PrivValidator, validatorsPerChain)
	)

	for i := 0; i < validatorsPerChain; i++ {
		_, privVal := cmttypes.RandValidator(false, 100)
		pubKey, err := privVal.GetPubKey()
		require.NoError(t, err)
		validators = append(validators, cmttypes.NewValidator(pubKey, 1))
		signersByAddress[pubKey.Address().String()] = privVal
	}

	// construct validator set;
	// Note that the validators are sorted by voting power
	// or, if equal, by address lexical order
	valSet := cmttypes.NewValidatorSet(validators)

	return NewTestChainWithValSet(t, coord, chainID, valSet, signersByAddress)
}

// NewCoordinator initializes Coordinator with N TestChain's
func NewCoordinator(t *testing.T, n int) *ibctesting.Coordinator {
	t.Helper()
	chains := make(map[string]*ibctesting.TestChain)
	coord := &ibctesting.Coordinator{
		T:           t,
		CurrentTime: globalStartTime,
	}

	chainIDWithCardano := ibctesting.GetChainID(1)
	chains[chainIDWithCardano] = NewTestChain(t, coord, chainIDWithCardano)

	for i := 2; i <= n; i++ {
		chainID := ibctesting.GetChainID(i)
		chains[chainID] = ibctesting.NewTestChain(t, coord, chainID)
	}
	coord.Chains = chains

	return coord
}

func (suite *CardanoTestSuite) SetupTest() {
	suite.coordinator = NewCoordinator(suite.T(), 2)
	suite.chainA = suite.coordinator.GetChain(ibctesting.GetChainID(1))
	suite.chainB = suite.coordinator.GetChain(ibctesting.GetChainID(2))
	// commit some blocks so that QueryProof returns valid proof (cannot return valid query if height <= 1)
	suite.coordinator.CommitNBlocks(suite.chainA, 20)
	suite.coordinator.CommitNBlocks(suite.chainB, 2)

	// TODO: deprecate usage in favor of testing package
	// checkTx := false
	app := suite.chainA.App
	// suite.chainA.App = app
	suite.cdc = app.AppCodec()

	// now is the time of the current chain, must be after the updating header
	// mocks ctx.BlockTime()
	suite.now = time.Date(2024, 2, 5, 8, 45, 54, 0, time.UTC)
	suite.clientTime = time.Date(2024, 2, 5, 8, 45, 54, 0, time.UTC)
	// Header time is intended to be time for any new header used for updates
	suite.headerTime = time.Date(2024, 2, 5, 8, 46, 54, 0, time.UTC)

	suite.privVal = ibctestingmock.NewPV()

	pubKey, err := suite.privVal.GetPubKey()
	suite.Require().NoError(err)

	heightMinus1 := clienttypes.NewHeight(0, height.RevisionHeight-1)

	val := cmttypes.NewValidator(pubKey, 10)
	suite.signers = make(map[string]cmttypes.PrivValidator)
	suite.signers[val.Address.String()] = suite.privVal
	suite.valSet = cmttypes.NewValidatorSet([]*cmttypes.Validator{val})
	suite.valsHash = suite.valSet.Hash()
	suite.header = suite.chainA.CreateTMClientHeader(chainID, int64(height.RevisionHeight), heightMinus1, suite.now, suite.valSet, suite.valSet, suite.valSet, suite.signers)
	// suite.ctx = app.GetBaseApp().NewContext(checkTx)
}

func getAltSigners(altVal *cmttypes.Validator, altPrivVal cmttypes.PrivValidator) map[string]cmttypes.PrivValidator {
	return map[string]cmttypes.PrivValidator{altVal.Address.String(): altPrivVal}
}

func getBothSigners(suite *CardanoTestSuite, altVal *cmttypes.Validator, altPrivVal cmttypes.PrivValidator) (*cmttypes.ValidatorSet, map[string]cmttypes.PrivValidator) {
	// Create bothValSet with both suite validator and altVal. Would be valid update
	bothValSet := cmttypes.NewValidatorSet(append(suite.valSet.Validators, altVal))
	// Create signer array and ensure it is in same order as bothValSet
	_, suiteVal := suite.valSet.GetByIndex(0)
	bothSigners := map[string]cmttypes.PrivValidator{
		suiteVal.Address.String(): suite.privVal,
		altVal.Address.String():   altPrivVal,
	}
	return bothValSet, bothSigners
}

// initSetup initializes a new SimApp. A Nop logger is set in SimApp.
func initSetup(withGenesis bool, invCheckPeriod uint) (*sidechainapp.App, sidechainapp.GenesisState) {
	db := dbm.NewMemDB()

	appOptions := make(simtestutil.AppOptionsMap, 0)
	appOptions[flags.FlagHome] = sidechainapp.DefaultNodeHome
	appOptions[server.FlagInvCheckPeriod] = invCheckPeriod

	app, error := sidechainapp.New(log.NewNopLogger(), db, nil, true, appOptions)
	if error != nil {
		panic(error)
	}
	if withGenesis {
		return app, app.DefaultGenesis()
	}
	return app, sidechainapp.GenesisState{}
}

// Setup initializes a new SimApp. A Nop logger is set in SimApp.
func Setup(t *testing.T, isCheckTx bool) *sidechainapp.App {
	t.Helper()

	privVal := mock.NewPV()
	pubKey, err := privVal.GetPubKey()
	require.NoError(t, err)

	// create validator set with single validator
	validator := cmttypes.NewValidator(pubKey, 1)
	valSet := cmttypes.NewValidatorSet([]*cmttypes.Validator{validator})

	// generate genesis account
	senderPrivKey := secp256k1.GenPrivKey()

	acc := authtypes.NewBaseAccount(senderPrivKey.PubKey().Address().Bytes(), senderPrivKey.PubKey(), 0, 0)
	balance := banktypes.Balance{
		Address: acc.GetAddress().String(),
		Coins:   sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(100000000000000))),
	}

	app := SetupWithGenesisValSet(t, valSet, []authtypes.GenesisAccount{acc}, balance)

	return app
}

// SetupWithGenesisValSet initializes a new SimApp with a validator set and genesis accounts
// that also act as delegators. For simplicity, each validator is bonded with a delegation
// of one consensus engine unit in the default token of the simapp from first genesis
// account. A Nop logger is set in SimApp.
func SetupWithGenesisValSet(t *testing.T, valSet *cmttypes.ValidatorSet, genAccs []authtypes.GenesisAccount, balances ...banktypes.Balance) *sidechainapp.App {
	t.Helper()

	app, genesisState := initSetup(true, 5)
	genesisState, err := simtestutil.GenesisStateWithValSet(app.AppCodec(), genesisState, valSet, genAccs, balances...)
	require.NoError(t, err)

	stateBytes, err := json.MarshalIndent(genesisState, "", " ")
	require.NoError(t, err)

	// init chain will set the validator set and initialize the genesis accounts
	_, err = app.InitChain(&abci.RequestInitChain{
		Validators:      []abci.ValidatorUpdate{},
		ConsensusParams: simtestutil.DefaultConsensusParams,
		AppStateBytes:   stateBytes,
	},
	)
	require.NoError(t, err)

	return app
}

type CardanoConfig struct {
	TrustLevel      ibctm.Fraction
	TrustingPeriod  time.Duration
	UnbondingPeriod time.Duration
	MaxClockDrift   time.Duration
}

func (*CardanoConfig) GetClientType() string {
	return cardano.ModuleName
}

func NewCardanoConfig() *CardanoConfig {
	return &CardanoConfig{}
}

// NewDefaultEndpoint constructs a new endpoint using default values.
// CONTRACT: the counterparty endpoitn must be set by the caller.
func NewCardanoEndpoint(chain *ibctesting.TestChain) *ibctesting.Endpoint {
	return &ibctesting.Endpoint{
		Chain:            chain,
		ClientConfig:     NewCardanoConfig(),
		ConnectionConfig: ibctesting.NewConnectionConfig(),
		ChannelConfig:    ibctesting.NewChannelConfig(),
	}
}

// NewPath constructs an endpoint for each chain using the default values
// for the endpoints. Each endpoint is updated to have a pointer to the
// counterparty endpoint.
func NewPath(chainA, chainB *ibctesting.TestChain) *ibctesting.Path {
	endpointA := NewCardanoEndpoint(chainA)
	endpointB := ibctesting.NewDefaultEndpoint(chainB)

	endpointA.Counterparty = endpointB
	endpointB.Counterparty = endpointA

	return &ibctesting.Path{
		EndpointA: endpointA,
		EndpointB: endpointB,
	}
}

func TestCardanoTestSuite(t *testing.T) {
	testifysuite.Run(t, new(CardanoTestSuite))
}
