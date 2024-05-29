package ibc_test

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/cardano/relayer/v1/cmd"
	"github.com/cardano/relayer/v1/internal/relayertest"
	"github.com/cardano/relayer/v1/relayer/chains/cardano"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos"
)

const (
	CardanoRPCAddr      = "http://192.168.11.72:5002"
	CardanoChainName    = "cardano"
	CardanoChainID      = "cardano"
	CardanoPortTransfer = "port-100"
	MithrilEndpoint     = "http://192.168.11.72:8080/aggregator"

	CosmosRPCAddr      = "http://192.168.10.32:26657"
	CosmosChainName    = "cosmos"
	CosmosChainID      = "sidechain" // -> need to change later
	CosmosPortTransfer = "transfer"
	CosmosPortMockModule = "orderedtransfer"

	TimeForTestTransfer = "1h"
	TimeForTestTimeOut  = "1s"
)
const (
	CardanoMnemonicTest = "direct language gravity into finger nurse rug rug spoon toddler music ability brisk wasp sound ball join guard pattern smooth lemon obscure raise royal"
	CardanoAddressTest  = "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql"

	CosmosMnemonicTest = "engage vote never tired enter brain chat loan coil venture soldier shine awkward keen delay link mass print venue federal ankle valid upgrade balance"
	CosmosAddressTest  = "cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6"

	CardanoPublicKeyHash = "247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8"
	KeyNameTest          = "faucet-key"
)

const (
	Timeout                = "60s"
	KeyringBackend         = "test"
	GasAdjustment          = 1.1
	Path                   = "demo"
	Amount                 = "2000stake"
	AmountCardanoMockToken = "3000-9fc33a6ffaa8d1f600c161aa383739d5af37807ed83347cc133521c96d6f636b"
	AmountCardano          = "2001-lovelace"
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
			ChainID:         CardanoChainID,
			RPCAddr:         CardanoRPCAddr,
			KeyringBackend:  KeyringBackend,
			Timeout:         Timeout,
			MithrilEndpoint: MithrilEndpoint,
		},
	})
	if !checkKeyExist(t, sys, CardanoChainName, KeyNameTest, CardanoAddressTest) {
		restoreKeyChain(t, sys, CardanoChainName, KeyNameTest, CardanoMnemonicTest)
	}
	keyUse(t, sys, CardanoChainName, KeyNameTest)
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
	if !checkKeyExist(t, sys, CosmosChainName, KeyNameTest, CosmosAddressTest) {
		restoreKeyChain(t, sys, CosmosChainName, KeyNameTest, CosmosMnemonicTest)
	}
	keyUse(t, sys, CosmosChainName, KeyNameTest)
}

func restoreKeyChain(t *testing.T, sys *relayertest.System, chainName string, keyName string, mnemonic string) {
	sys.MustRun(t, "keys", "restore", chainName, keyName, mnemonic)
}

func addPaths(t *testing.T, sys *relayertest.System) {
	sys.MustRun(t, "paths", "new", CardanoChainID, CosmosChainID, Path)
}

func keyUse(t *testing.T, sys *relayertest.System, chainName string, keyName string) {
	sys.MustRun(t, "keys", "use", chainName, keyName)
}

func checkKeyExist(t *testing.T, sys *relayertest.System, chainName string, keyName string, address string) bool {
	res := sys.MustRun(t, "keys", "list", chainName)
	if strings.Contains(res.Stdout.String(), "key("+keyName+") -> "+address) {
		return true
	}
	return false
}
