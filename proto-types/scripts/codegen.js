#!/usr/bin/env node

const { join } = require("path");
const { readFileSync, writeFileSync } = require("fs");
const telescope = require("@cosmology/telescope").default;

const outPath = join(__dirname, "/../src");

function preserveUnsignedVarintHelpers() {
  const varintPath = join(outPath, "varint.ts");
  let source = readFileSync(varintPath, "utf8");

  const preservedWriteVarint64 = `export function writeVarint64(val: { lo: number; hi: number }, buf: Uint8Array | number[], pos: number) {
  let lo = val.lo >>> 0;
  let hi = val.hi >>> 0;

  while (hi) {
    buf[pos++] = (lo & 127) | 128;
    lo = ((lo >>> 7) | (hi << 25)) >>> 0;
    hi >>>= 7;
  }
  while (lo > 127) {
    buf[pos++] = (lo & 127) | 128;
    lo >>>= 7;
  }
  buf[pos++] = lo;
}`;

  const generatedInt64Length = `export function int64Length(lo: number, hi: number) {
  let part0 = lo,
    part1 = ((lo >>> 28) | (hi << 4)) >>> 0,
    part2 = hi >>> 24;`;

  const preservedInt64Length = `export function int64Length(lo: number, hi: number) {
  const unsignedLo = lo >>> 0;
  const unsignedHi = hi >>> 0;
  let part0 = unsignedLo,
    part1 = ((unsignedLo >>> 28) | (unsignedHi << 4)) >>> 0,
    part2 = unsignedHi >>> 24;`;

  const withPreservedWrite = source.replace(
    /export function writeVarint64\([\s\S]*?\n\}\n\nexport function int64Length/,
    `${preservedWriteVarint64}\n\nexport function int64Length`,
  );
  if (withPreservedWrite === source) {
    throw new Error("Unable to preserve unsigned writeVarint64 helper");
  }

  const withPreservedLength = withPreservedWrite.replace(generatedInt64Length, preservedInt64Length);
  if (withPreservedLength === withPreservedWrite) {
    throw new Error("Unable to preserve unsigned int64Length helper");
  }

  source = withPreservedLength;
  writeFileSync(varintPath, source);
}

telescope({
  protoDirs: ["protos/ibc-go"],
  outPath: outPath,
  options: {
    logLevel: 0,
    useInterchainJs: false,
    useSDKTypes: false,
    tsDisable: {
      disableAll: false,
    },
    helperFunctions: {
      enabled: false,
    },
    eslintDisable: {
      disableAll: true,
    },
    bundle: {
      enabled: false,
    },
    interfaces: {
      enabled: false,
    },
    prototypes: {
      parser: {
        keepCase: true,
      },
      includePackageVar: true,
      strictNullCheckForPrototypeMethods: true,
      paginationDefaultFromPartial: true,
      addTypeUrlToObjects: true,
      // Those are causing trouble in CosmJS testing (https://github.com/cosmology-tech/telescope/issues/489)
      addTypeUrlToDecoders: false,
      excluded: {
        protos: [
          "cosmos/autocli/v1/options.proto",
          "cosmos/autocli/v1/query.proto",
          "cosmos/authz/v1beta1/event.proto",
          "cosmos/base/reflection/v2alpha1/reflection.proto",
          "cosmos/crypto/secp256r1/keys.proto",
          "ibc/core/port/v1/query.proto",
          "ibc/lightclients/solomachine/v2/solomachine.proto",
          "tendermint/libs/bits/types.proto",
          "google/api/httpbody.proto",
          "tendermint/blockchain/types.proto",
          "tendermint/consensus/types.proto",
          "tendermint/consensus/wal.proto",
          "tendermint/mempool/types.proto",
          "tendermint/p2p/conn.proto",
          "tendermint/p2p/pex.proto",
          "tendermint/privval/types.proto",
          "tendermint/rpc/grpc/types.proto",
          "tendermint/state/types.proto",
          "tendermint/statesync/types.proto",
          "tendermint/store/types.proto",
          "tendermint/types/canonical.proto",
          "tendermint/types/events.proto",
        ],
      },
      methods: {
        // There are users who need those functions. CosmJS does not need them directly.
        // See https://github.com/cosmos/cosmjs/pull/1329
        fromJSON: true,
        toJSON: true,
        fromAmino: false,
        toAmino: false,
        fromProto: false,
        toProto: false,
      },
      typingsFormat: {
        useDeepPartial: true,
        useExact: true,
        toJsonUnknown: true,
        useTelescopeGeneratedType: false,
        timestamp: "timestamp",
        duration: "duration",
        customTypes: {
          useCosmosSDKDec: false,
        },
        num64: "bigint",
      },
    },
    lcdClients: {
      enabled: false,
    },
    rpcClients: {
      enabled: true,
      inline: true,
      extensions: false,
      camelCase: false,
      enabledServices: ["Msg", "Query", "Service", "ReflectionService", "ABCIApplication"],
    },
    aminoEncoding: {
      enabled: false,
      useLegacyInlineEncoding: true,
    },
  },
}).then(
  () => {
    // Create index.ts
    const index_ts = `
    // Auto-generated, see scripts/codegen.js!

    // Exports we want to provide at the root of the "cosmjs-types" package

    export { DeepPartial, Exact } from "./helpers";
    `;
    writeFileSync(`${outPath}/index.ts`, index_ts);
    preserveUnsignedVarintHelpers();

    console.log("All Done!");
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
