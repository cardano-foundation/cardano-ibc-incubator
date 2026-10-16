//go:build !caribic_v8_upgrade

package probabilistic

import (
	"testing"

	"github.com/cosmos/ibc-go/v8/testing/simapp"
)

// This application cannot execute the successor's governance upgrade plan.
func configureAcceptanceUpgrade(_ *testing.T, _ *simapp.SimApp, _ string) {}
