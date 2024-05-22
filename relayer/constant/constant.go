package constant

import "time"

const (
	EpochPeriod              = 5
	ClientTrustingPeriod     = EpochPeriod * 24 * time.Hour
	OgmiosEndpoint           = "OGMIOS_ENDPOINT"
	CardanoChainNetworkMagic = "CARDANO_CHAIN_NETWORK_MAGIC"
)
