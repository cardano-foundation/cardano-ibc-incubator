#!/usr/bin/env bash

mkdir -p go
mkdir -p go/ibc
cp -r scripts/configs/* go
cp -r protos/ibc-go/ibc go
cd go
mkdir -p ibc/clients/cardano/v1
mv ibc/lightclients/ouroboros ibc/clients/cardano/v1

buf mod init

buf mod update

buf generate --template buf.gen.gogo.yaml $file

cd ..
