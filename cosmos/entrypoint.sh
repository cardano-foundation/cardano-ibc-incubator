#!/bin/bash

source $HOME/.bashrc
cd /root/sidechain/workspace2/sidechain
cp /root/sidechain/workspace2/go/libcardano-ibc-helper.so /root/sidechain/workspace2/sidechain/x/clients/cardano/

DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' C_INCLUDE_PATH="/root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include:$C_INCLUDE_PATH" ignite chain serve -y -v
# DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' C_INCLUDE_PATH="/root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include:$C_INCLUDE_PATH" sidechaind start --minimum-gas-prices 0stake

exec "$@"