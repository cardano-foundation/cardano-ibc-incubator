#!/bin/sh
set -eu
export FAKETIME="${DEVKIT_CLOCK_OFFSET:?Missing persisted local network clock}"
# With libfaketime 0.9.10, setting this to 1 makes the native Java CLI's
# timed waits expire immediately and keeps its background threads busy.
export FAKETIME_DONT_FAKE_MONOTONIC=0
for library in /usr/lib/*/faketime/libfaketime.so.1; do
    if [ -r "$library" ]; then
        export LD_PRELOAD="$library"
        break
    fi
done
if [ -f /clusters/nodes/default/cluster-info.json ]; then
    printf 'node\nstart\n' > /tmp/devkit.commands
elif [ "${DEVKIT_PEER:-false}" = true ]; then
    mkdir -p /clusters/pool-keys/default
    cp /bootstrap/"${DEVKIT_PRODUCER}"/* /clusters/pool-keys/default/
    printf 'join --admin-url http://devkit.local:10000 --bp\nstart\n' > /tmp/devkit.commands
else
    printf 'create-node --slot-length 1 --block-time 4 --epoch-length 5000 --era conway --start\n' > /tmp/devkit.commands
fi
exec /app/yaci-cli script --file /tmp/devkit.commands
