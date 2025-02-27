package cardano

import "fmt"

// Get the feegrant params to use for the next TX. If feegrants are not configured for the chain client, the default key will be used for TX signing.
// Otherwise, a configured feegrantee will be chosen for TX signing in round-robin fashion.
func (cc *CardanoProvider) GetTxFeeGrant() (txSignerKey string, feeGranterKey string) {
	//By default, we should sign TXs with the ChainClient's default key
	txSignerKey = cc.PCfg.Key

	if cc.PCfg.FeeGrants == nil {
		fmt.Printf("cc.Config.FeeGrants == nil\n")
		return
	}

	// Use the ChainClient's configured Feegranter key for the next TX.
	feeGranterKey = cc.PCfg.FeeGrants.GranterKey

	// The ChainClient Feegrant configuration has never been verified on chain.
	// Don't use Feegrants as it could cause the TX to fail on chain.
	if feeGranterKey == "" || cc.PCfg.FeeGrants.BlockHeightVerified <= 0 {
		fmt.Printf("cc.Config.FeeGrants.BlockHeightVerified <= 0\n")
		feeGranterKey = ""
		return
	}

	//Pick the next managed grantee in the list as the TX signer
	lastGranteeIdx := cc.PCfg.FeeGrants.GranteeLastSignerIndex

	if lastGranteeIdx >= 0 && lastGranteeIdx <= len(cc.PCfg.FeeGrants.ManagedGrantees)-1 {
		txSignerKey = cc.PCfg.FeeGrants.ManagedGrantees[lastGranteeIdx]
		cc.PCfg.FeeGrants.GranteeLastSignerIndex = cc.PCfg.FeeGrants.GranteeLastSignerIndex + 1

		//Restart the round robin at 0 if we reached the end of the list of grantees
		if cc.PCfg.FeeGrants.GranteeLastSignerIndex == len(cc.PCfg.FeeGrants.ManagedGrantees) {
			cc.PCfg.FeeGrants.GranteeLastSignerIndex = 0
		}
	}

	return
}
