package module

import "github.com/cosmos/ibc-go/v7/modules/core/exported"

const (
	ModuleName              = "099-cardano"
	KeyClientSPOsPrefix     = "clientSPOs"
	KeyRegisterCertPrefix   = "registerCert"
	KeyUnregisterCertPrefix = "unregisterCert"
)

var _ exported.ClientMessage = (*BlockData)(nil)

func (x BlockData) ClientType() string {
	//TODO implement me
	//panic("implement me")
	return ModuleName
}

func (x BlockData) ValidateBasic() error {
	//TODO implement me
	//panic("implement me")
	return nil
}
