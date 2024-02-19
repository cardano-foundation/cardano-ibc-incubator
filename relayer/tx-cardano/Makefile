gen-protoc:
    protoc -I=./src/proto --ts_out=./src/proto/protoc ./src/proto/*.proto

gen-protoc-use-package:
    protoc \
    --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
    --ts_out=./src/proto/protoc \
    -I ./src/proto \
    ./src/proto/*.proto
