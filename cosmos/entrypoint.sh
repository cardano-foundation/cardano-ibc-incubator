#!/bin/bash

source $HOME/.bashrc
cd /root/sidechain/workspace/sidechain

DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain serve -y -v

exec "$@"