#!/usr/bin/env bash

SCRIPT_DIR=$(dirname $(realpath $0))

# Check if MITHRIL_IMAGE_ID env vars are set 
if [ -z "${MITHRIL_IMAGE_ID}" ]; then
  git submodule update --init --recursive
fi

