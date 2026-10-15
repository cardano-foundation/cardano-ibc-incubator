#!/bin/sh
# Runs a local Mithril aggregator or signer. Like Mithril's own end-to-end
# tests, both start in Cardano epoch 1: in epoch 0 there is no earlier epoch to
# read signers and protocol parameters from, and the nodes may have no
# completed immutable file yet. The genesis certificate needs signers
# registered in an earlier epoch, so the aggregator creates it from epoch 2,
# while it serves, as Mithril's production runbook does.
set -u

case "${1:-}" in
  aggregator | signer) ;;
  *) echo "usage: mithril.sh aggregator|signer" >&2; exit 2 ;;
esac

server=
trap '[ -n "$server" ] && kill "$server"; exit 0' INT TERM

pause() {
  sleep "$1" &
  wait $!
}

epoch() {
  wget -qO- http://devkit:1337/health | sed -n 's/.*"currentEpoch": *\([0-9]*\).*/\1/p'
}

until [ "$(epoch)" -ge 1 ] 2>/dev/null; do pause 30; done
[ "$1" = signer ] && exec /app/bin/mithril-signer -vvv

/app/bin/mithril-aggregator -vvv serve &
server=$!
# The marker records the genesis certificate, so a restart never creates a
# second one.
until [ -f /mithril/genesis-created ]; do
  pause 60
  kill -0 "$server" || exit 1
  if /app/bin/mithril-aggregator -vvv genesis bootstrap; then
    touch /mithril/genesis-created
  fi
done
wait "$server"
