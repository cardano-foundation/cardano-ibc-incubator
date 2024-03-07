#!/usr/bin/env bash
cd tx-cardano

cp .env.example .env

npm install --legacy-peer-deps

npm start