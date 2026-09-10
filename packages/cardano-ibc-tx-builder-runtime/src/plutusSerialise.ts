import type { CML } from "@lucid-evolution/lucid";
import { Buffer } from "node:buffer";
import {
  Cbor,
  CborArray,
  CborBytes,
  CborMap,
  CborNegInt,
  type CborObj,
  CborTag,
  CborUInt,
  LazyCborArray,
  LazyCborMap,
  type LazyCborObj,
  LazyCborTag,
} from "@harmoniclabs/cbor";

function boundedBytes(bytes: Uint8Array): CborBytes {
  if (bytes.length <= 64) return new CborBytes(bytes);
  const chunks: CborBytes[] = [];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    chunks.push(new CborBytes(bytes.slice(offset, offset + 64)));
  }
  return new CborBytes(chunks);
}

function array(data: CborArray): CborArray {
  return new CborArray(data.array.map(normalize), {
    indefinite: data.array.length > 0,
  });
}

function unsignedBytes(bytes: Uint8Array): bigint {
  const hex = Buffer.from(bytes).toString("hex");
  return hex.length === 0 ? 0n : BigInt("0x" + hex);
}

function integer(value: bigint): CborObj {
  const magnitude = value < 0n ? -1n - value : value;
  if (magnitude <= 0xffffffffffffffffn) {
    return value < 0n ? new CborNegInt(value) : new CborUInt(value);
  }
  const hex = magnitude.toString(16);
  return new CborTag(
    value < 0n ? 3 : 2,
    boundedBytes(Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex")),
  );
}

function constructor(alternative: bigint, fields: CborArray): CborTag {
  if (alternative < 7n) return new CborTag(121n + alternative, array(fields));
  if (alternative < 128n) {
    return new CborTag(1280n + alternative - 7n, array(fields));
  }
  return new CborTag(
    102,
    new CborArray([new CborUInt(alternative), array(fields)]),
  );
}

// Rebuild semantic Data, not its wire representation. Ledger serialiseData
// forgets container forms, constructor aliases and integer/bignum encodings.
function normalize(data: CborObj): CborObj {
  if (data instanceof CborUInt || data instanceof CborNegInt) {
    if (data.bigNumEncoding) {
      const magnitude = unsignedBytes(data.bigNumEncoding.bytes);
      return integer(data instanceof CborUInt ? magnitude : -1n - magnitude);
    }
    return integer(data.num);
  }
  if (data instanceof CborBytes) return boundedBytes(data.bytes);
  if (data instanceof CborArray) return array(data);
  if (data instanceof CborMap) {
    // Preserve entry order and duplicate keys; a JS Map would lose information.
    return new CborMap(
      data.map.map(({ k, v }) => ({ k: normalize(k), v: normalize(v) })),
      { indefinite: false },
    );
  }
  if (data instanceof CborTag) {
    if (
      (data.tag === 2n || data.tag === 3n) && data.data instanceof CborBytes
    ) {
      const magnitude = unsignedBytes(data.data.bytes);
      return integer(data.tag === 2n ? magnitude : -1n - magnitude);
    }
    if (
      ((data.tag >= 121n && data.tag <= 127n) ||
        (data.tag >= 1280n && data.tag <= 1400n)) &&
      data.data instanceof CborArray
    ) {
      const alternative = data.tag < 128n
        ? data.tag - 121n
        : data.tag - 1280n + 7n;
      return constructor(alternative, data.data);
    }
    if (data.tag === 102n && data.data instanceof CborArray) {
      const [alternative, fields] = data.data.array;
      if (
        data.data.array.length === 2 && alternative instanceof CborUInt &&
        !alternative.bigNumEncoding && alternative.num <= 0xffffffffffffffffn &&
        fields instanceof CborArray
      ) {
        return constructor(alternative.num, fields);
      }
    }
  }
  throw new Error("unsupported non-Plutus Data encoding");
}

/**
 * Match the Haskell ledger's serialiseData, not datum-hash/wire serialization:
 * nonempty lists/constructor fields are indefinite, empty lists and all maps
 * are definite, constructors use compact tags when possible, and integers use
 * minimal mathematical encoding. Map order and duplicate keys remain intact.
 * Raw CBOR avoids losing duplicate map entries through a JavaScript Map.
 *
 * Ledger: PlutusCore/Data.hs encodeData/encodeInteger/encodeBs; list encoding:
 * https://github.com/IntersectMBO/plutus/blob/master/plutus-core/plutus-core/src/PlutusCore/Data.hs
 * https://github.com/well-typed/cborg/blob/master/serialise/src/Codec/Serialise/Class.hs
 * Aiken <=1.1.21's CEK incorrectly preserves input container forms (#1298).
 * This public-leaf adapter does not change the private history record ABI.
 */
export function serialisePlutusData(
  data: CML.PlutusData | Uint8Array | string,
): string {
  const parsed = parseData(data);
  return Cbor.encode(normalize(parsed)).toString();
}

function parseData(data: CML.PlutusData | Uint8Array | string): CborObj {
  if (
    typeof data === "string" &&
    (data.length === 0 || data.length % 2 !== 0 || /[^0-9a-fA-F]/.test(data))
  ) throw new Error("invalid Plutus Data CBOR hex");
  const bytes = typeof data === "string"
    ? Buffer.from(data, "hex")
    : data instanceof Uint8Array
    ? data
    : data.to_cbor_bytes();
  // The lazy parser retains bignum tags, including empty payloads. The eager
  // parser tries BigInt("0x") for an empty bignum and throws before normalization.
  const { parsed, offset } = Cbor.parseLazyWithOffset(bytes);
  if (offset !== bytes.length) throw new Error("trailing Plutus Data CBOR");
  return expand(parsed, bytes[0]);
}

function expand(data: LazyCborObj, firstByte?: number): CborObj {
  if (data instanceof LazyCborArray) {
    return new CborArray(data.array.map(parseData), {
      indefinite: data.indefinite,
    });
  }
  if (data instanceof LazyCborMap) {
    // cbor 1.6.6's lazy parser incorrectly marks definite maps indefinite.
    // All valid Plutus maps are bare map items, so use their original header.
    // Its runtime also calls the entries property `array`, contrary to .d.ts.
    const entries = (data as unknown as {
      array: Array<{ k: Uint8Array; v: Uint8Array }>;
    }).array;
    return new CborMap(
      entries.map(({ k, v }) => ({ k: parseData(k), v: parseData(v) })),
      { indefinite: firstByte === 0xbf },
    );
  }
  if (data instanceof LazyCborTag) {
    return new CborTag(data.tag, expand(data.data));
  }
  return data;
}

function fields(
  data: CborObj,
  count: number | readonly number[],
  label: string,
): CborObj[] {
  const counts = typeof count === "number" ? [count] : count;
  let contents: CborObj | undefined;
  if (data instanceof CborTag && data.tag === 121n) contents = data.data;
  if (
    data instanceof CborTag && data.tag === 102n &&
    data.data instanceof CborArray && data.data.array.length === 2
  ) {
    const [alternative, body] = data.data.array;
    if (
      alternative instanceof CborUInt && !alternative.bigNumEncoding &&
      alternative.num === 0n
    ) contents = body;
  }
  if (
    !(contents instanceof CborArray) || !counts.includes(contents.array.length)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return contents.array;
}

/** Extract ledger-normalized public leaves independently of private history. */
export function publicClientCommitmentValues(
  datumCbor: string,
  layout: "production" | "prototype" = "prototype",
): {
  clientValue: string;
  consensusValue: string;
} {
  const data = parseData(datumCbor);
  const client = layout === "prototype"
    ? fields(data, 2, "prototype state")[0]
    : data;
  const [clientDatum] = fields(
    client,
    layout === "prototype" ? [2, 3] : 3,
    "client datum",
  );
  const [clientState, consensus] = fields(clientDatum, 4, "client state datum");
  fields(clientState, 8, "client state");
  if (!(consensus instanceof CborMap) || consensus.map.length !== 1) {
    throw new Error(
      "consensus states must contain exactly the latest checkpoint",
    );
  }
  const consensusState = consensus.map[0].v;
  fields(consensusState, 3, "consensus state");
  return {
    clientValue: Cbor.encode(normalize(clientState)).toString(),
    consensusValue: Cbor.encode(normalize(consensusState)).toString(),
  };
}
