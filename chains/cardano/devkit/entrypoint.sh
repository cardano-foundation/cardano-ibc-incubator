#!/bin/sh
set -eu
if [ -f /clusters/nodes/default/cluster-info.json ]; then
    printf 'node\nstart\n' > /tmp/devkit.commands
else
    printf 'create-node --slot-length 1 --block-time 4 --epoch-length 600 --era conway --start\n' > /tmp/devkit.commands
fi
exec /app/yaci-cli script --file /tmp/devkit.commands
