#!/bin/bash

aiken build
deno run -A ./aiken-to-lucid/src/main.ts

folder="./deployments"
file="handler.json"

# Re-run deploy until find deployment file
while [ ! -f "$folder/$file" ]; do
    echo "File $file not found in $folder. Re-deploy..."
    deno run -A src/deploy.ts
    sleep 1
done