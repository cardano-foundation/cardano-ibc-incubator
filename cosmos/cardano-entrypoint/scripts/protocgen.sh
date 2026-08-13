#!/usr/bin/env bash

#set -eo pipefail

echo "Generating gogo proto code"
cd proto

buf generate --template buf.gen.gogo.yaml $file

rm -rf entrypoint

cd ..

go mod tidy
