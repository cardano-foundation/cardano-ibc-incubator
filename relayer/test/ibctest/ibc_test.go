package ibc_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/cardano/relayer/v1/internal/relayertest"
	"github.com/cardano/relayer/v1/relayer"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
)

type IBCTestSuite struct {
	suite.Suite
	System *relayertest.System
	Logger *zap.Logger
}

// In order for 'go test' to run this suite, we need to create
// a normal test function and pass our suite to suite.Run
func TestIBCSuite(t *testing.T) {
	s := &IBCTestSuite{
		Logger: zaptest.NewLogger(t, zaptest.Level(zap.InfoLevel)),
	}
	s.SetupTestHomeDir(t, "")

	t.Run("TestCreateConnection", s.TestCreateConnection)
	t.Run("TestCreateChannel", s.TestCreateChannel)
	t.Run("TestRelayPacket", s.TestRelayPacket)

	t.Run("TestRelayPacketWHomeDir", s.TestRelayPacketWHomeDir)
}

func (s *IBCTestSuite) SetupTestHomeDir(t *testing.T, homeDir string) {
	s.System = setUp(t, homeDir)
}

func (s *IBCTestSuite) TestCreateConnection(t *testing.T) {
	runResult := s.createConnection(t, s.System)
	assert.Nil(t, runResult.Err)
}

func (s *IBCTestSuite) TestCreateChannel(t *testing.T) {
	runResult := s.createUnorderdTransferChannel(t, s.System)
	assert.Nil(t, runResult.Err)
}

func (s *IBCTestSuite) TestRelayPacket(t *testing.T) {
	var runResult relayertest.RunResult

	config := s.System.MustGetConfig(t)

	path, err := config.Paths.Get(Path)
	assert.Nil(t, err)

	_, cosmosChannelID := s.getLastOpenedChannels(t, s.System, path.Dst, CosmosChainName)
	var wg sync.WaitGroup

	wg.Add(1)

	go func() {
		defer wg.Done()
		s.startRelay(t, s.System)
	}()

	runResult = s.transferFromCosmosToCardano(t, s.System, cosmosChannelID)
	assert.Nil(t, runResult.Err)

	wg.Wait()
}

func (s *IBCTestSuite) TestRelayPacketWHomeDir(t *testing.T) {
	dir, err := os.Getwd()
	assert.Nil(t, err)

	dir = dir + "/test/ibctest"
	path := dir + "/config"

	if _, err := os.Stat(path); err != nil {
		assert.True(t, os.IsNotExist(err))

		err := os.Chdir(dir)
		assert.Nil(t, err)

		s.System = setUp(t, dir)

		s.createConnection(t, s.System)
		s.createUnorderdTransferChannel(t, s.System)
	} else {
		s.System.HomeDir = dir

		s.System.MustGetConfig(t)
	}

	s.TestRelayPacket(t)
}

func (s *IBCTestSuite) createConnection(t *testing.T, sys *relayertest.System) relayertest.RunResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*60)
	defer cancel()

	return sys.RunWithInputC(ctx, s.Logger, bytes.NewReader(nil), "transact",
		"connection", Path,
		"--block-history", "0",
		"--client-tp", "24h",
		"--max-retries", "2",
	)
}

func (s *IBCTestSuite) createUnorderdTransferChannel(t *testing.T, sys *relayertest.System) relayertest.RunResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*120)
	defer cancel()

	return sys.RunWithInputC(ctx, s.Logger, bytes.NewReader(nil),
		"transact", "channel", Path,
		"--src-port", CardanoPortTransfer,
		"--dst-port", CosmosPortTransfer,
		"--order", "unordered",
		"--version", "ics20-1")
}

func (s *IBCTestSuite) getLastOpenedChannels(t *testing.T, sys *relayertest.System, pathEnd *relayer.PathEnd, chainName string) (string, string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*100)
	defer cancel()

	runResult := sys.RunWithInputC(ctx, s.Logger, bytes.NewReader(nil),
		"query", "connection-channels", chainName, pathEnd.ConnectionID)

	assert.Nil(t, runResult.Err)

	cosmosChannel := &chantypes.IdentifiedChannel{}
	json.Unmarshal(runResult.Stdout.Bytes(), cosmosChannel)

	return cosmosChannel.Counterparty.ChannelId, cosmosChannel.ChannelId
}

func (s *IBCTestSuite) startRelay(t *testing.T, sys *relayertest.System) relayertest.RunResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*30)
	defer cancel()

	return sys.RunWithInputC(ctx, s.Logger, bytes.NewReader(nil),
		"transact", "flush", Path)
}

func (s *IBCTestSuite) transferFromCosmosToCardano(t *testing.T, sys *relayertest.System, cosmosChannelID string) relayertest.RunResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	return sys.RunWithInputC(ctx, s.Logger, bytes.NewReader(nil),
		"transact", "transfer",
		CosmosChainName, CardanoChainName, Amount,
		CardanoAddressTest,
		cosmosChannelID,
		"--path", Path,
		"--timeout-time-offset", "1h",
	)
}
