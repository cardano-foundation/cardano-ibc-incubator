#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <cosmos-chain-source-dir> <cardano-ibc-repo-root>" >&2
  exit 64
fi

CHAIN_DIR="$1"
REPO_ROOT="$2"
SOURCE_CORE_DIR="${REPO_ROOT}/cosmos/cardano-probabilistic-light-client-core"

if [ ! -f "${CHAIN_DIR}/go.mod" ]; then
  echo "[cardano-light-client-patch] missing go.mod in ${CHAIN_DIR}" >&2
  exit 1
fi

if [ ! -d "${SOURCE_CORE_DIR}" ]; then
  echo "[cardano-light-client-patch] missing source client core module at ${SOURCE_CORE_DIR}" >&2
  exit 1
fi

MODULE_PATH="$(awk '/^module / { print $2; exit }' "${CHAIN_DIR}/go.mod")"
SOURCE_CORE_MODULE_PATH="$(awk '/^module / { print $2; exit }' "${SOURCE_CORE_DIR}/go.mod")"
if [ -z "${SOURCE_CORE_MODULE_PATH}" ]; then
  echo "[cardano-light-client-patch] could not detect source core module path in ${SOURCE_CORE_DIR}/go.mod" >&2
  exit 1
fi
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

case "${IBC_GO_MAJOR}" in
  8|10)
    SOURCE_CLIENT_DIR="${REPO_ROOT}/cosmos/cardano-probabilistic-light-client-v${IBC_GO_MAJOR}"
    ;;
  *)
    echo "[cardano-light-client-patch] unsupported local patch target ibc-go/v${IBC_GO_MAJOR}; expected v8 or v10" >&2
    exit 1
    ;;
esac

if [ ! -d "${SOURCE_CLIENT_DIR}" ]; then
  echo "[cardano-light-client-patch] missing source client module at ${SOURCE_CLIENT_DIR}" >&2
  exit 1
fi

SOURCE_MODULE_PATH="$(awk '/^module / { print $2; exit }' "${SOURCE_CLIENT_DIR}/go.mod")"
if [ -z "${SOURCE_MODULE_PATH}" ]; then
  echo "[cardano-light-client-patch] could not detect source module path in ${SOURCE_CLIENT_DIR}/go.mod" >&2
  exit 1
fi

case "${MODULE_PATH}" in
  github.com/osmosis-labs/osmosis/*)
    if [ "${IBC_GO_MAJOR}" != "8" ]; then
      echo "[cardano-light-client-patch] Osmosis patching currently supports ibc-go/v8 only" >&2
      exit 1
    fi
    CLIENT_REL_DIR="x/cardano-probabilistic-light-client"
    APP_FILE="${CHAIN_DIR}/app/keepers/modules.go"
    APP_KIND="osmosis"
    ;;
  github.com/InjectiveLabs/injective-core)
    if [ "${IBC_GO_MAJOR}" != "8" ]; then
      echo "[cardano-light-client-patch] Injective patching currently supports ibc-go/v8 only" >&2
      exit 1
    fi
    CLIENT_REL_DIR="injective-chain/modules/cardano-probabilistic-light-client"
    APP_FILE="${CHAIN_DIR}/injective-chain/app/app.go"
    APP_KIND="injective"
    ;;
  github.com/cosmos/ibc-go/v8)
    CLIENT_REL_DIR="testing/simapp/cardano-probabilistic-light-client"
    APP_FILE="${CHAIN_DIR}/testing/simapp/app.go"
    APP_KIND="ibc-go-simapp"
    ;;
  github.com/cosmos/ibc-go/v10)
    CLIENT_REL_DIR="testing/simapp/cardano-probabilistic-light-client"
    # Since v10 the runnable simd application is a nested Go module. Patching
    # testing/simapp alone compiles the client package but does not wire it into
    # the binary produced by `make build`.
    APP_FILE="${CHAIN_DIR}/simapp/app.go"
    APP_KIND="ibc-go-simapp"
    ;;
  *)
    echo "[cardano-light-client-patch] unsupported local app module path ${MODULE_PATH}" >&2
    exit 1
    ;;
esac

CLIENT_DIR="${CHAIN_DIR}/${CLIENT_REL_DIR}"
CLIENT_IMPORT="${MODULE_PATH}/${CLIENT_REL_DIR}"

echo "[cardano-light-client-patch] generating ${CLIENT_IMPORT} from ibc-go/v${IBC_GO_MAJOR} probabilistic client"
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

find "${CLIENT_DIR}" -type f -name '*_test.go' -delete

mkdir -p "${CLIENT_DIR}/internal/core"
(
  cd "${SOURCE_CORE_DIR}"
  tar \
    --exclude go.mod \
    --exclude go.sum \
    --exclude README.md \
    -cf - .
) | (
  cd "${CLIENT_DIR}/internal/core"
  tar -xf -
)

find "${CLIENT_DIR}" -type f -name '*.go' -exec perl -pi -e \
  "s#${SOURCE_MODULE_PATH}#${CLIENT_IMPORT}#g;
   s#${SOURCE_CORE_MODULE_PATH}#${CLIENT_IMPORT}/internal/core#g" {} +

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
elif [ "${APP_KIND}" = "ibc-go-simapp" ]; then
  if ! grep -q "${CLIENT_IMPORT}" "${APP_FILE}"; then
    perl -0pi -e "s#(ibctm \"github.com/cosmos/ibc-go/v${IBC_GO_MAJOR}/modules/light-clients/07-tendermint\"\n)#\$1\tcardanoprobabilistic \"${CLIENT_IMPORT}\"\n#" "${APP_FILE}"
  fi

  if [ "${IBC_GO_MAJOR}" = "8" ]; then
    if ! grep -q 'cardanoprobabilistic.NewAppModule()' "${APP_FILE}"; then
      perl -0pi -e 's#(\t\tibctm\.NewAppModule\(\),\n)#${1}\t\tcardanoprobabilistic.NewAppModule(),\n#' "${APP_FILE}"
    fi
  else
    # ibc-go v10 constructs its tx decoder before the module manager is
    # assembled. Register the Cardano concrete protobuf types explicitly so
    # MsgCreateClient can unpack them during CheckTx/simulation.
    if ! grep -q 'cardanoprobabilistic.RegisterInterfaces(interfaceRegistry)' "${APP_FILE}"; then
      perl -0pi -e 's#(\tstd\.RegisterInterfaces\(interfaceRegistry\)\n)#$1\tcardanoprobabilistic.RegisterInterfaces(interfaceRegistry)\n#' "${APP_FILE}"
    fi
    if ! grep -q 'cardanoLightClientModule := cardanoprobabilistic.NewLightClientModule' "${APP_FILE}"; then
      perl -0pi -e 's#(\tclientKeeper\.AddRoute\(ibctm\.ModuleName, &tmLightClientModule\)\n)#$1\n\tcardanoLightClientModule := cardanoprobabilistic.NewLightClientModule(appCodec, storeProvider)\n\tclientKeeper.AddRoute(cardanoprobabilistic.ModuleName, \&cardanoLightClientModule)\n#' "${APP_FILE}"
    fi
    if ! grep -q 'cardanoprobabilistic.NewAppModule(cardanoLightClientModule)' "${APP_FILE}"; then
      perl -0pi -e 's#(\t\tibctm\.NewAppModule\(tmLightClientModule\),\n)#${1}\t\tcardanoprobabilistic.NewAppModule(cardanoLightClientModule),\n#' "${APP_FILE}"
    fi
  fi
fi

if [ "${APP_KIND}" = "ibc-go-simapp" ]; then
  if [ "${IBC_GO_MAJOR}" = "8" ]; then
    REQUIRED_MARKERS="${CLIENT_IMPORT}
cardanoprobabilistic.NewAppModule()"
  else
    REQUIRED_MARKERS="${CLIENT_IMPORT}
cardanoLightClientModule := cardanoprobabilistic.NewLightClientModule
clientKeeper.AddRoute(cardanoprobabilistic.ModuleName
cardanoprobabilistic.NewAppModule(cardanoLightClientModule)"
  fi

  printf '%s\n' "${REQUIRED_MARKERS}" | while IFS= read -r required_marker; do
    if ! grep -q "${required_marker}" "${APP_FILE}"; then
      echo "[cardano-light-client-patch] failed to wire '${required_marker}' into ${APP_FILE}" >&2
      exit 1
    fi
  done

  if [ "${IBC_GO_MAJOR}" = "10" ] \
    && ! grep -q 'cardanoprobabilistic.RegisterInterfaces(interfaceRegistry)' "${APP_FILE}"; then
    echo "[cardano-light-client-patch] failed to register Cardano protobuf interfaces in ${APP_FILE}" >&2
    exit 1
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
