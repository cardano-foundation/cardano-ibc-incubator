package constant

import "time"

const (
	EpochPeriod          = 5
	ClientTrustingPeriod = EpochPeriod * 24 * time.Hour
)
