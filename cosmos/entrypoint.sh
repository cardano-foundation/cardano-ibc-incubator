#!/bin/bash

source $HOME/.bashrc
cd /root/entrypoint/workspace/entrypoint

DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' ignite chain serve -y -v

exec "$@"