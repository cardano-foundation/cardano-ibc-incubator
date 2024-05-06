#!/usr/bin/env bash

cp osmosis.patch ./chains/osmosis
cd ./chains/osmosis && git apply osmosis.patch