package cardano

import (
	"fmt"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
)

const (
	ModuleName              = "099-cardano"
	KeyClientSPOsPrefix     = "clientSPOs"
	KeyRegisterCertPrefix   = "registerCert"
	KeyUnregisterCertPrefix = "unregisterCert"
	KeyUTXOsPrefix          = "utxos"
)

func ClientSPOsKey(epoch uint64) []byte {
	return []byte(ClientSPOsPath(epoch))
}

func ClientUTXOKey(height exported.Height, txHash, txIndex string) []byte {
	return []byte(ClientUTXOPath(height, txHash, txIndex))
}

func RegisterCertKey(epochNo uint64) []byte {
	return []byte(RegisterCertPath(epochNo))
}

func UnregisterCertKey(epochNo string) []byte {
	return []byte(UnregisterCertPath(epochNo))
}

func ClientSPOsPath(epochNo uint64) string {
	return fmt.Sprintf("%s/%v", KeyClientSPOsPrefix, epochNo)
}

func ClientUTXOPath(height exported.Height, txHash, txIndex string) string {
	return fmt.Sprintf("%s/%s/%s/%s", KeyUTXOsPrefix, height, txHash, txIndex)
}

func RegisterCertPath(epochNo uint64) string {
	return fmt.Sprintf("%s/%v", KeyRegisterCertPrefix, epochNo)
}

func UnregisterCertPath(epochNo string) string {
	return fmt.Sprintf("%s/%v", KeyUnregisterCertPrefix, epochNo)
}
