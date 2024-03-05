#!/usr/bin/env bash

#set -eo pipefail

echo "Generating gogo proto code"
cd proto

buf generate --template buf.gen.gogo.yaml $file

# move proto files to the right places
cp -r sidechain/x/clients/cardano/*.pb.go ../x/clients/cardano
rm -rf sidechain

cd ..

go mod tidy
