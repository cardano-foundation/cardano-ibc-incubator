package cmd_test

import (
	"log"
	"testing"

	"github.com/cardano/relayer/v1/cmd"
	"github.com/cardano/relayer/v1/internal/relayertest"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos"
	"github.com/cosmos/cosmos-sdk/client/keys"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	cryptocodec "github.com/cosmos/cosmos-sdk/crypto/codec"
	"github.com/cosmos/cosmos-sdk/crypto/keyring"
	"github.com/stretchr/testify/require"
)

func TestKeysList_Empty(t *testing.T) {
	t.Parallel()

	sys := relayertest.NewSystem(t)

	_ = sys.MustRun(t, "config", "init")

	sys.MustAddChain(t, "cardano", cmd.ProviderConfigWrapper{
		Type: "cardano",
		Value: cosmos.CosmosProviderConfig{
			ChainID:        "cardano",
			KeyringBackend: "test",
			Timeout:        "10s",
		},
	})

	res := sys.MustRun(t, "keys", "list", "cardano")
	require.Empty(t, res.Stdout.String())
	require.Contains(t, res.Stderr.String(), "no keys found for chain cardano")
}

func TestKeysAdd(t *testing.T) {
	t.Parallel()

	sys := relayertest.NewSystem(t)

	_ = sys.MustRun(t, "config", "init")

	sys.MustAddChain(t, "cardano", cmd.ProviderConfigWrapper{
		Type: "cardano",
		Value: cosmos.CosmosProviderConfig{
			ChainID:        "cardano",
			KeyringBackend: "test",
			Timeout:        "10s",
		},
	})

	res := sys.MustRun(t, "keys", "list", "cardano")
	//require.Empty(t, res.Stdout.String())
	//require.Contains(t, res.Stderr.String(), "no keys found for chain cardano")

	res = sys.MustRun(t, "keys", "add", "cardano", "cardano-key-test-3")
	log.Fatal(res.Stdout)
	//require.NotEmpty(t, res.Stdout.String())
	//require.Contains(t, res.Stderr.String(), "no keys found for chain cardano")

}

func TestKeysRestore_Delete(t *testing.T) {
	t.Parallel()

	sys := relayertest.NewSystem(t)

	_ = sys.MustRun(t, "config", "init")

	slip44 := 118

	sys.MustAddChain(t, "testChain", cmd.ProviderConfigWrapper{
		Type: "cosmos",
		Value: cosmos.CosmosProviderConfig{
			AccountPrefix:  "cosmos",
			ChainID:        "testcosmos",
			KeyringBackend: "test",
			Timeout:        "10s",
			Slip44:         &slip44,
		},
	})

	// Restore a key with mnemonic to the chain.

	res := sys.MustRun(t, "keys", "restore", "testChain", "default", relayertest.ZeroMnemonic)
	require.Equal(t, res.Stdout.String(), relayertest.ZeroCosmosAddr+"\n")
	require.Empty(t, res.Stderr.String())

	// Restored key must show up in list.
	res = sys.MustRun(t, "keys", "list", "testChain")
	require.Equal(t, res.Stdout.String(), "key(default) -> "+relayertest.ZeroCosmosAddr+"\n")
	require.Empty(t, res.Stderr.String())

	// Deleting the key must succeed.
	res = sys.MustRun(t, "keys", "delete", "testChain", "default", "-y")
	require.Empty(t, res.Stdout.String())
	require.Equal(t, res.Stderr.String(), "key default deleted\n")

	// Listing the keys again gives the no keys warning.
	res = sys.MustRun(t, "keys", "list", "testChain")
	require.Empty(t, res.Stdout.String())
	require.Contains(t, res.Stderr.String(), "no keys found for chain testChain")
}

func TestKeysExport(t *testing.T) {
	t.Parallel()

	sys := relayertest.NewSystem(t)

	_ = sys.MustRun(t, "config", "init")

	slip44 := 118

	sys.MustAddChain(t, "testChain", cmd.ProviderConfigWrapper{
		Type: "cosmos",
		Value: cosmos.CosmosProviderConfig{
			AccountPrefix:  "cosmos",
			ChainID:        "testcosmos",
			KeyringBackend: "test",
			Timeout:        "10s",
			Slip44:         &slip44,
		},
	})

	// Restore a key with mnemonic to the chain.
	res := sys.MustRun(t, "keys", "restore", "testChain", "default", relayertest.ZeroMnemonic)
	require.Equal(t, res.Stdout.String(), relayertest.ZeroCosmosAddr+"\n")
	require.Empty(t, res.Stderr.String())

	// Export the key.
	res = sys.MustRun(t, "keys", "export", "testChain", "default")
	armorOut := res.Stdout.String()
	require.Contains(t, armorOut, "BEGIN TENDERMINT PRIVATE KEY")
	require.Empty(t, res.Stderr.String())

	// Import the key to a temporary keyring.
	registry := codectypes.NewInterfaceRegistry()
	cryptocodec.RegisterInterfaces(registry)
	cdc := codec.NewProtoCodec(registry)
	kr := keyring.NewInMemory(cdc)
	require.NoError(t, kr.ImportPrivKey("temp", armorOut, keys.DefaultKeyPass))

	// TODO: confirm the imported address matches?
}

func TestKeysDefaultCoinType(t *testing.T) {
	t.Parallel()

	sys := relayertest.NewSystem(t)

	_ = sys.MustRun(t, "config", "init")

	slip44 := 118

	sys.MustAddChain(t, "testChain", cmd.ProviderConfigWrapper{
		Type: "cosmos",
		Value: cosmos.CosmosProviderConfig{
			AccountPrefix:  "cosmos",
			ChainID:        "testcosmos-1",
			KeyringBackend: "test",
			Timeout:        "10s",
			Slip44:         &slip44,
		},
	})

	sys.MustAddChain(t, "testChain2", cmd.ProviderConfigWrapper{
		Type: "cosmos",
		Value: cosmos.CosmosProviderConfig{
			AccountPrefix:  "cosmos",
			ChainID:        "testcosmos-2",
			KeyringBackend: "test",
			Timeout:        "10s",
		},
	})

	// Restore a key with mnemonic to the chain.
	res := sys.MustRun(t, "keys", "restore", "testChain", "default", relayertest.ZeroMnemonic)
	require.Equal(t, res.Stdout.String(), relayertest.ZeroCosmosAddr+"\n")
	require.Empty(t, res.Stderr.String())

	// Restore a key with mnemonic to the chain.
	res = sys.MustRun(t, "keys", "restore", "testChain2", "default", relayertest.ZeroMnemonic)
	require.Equal(t, res.Stdout.String(), relayertest.ZeroCosmosAddr+"\n")
	require.Empty(t, res.Stderr.String())

	// Export the key.
	res = sys.MustRun(t, "keys", "export", "testChain", "default")
	armorOut := res.Stdout.String()
	require.Contains(t, armorOut, "BEGIN TENDERMINT PRIVATE KEY")
	require.Empty(t, res.Stderr.String())

	// Export the key.
	res = sys.MustRun(t, "keys", "export", "testChain2", "default")
	armorOut2 := res.Stdout.String()
	require.Contains(t, armorOut, "BEGIN TENDERMINT PRIVATE KEY")
	require.Empty(t, res.Stderr.String())

	// Import the key to a temporary keyring.
	registry := codectypes.NewInterfaceRegistry()
	cryptocodec.RegisterInterfaces(registry)
	cdc := codec.NewProtoCodec(registry)
	kr := keyring.NewInMemory(cdc)
	require.NoError(t, kr.ImportPrivKey("temp", armorOut, keys.DefaultKeyPass))

	// This should fail due to same key
	err := kr.ImportPrivKey("temp", armorOut2, keys.DefaultKeyPass)
	require.Error(t, err, "same key was able to be imported twice")
	require.Contains(t, err.Error(), "cannot overwrite key")
}
