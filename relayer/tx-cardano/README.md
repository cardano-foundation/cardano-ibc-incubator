# tx-cardano



## Getting started





## Gen proto file

use npm package [protoc-gen-ts](https://www.npmjs.com/package/protoc-gen-ts)

```
npm install -g protoc-gen-ts@0.8.7
protoc -I=./src/proto --ts_out=./src/proto/protoc ./src/proto/*.proto
```

