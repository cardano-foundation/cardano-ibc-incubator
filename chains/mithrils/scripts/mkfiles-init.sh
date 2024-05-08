# Get the operating system
UNAME=$(uname -s) OPERATING_SYSTEM=
case $UNAME in
  Darwin )      OPERATING_SYSTEM="macos";;
  Linux )       OPERATING_SYSTEM="linux";;
  * )           echo "Error: Unsupported operating system. This script can only be run on Linux or MacOS."
                exit 1;;
esac

# Cardano node version
if [ -z "${CARDANO_NODE_VERSION}" ]; then 
  CARDANO_NODE_VERSION="8.7.3"
fi
if [ -z "${CARDANO_NODE_VERSION_RELEASE}" ]; then 
  CARDANO_NODE_VERSION_RELEASE=$(echo ${CARDANO_NODE_VERSION} | cut -d'-' -f1)
fi
if [ -z "${CARDANO_BINARY_URL}" ]; then 
  CARDANO_BINARY_URL="https://github.com/input-output-hk/cardano-node/releases/download/${CARDANO_NODE_VERSION}/cardano-node-${CARDANO_NODE_VERSION_RELEASE}-${OPERATING_SYSTEM}.tar.gz"
fi

ARTIFACTS_DIR=./chains/mithrils/data
# Check if root directory already exists
if ! mkdir -p "${ARTIFACTS_DIR}"; then
  echo "The ${ARTIFACTS_DIR} directory already exists, please move or remove it"
fi

# Check if docker-compose.yaml file is already existed
DOCKER_FILE=./docker-compose.yaml
if [ -f "${DOCKER_FILE}" ]; then
  rm -f ${DOCKER_FILE}
fi

# Check if the cardano-cli & cardano-node binaries are already downloaded
CARDANO_CLI_FILE=./cardano-cli
# Check if the cardano-cli file exists
if [ -f "${CARDANO_CLI_FILE}" ]; then
  echo "The cardano-cli file does not exist. Please download it."
  return
fi

# Download cardano-cli & cardano-node if enabled (default: yes)
if [[ "$SKIP_CARDANO_BIN_DOWNLOAD" != "true" ]]; then
  echo ">> Downloading cardano-cli & cardano-node..."
  curl -sL ${CARDANO_BINARY_URL} --output cardano-bin.tar.gz
  tar xzf cardano-bin.tar.gz ./bin/cardano-cli ./bin/cardano-node && mv ./bin/cardano-{cli,node} . && rm -rf ./bin  || tar xzf cardano-bin.tar.gz ./cardano-cli ./cardano-node
  rm -f cardano-bin.tar.gz
fi
