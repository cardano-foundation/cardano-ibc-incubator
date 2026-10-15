package probabilistic

import (
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

var _ exported.ClientMessage = (*MithrilStakeCertificates)(nil)

func (MithrilStakeCertificates) ClientType() string {
	return ModuleName
}

func (certificates MithrilStakeCertificates) ValidateBasic() error {
	return adapterError(toCoreMithrilStakeCertificates(&certificates).ValidateBasic())
}
