package ibc_test

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/cardano/relayer/v1/cmd"
	"github.com/cardano/relayer/v1/internal/relayertest"
	"github.com/cardano/relayer/v1/relayer/chains/cardano"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos"
)

const (
	CardanoRPCAddr      = "http://192.168.11.72:5001"
	CardanoChainName    = "cardano"
	CardanoChainID      = "cardano"
	CardanoPortTransfer = "port-99"

	CosmosRPCAddr      = "http://192.168.10.136:26657"
	CosmosChainName    = "cosmos"
	CosmosChainID      = "sidechain" // -> need to change later
	CosmosPortTransfer = "transfer"
)
const (
	CardanoMnemonicTest = "direct language gravity into finger nurse rug rug spoon toddler music ability brisk wasp sound ball join guard pattern smooth lemon obscure raise royal"
	CardanoAddressTest  = "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql"

	CosmosMnemonicTest = "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance"
	CosmosAddressTest  = "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6"
)

const (
	Timeout        = "60s"
	KeyringBackend = "test"
	GasAdjustment  = 1.1
	Path           = "demo"
	Amount         = "2000stake"
)

func setUp(t *testing.T, homeDir string) *relayertest.System {
	err := os.Chdir("../../")
	assert.Nil(t, err)

	sys := relayertest.NewSystem(t)
	if homeDir != "" {
		sys.HomeDir = homeDir
	}

	initConfig(t, sys)

	addChains(t, sys)

	addPaths(t, sys)

	return sys
}

func initConfig(t *testing.T, sys *relayertest.System) relayertest.RunResult {
	runResult := sys.MustRun(t, "config", "init")

	assert.Nil(t, runResult.Err, "init config should be successful")

	return runResult
}

func addChains(t *testing.T, sys *relayertest.System) {
	addCardanoChain(t, sys)
	addCosmosChain(t, sys)
}

func addCardanoChain(t *testing.T, sys *relayertest.System) {
	sys.MustAddChain(t, CardanoChainName, cmd.ProviderConfigWrapper{
		Type: CardanoChainName,
		Value: cardano.CardanoProviderConfig{
			ChainID:        CardanoChainID,
			RPCAddr:        CardanoRPCAddr,
			Key:            "key-cardano-test",
			KeyringBackend: KeyringBackend,
			Timeout:        Timeout,
		},
	})
	// restoreKeyChain(t, sys, CardanoChainName, CardanoMnemonicTest)
}

func addCosmosChain(t *testing.T, sys *relayertest.System) {
	sys.MustAddChain(t, CosmosChainName, cmd.ProviderConfigWrapper{
		Type: CosmosChainName,
		Value: cosmos.CosmosProviderConfig{
			ChainID:        CosmosChainID,
			RPCAddr:        CosmosRPCAddr,
			KeyringBackend: KeyringBackend,
			AccountPrefix:  CosmosChainName,
			Timeout:        Timeout,
			GasAdjustment:  GasAdjustment,
		},
	})
	restoreKeyChain(t, sys, CosmosChainName, CosmosMnemonicTest)
}

func restoreKeyChain(t *testing.T, sys *relayertest.System, chainName string, mnemonic string) {
	sys.MustRun(t, "keys", "restore", chainName, "faucet-key", mnemonic)
	sys.MustRun(t, "keys", "use", chainName, "faucet-key")
}

func addPaths(t *testing.T, sys *relayertest.System) {
	sys.MustRun(t, "paths", "new", CardanoChainID, CosmosChainID, Path)
}
