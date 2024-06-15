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
