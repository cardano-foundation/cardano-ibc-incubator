package probabilistic

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/stretchr/testify/require"
)

const acceptanceChainID = "caribic-v8-1"
const acceptanceSubject = ModuleName + "-0"
const acceptanceControl = ModuleName + "-1"
const acceptanceSubstitute = ModuleName + "-2"

// Public, deterministic local test keys. Never use them on another network.
func acceptanceKey(seed string) *secp256k1.PrivKey {
	return secp256k1.GenPrivKeyFromSecret([]byte("caribic-v8-acceptance/" + seed))
}
func acceptanceAddress(seed string) sdk.AccAddress {
	return sdk.AccAddress(acceptanceKey(seed).PubKey().Address())
}

type acceptanceHistory struct {
	Client                   *ClientState
	Consensus                *ConsensusState
	Honest, Bad, Tail, Later struct {
		Blocks   []*ProbabilisticBlock
		Contexts []*EpochContext
	}
}

func acceptanceReadJSON(t *testing.T, path string, target any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, target))
}
func acceptanceWriteJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, raw, 0600))
}
