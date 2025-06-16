package main

import (
	"github.com/cardano/relayer/v1/cmd"
	sdk "github.com/cosmos/cosmos-sdk/types"
)

func main() {
	cmd.Execute()
}

func init() {
	//prevent incorrect bech32 address prefixed addresses when calling AccAddress.String()
	sdk.SetAddrCacheEnabled(false)
}
