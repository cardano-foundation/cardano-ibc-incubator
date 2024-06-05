package constant

import "time"

const (
	EpochPeriod              = 5
	ClientTrustingPeriod     = EpochPeriod * 24 * time.Hour
	OgmiosEndpoint           = "OGMIOS_ENDPOINT"
	CardanoChainNetworkMagic = "CARDANO_CHAIN_NETWORK_MAGIC"
	CardanoDB                = "CARDANO_DB"
	DbName                   = "DB_NAME"
	DbDriver                 = "DB_DRIVER"
	DbUsername               = "DB_USERNAME"
	DbPassword               = "DB_PASSWORD"
	DbSslMode                = "DB_SSL_MODE"
	DbHost                   = "DB_HOST"
	DbPort                   = "DB_PORT"
	CBOR_TAG_MAGIC_NUMBER    = 121
	CONNECTION_TOKEN_PREFIX  = "636f6e6e656374696f6e"
	CHANNEL_TOKEN_PREFIX     = "6368616e6e656c"
)
