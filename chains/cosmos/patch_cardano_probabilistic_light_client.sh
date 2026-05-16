#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <cosmos-chain-source-dir> <cardano-ibc-repo-root>" >&2
  exit 64
fi

CHAIN_DIR="$1"
REPO_ROOT="$2"
SOURCE_CLIENT_DIR="${REPO_ROOT}/cosmos/cardano-probabilistic-light-client"

if [ ! -f "${CHAIN_DIR}/go.mod" ]; then
  echo "[cardano-light-client-patch] missing go.mod in ${CHAIN_DIR}" >&2
  exit 1
fi

if [ ! -d "${SOURCE_CLIENT_DIR}" ]; then
  echo "[cardano-light-client-patch] missing source client module at ${SOURCE_CLIENT_DIR}" >&2
  exit 1
fi

MODULE_PATH="$(awk '/^module / { print $2; exit }' "${CHAIN_DIR}/go.mod")"
IBC_GO_MAJOR="$(awk '/github.com\/cosmos\/ibc-go\/v[0-9]+/ {
  for (i = 1; i <= NF; i++) {
    if ($i ~ /^github.com\/cosmos\/ibc-go\/v[0-9]+$/) {
      sub(/^.*\/v/, "", $i)
      print $i
      exit
    }
  }
}' "${CHAIN_DIR}/go.mod")"

if [ -z "${IBC_GO_MAJOR}" ]; then
  echo "[cardano-light-client-patch] could not detect ibc-go major version in ${CHAIN_DIR}/go.mod" >&2
  exit 1
fi

if [ "${IBC_GO_MAJOR}" != "8" ]; then
  echo "[cardano-light-client-patch] unsupported local patch target ibc-go/v${IBC_GO_MAJOR}; currently implemented for local ibc-go/v8 appchains" >&2
  exit 1
fi

case "${MODULE_PATH}" in
  github.com/osmosis-labs/osmosis/*)
    CLIENT_REL_DIR="x/cardano-probabilistic-light-client"
    APP_FILE="${CHAIN_DIR}/app/keepers/modules.go"
    APP_KIND="osmosis"
    ;;
  github.com/InjectiveLabs/injective-core)
    CLIENT_REL_DIR="injective-chain/modules/cardano-probabilistic-light-client"
    APP_FILE="${CHAIN_DIR}/injective-chain/app/app.go"
    APP_KIND="injective"
    ;;
  *)
    echo "[cardano-light-client-patch] unsupported local app module path ${MODULE_PATH}" >&2
    exit 1
    ;;
esac

CLIENT_DIR="${CHAIN_DIR}/${CLIENT_REL_DIR}"
CLIENT_IMPORT="${MODULE_PATH}/${CLIENT_REL_DIR}"

echo "[cardano-light-client-patch] generating ${CLIENT_IMPORT} from canonical probabilistic client"
rm -rf "${CLIENT_DIR}"
mkdir -p "${CLIENT_DIR}"

(
  cd "${SOURCE_CLIENT_DIR}"
  tar \
    --exclude go.mod \
    --exclude go.sum \
    --exclude README.md \
    --exclude PORTING.md \
    --exclude proto \
    -cf - .
) | (
  cd "${CLIENT_DIR}"
  tar -xf -
)

rm -f "${CLIENT_DIR}/light_client_module.go"
find "${CLIENT_DIR}" -type f -name '*_test.go' -delete

find "${CLIENT_DIR}" -type f -name '*.go' -exec perl -pi -e \
  's#github.com/cosmos/ibc-go/v10#github.com/cosmos/ibc-go/v8#g;
   s#commitmenttypesv2 "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types/v2"#commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"#g;
   s#commitmenttypesv2\.#commitmenttypes.#g' {} +

find "${CLIENT_DIR}" -type f -name '*.go' -exec perl -pi -e \
  "s#github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client#${CLIENT_IMPORT}#g" {} +

cat > "${CLIENT_DIR}/module.go" <<'GOEOF'
package probabilistic

import (
	"encoding/json"

	"github.com/grpc-ecosystem/grpc-gateway/runtime"
	"github.com/spf13/cobra"

	"cosmossdk.io/core/appmodule"

	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/types/module"
)

var (
	_ module.AppModuleBasic = (*AppModuleBasic)(nil)
	_ appmodule.AppModule   = (*AppModule)(nil)
)

type AppModuleBasic struct{}

func (AppModuleBasic) IsOnePerModuleType()                         {}
func (AppModuleBasic) IsAppModule()                                {}
func (AppModuleBasic) Name() string                                { return ModuleName }
func (AppModule) IsOnePerModuleType()                              {}
func (AppModule) IsAppModule()                                     {}
func (AppModuleBasic) RegisterLegacyAminoCodec(*codec.LegacyAmino) {}
func (AppModuleBasic) RegisterInterfaces(registry codectypes.InterfaceRegistry) {
	RegisterInterfaces(registry)
}
func (AppModuleBasic) DefaultGenesis(cdc codec.JSONCodec) json.RawMessage { return nil }
func (AppModuleBasic) ValidateGenesis(cdc codec.JSONCodec, config client.TxEncodingConfig, bz json.RawMessage) error {
	return nil
}
func (AppModuleBasic) RegisterGRPCGatewayRoutes(clientCtx client.Context, mux *runtime.ServeMux) {}
func (AppModuleBasic) GetTxCmd() *cobra.Command                                                  { return nil }
func (AppModuleBasic) GetQueryCmd() *cobra.Command                                               { return nil }

type AppModule struct {
	AppModuleBasic
}

func NewAppModule() AppModule {
	return AppModule{}
}
GOEOF

if [ "${APP_KIND}" = "osmosis" ]; then
  if ! grep -q "${CLIENT_IMPORT}" "${APP_FILE}"; then
    perl -0pi -e "s#(tendermint \"github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint\"\\n)#\$1\tcardanoprobabilistic \"${CLIENT_IMPORT}\"\\n#" "${APP_FILE}"
  fi
  if ! grep -q 'cardanoprobabilistic.AppModuleBasic{}' "${APP_FILE}"; then
    perl -0pi -e 's#(\ttendermint\.AppModuleBasic\{\},\n)#${1}\tcardanoprobabilistic.AppModuleBasic{},\n#' "${APP_FILE}"
  fi
elif [ "${APP_KIND}" = "injective" ]; then
  if ! grep -q "${CLIENT_IMPORT}" "${APP_FILE}"; then
    perl -0pi -e "s#(ibctm \"github.com/cosmos/ibc-go/v8/modules/light-clients/07-tendermint\"\\n)#\$1\tcardanoprobabilistic \"${CLIENT_IMPORT}\"\\n#" "${APP_FILE}"
  fi
  if ! grep -q 'cardanoprobabilistic.AppModuleBasic{}' "${APP_FILE}"; then
    perl -0pi -e 's#(\t\tibctm\.AppModuleBasic\{\},\n)#${1}\t\tcardanoprobabilistic.AppModuleBasic{},\n#' "${APP_FILE}"
  fi
  if ! grep -q 'cardanoprobabilistic.NewAppModule()' "${APP_FILE}"; then
    perl -0pi -e 's#(\t\tibctm\.NewAppModule\(\),\n)#${1}\t\tcardanoprobabilistic.NewAppModule(),\n#' "${APP_FILE}"
  fi
fi

if command -v gofmt >/dev/null 2>&1; then
  gofmt -w "${CLIENT_DIR}" "${APP_FILE}"
fi

if command -v go >/dev/null 2>&1; then
  (
    cd "${CHAIN_DIR}"
    GOWORK=off go mod edit \
      -require=github.com/blinklabs-io/gouroboros@v0.89.1 \
      -require=github.com/fxamacker/cbor/v2@v2.7.0 \
      -require=github.com/utxorpc/go-codegen@v0.5.1
  )
else
  if ! grep -q '^[[:space:]]*github.com/blinklabs-io/gouroboros[[:space:]]' "${CHAIN_DIR}/go.mod"; then
    printf '\nrequire github.com/blinklabs-io/gouroboros v0.89.1\n' >> "${CHAIN_DIR}/go.mod"
  fi
  if ! grep -q '^[[:space:]]*github.com/fxamacker/cbor/v2[[:space:]]' "${CHAIN_DIR}/go.mod"; then
    printf 'require github.com/fxamacker/cbor/v2 v2.7.0\n' >> "${CHAIN_DIR}/go.mod"
  fi
  if ! grep -q '^[[:space:]]*github.com/utxorpc/go-codegen[[:space:]]' "${CHAIN_DIR}/go.mod"; then
    printf 'require github.com/utxorpc/go-codegen v0.5.1\n' >> "${CHAIN_DIR}/go.mod"
  fi
fi

echo "[cardano-light-client-patch] patched ${APP_KIND} local app with ${CLIENT_IMPORT}"
