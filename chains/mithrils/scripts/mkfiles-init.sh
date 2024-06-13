# Get the operating system
UNAME=$(uname -s) OPERATING_SYSTEM=
case $UNAME in
  Darwin )      OPERATING_SYSTEM="macos";;
  Linux )       OPERATING_SYSTEM="linux";;
  * )           echo "Error: Unsupported operating system. This script can only be run on Linux or MacOS."
                exit 1;;
esac

SUDO=""
if sudo --version > /dev/null 2>&1; then
  SUDO="sudo"
fi
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
[ -d "$ARTIFACTS_DIR" ] && { echo "Cleaning up directory $ARTIFACTS_DIR" ; ${SUDO} rm -r $ARTIFACTS_DIR ; }
mkdir -p $ARTIFACTS_DIR
${SUDO} chmod 777 $ARTIFACTS_DIR

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
  SKIP_CARDANO_BIN_DOWNLOAD=true
fi

# Download cardano-cli & cardano-node if enabled (default: yes)
if [[ "$SKIP_CARDANO_BIN_DOWNLOAD" != "true" ]]; then
  echo ">> Downloading cardano-cli & cardano-node..."
  curl -sL ${CARDANO_BINARY_URL} --output cardano-bin.tar.gz
  tar xzf cardano-bin.tar.gz ./bin/cardano-cli ./bin/cardano-node && mv ./bin/cardano-{cli,node} . && rm -rf ./bin  || tar xzf cardano-bin.tar.gz ./cardano-cli ./cardano-node
  rm -f cardano-bin.tar.gz
fi

# set permission for the node.socket
set_up_permission() {
  chown "${USER:=$(/usr/bin/id -run)}" "./chains/cardano/devnet/node.socket" &&
  ${SUDO} chmod 777 "./chains/cardano/devnet/node.socket" &&
  ${SUDO} chmod 777 "./chains/cardano/devnet/kes.skey" &&
  ${SUDO} chmod 777 "./chains/cardano/devnet/opcert.cert" || return 1
  return 0
}
if set_up_permission; then
    echo >&2 -e "\nSet permission successful!";
else
    echo >&2 -e "\nWARNING: Fails to set permission for the files.";
fi
