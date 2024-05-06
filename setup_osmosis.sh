#!/usr/bin/env bash

cp osmosis.patch ./chains/osmosis/osmosis.patch
cd ./chains/osmosis && git apply osmosis.patch