#!/usr/bin/env bash

# Prepare a "devnet" directory holding credentials, a dummy topology and
# "up-to-date" genesis files. If the directory exists, it is wiped out.
set -e

BASEDIR=$(realpath $(dirname $(realpath $0))/..)
TARGETDIR="devnet"
KUPODBDIR="kupo-db"
DBSYNCDATADIR="db-sync-data"
POSTGRESDIR="postgres"
BASEINFODIR="baseinfo"

[ -d "$TARGETDIR" ] && { echo "Cleaning up directory $TARGETDIR" ; sudo rm -r $TARGETDIR ; }
[ -d "$KUPODBDIR" ] && { echo "Cleaning up directory $KUPODBDIR" ; sudo rm -r $KUPODBDIR ; }
[ -d "$DBSYNCDATADIR" ] && { echo "Cleaning up directory $DBSYNCDATADIR" ; sudo rm -r $DBSYNCDATADIR ; }
[ -d "$POSTGRESDIR" ] && { echo "Cleaning up directory $POSTGRESDIR" ; sudo rm -r $POSTGRESDIR ; }
[ -d "$BASEINFODIR" ] && { echo "Cleaning up directory $BASEINFODIR" ; sudo rm -r $BASEINFODIR ; }

cp -af "$BASEDIR/chains/config/devnet/" "$TARGETDIR"
cp -af "$BASEDIR/chains/config/credentials" "$TARGETDIR"
cp -af "$BASEDIR/chains/config/protocol-parameters.json" "$TARGETDIR"
echo '{"Producers": []}' > "$TARGETDIR/topology.json"
sed -i.bak "s/\"startTime\": [0-9]*/\"startTime\": $(date +%s)/" "$TARGETDIR/genesis-byron.json" && \
sed -i.bak "s/\"systemStart\": \".*\"/\"systemStart\": \"$(date -u +%FT%TZ)\"/" "$TARGETDIR/genesis-shelley.json"

find $TARGETDIR -type f -exec chmod 0400 {} \;
mkdir "$TARGETDIR/ipc"
echo "Prepared devnet, you can start the cluster now"

