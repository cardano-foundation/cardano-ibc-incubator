package ibc_types

import (
	"encoding/hex"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDecodeMintChannelRedeemerSchema(t *testing.T) {
	t.Run("Mint Channel Redeemer Channel Open Init Successfully", func(t *testing.T) {
		mintChannRedeemerEncoded := "d8799fd8799f4d746573742d706f6c696379496449746573742d6e616d65ffff"
		mintChanRedeemerInit, err := DecodeMintChannelRedeemerSchema(mintChannRedeemerEncoded)
		require.Equal(t, nil, err)
		require.NotEqual(t, nil, mintChanRedeemerInit.Value.(MintChannelRedeemerChanOpenInit).HandlerAuthToken)
		require.Equal(t, hex.EncodeToString([]byte("test-name")), hex.EncodeToString(mintChanRedeemerInit.Value.(MintChannelRedeemerChanOpenInit).HandlerAuthToken.Name))
		require.Equal(t, hex.EncodeToString([]byte("test-policyId")), hex.EncodeToString(mintChanRedeemerInit.Value.(MintChannelRedeemerChanOpenInit).HandlerAuthToken.PolicyId))
	})
	t.Run("Mint Channel Redeemer Channel Open Try Successfully", func(t *testing.T) {
		mintChannRedeemerEncoded := "d87a9fd8799f4d746573742d706f6c696379496449746573742d6e616d65ff5819746573742d636f756e74657270617274795f76657273696f6ed8799f9fd8799fd8799fd8799f48746573742d6b65794a746573742d76616c7565d8799f0a0a0a0a4b746573742d707265666978ff80ffffffffffd8799f0a0affff"
		mintChanRedeemerTry, err := DecodeMintChannelRedeemerSchema(mintChannRedeemerEncoded)
		require.Equal(t, nil, err)
		require.NotEqual(t, nil, mintChanRedeemerTry.Value.(MintChannelRedeemerChanOpenTry).HandlerAuthToken)
		require.Equal(t, hex.EncodeToString([]byte("test-name")), hex.EncodeToString(mintChanRedeemerTry.Value.(MintChannelRedeemerChanOpenTry).HandlerAuthToken.Name))
		require.Equal(t, hex.EncodeToString([]byte("test-policyId")), hex.EncodeToString(mintChanRedeemerTry.Value.(MintChannelRedeemerChanOpenTry).HandlerAuthToken.PolicyId))
	})
	t.Run("Spend Channel Redeemer Channel Open Ack Successfully", func(t *testing.T) {
		spendChannRedeemerEncoded := "d8799f5819746573742d636f756e74657270617274792d76657273696f6ed8799f9fd8799fd8799fd8799f48746573742d6b65794a746573742d76616c7565d8799f0a0a0a0a4b746573742d707265666978ff80ffffffffffd8799f0a0affff"
		spendChanRedeemerAck, err := DecodeSpendChannelRedeemerSchema(spendChannRedeemerEncoded)
		require.Equal(t, nil, err)
		require.NotEqual(t, nil, spendChanRedeemerAck.Value.(SpendChannelRedeemerChanOpenAck).ProofTry)
		require.Equal(t, hex.EncodeToString([]byte("test-counterparty-version")), hex.EncodeToString(spendChanRedeemerAck.Value.(SpendChannelRedeemerChanOpenAck).CounterpartyVersion))
	})
	t.Run("Spend Channel Redeemer Channel Open Confirm Successfully", func(t *testing.T) {
		spendChannRedeemerEncoded := "d87a9fd8799f9fd8799fd8799fd8799f48746573742d6b65794a746573742d76616c7565d8799f0a0a0a0a4b746573742d707265666978ff80ffffffffffd8799f0a0affff"
		spendChanRedeemerConfirm, err := DecodeSpendChannelRedeemerSchema(spendChannRedeemerEncoded)
		require.Equal(t, nil, err)
		require.NotEqual(t, nil, spendChanRedeemerConfirm.Value.(SpendChannelRedeemerChanOpenConfirm).ProofAck)
		require.Equal(t, uint64(10), spendChanRedeemerConfirm.Value.(SpendChannelRedeemerChanOpenConfirm).ProofHeight.RevisionNumber)
	})
}
