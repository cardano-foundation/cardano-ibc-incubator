#!/bin/sh
set -eu
if [ -n "${DEVKIT_CLOCK_FILE:-}" ]; then
    test -r "$DEVKIT_CLOCK_FILE"
    unset FAKETIME
    export FAKETIME_TIMESTAMP_FILE="$DEVKIT_CLOCK_FILE"
    export FAKETIME_NO_CACHE=1
else
    export FAKETIME="${DEVKIT_CLOCK_OFFSET:?Missing persisted local network clock}"
fi
DEVKIT_EPOCH_LENGTH="${DEVKIT_EPOCH_LENGTH:-5000}"
case "$DEVKIT_EPOCH_LENGTH" in
    *[!0-9]*|'') exit 1 ;;
esac
[ "$DEVKIT_EPOCH_LENGTH" -ge 5000 ] && [ "$DEVKIT_EPOCH_LENGTH" -le 432000 ]
# With libfaketime 0.9.10, setting this to 1 makes the native Java CLI's
# timed waits expire immediately and keeps its background threads busy.
export FAKETIME_DONT_FAKE_MONOTONIC=0
# Shared clock reloads need the thread-safe library for the Cardano producers.
for library in /usr/lib/*/faketime/libfaketime${DEVKIT_CLOCK_FILE:+MT}.so.1; do
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
    printf 'create-node --slot-length 1 --block-time 4 --epoch-length %s --era conway --start\n' "$DEVKIT_EPOCH_LENGTH" > /tmp/devkit.commands
fi
exec /app/yaci-cli script --file /tmp/devkit.commands
