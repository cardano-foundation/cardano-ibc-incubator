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
    indefinite: data.indefinite,
  });
}

// Rebuild nodes rather than cloning them: parser metadata retains original
// integer/header widths and byte chunks, which serialiseData does not preserve.
function normalize(data: CborObj): CborObj {
  if (data instanceof CborUInt || data instanceof CborNegInt) {
    // Plutus distinguishes an ordinary integer from a tagged bignum, including
    // a small bignum with leading zero bytes. Do not canonicalize it to an int.
    if (data.bigNumEncoding) {
      return new CborTag(
        data instanceof CborUInt ? 2 : 3,
        boundedBytes(data.bigNumEncoding.bytes),
      );
    }
    return data instanceof CborUInt
      ? new CborUInt(data.num)
      : new CborNegInt(data.num);
  }
  if (data instanceof CborBytes) return boundedBytes(data.bytes);
  if (data instanceof CborArray) return array(data);
  if (data instanceof CborMap) {
    // Preserve entry order and duplicate keys; a JS Map would lose information.
    return new CborMap(
      data.map.map(({ k, v }) => ({ k: normalize(k), v: normalize(v) })),
      { indefinite: data.indefinite },
    );
  }
  if (data instanceof CborTag) {
    if (
      (data.tag === 2n || data.tag === 3n) && data.data instanceof CborBytes
    ) {
      return new CborTag(data.tag, boundedBytes(data.data.bytes));
    }
    if (
      ((data.tag >= 121n && data.tag <= 127n) ||
        (data.tag >= 1280n && data.tag <= 1400n)) &&
      data.data instanceof CborArray
    ) return new CborTag(data.tag, array(data.data));
    if (data.tag === 102n && data.data instanceof CborArray) {
      const [alternative, fields] = data.data.array;
      if (
        data.data.array.length === 2 && alternative instanceof CborUInt &&
        !alternative.bigNumEncoding && alternative.num <= 0xffffffffffffffffn &&
        fields instanceof CborArray
      ) {
        // Preserve tag 102 even for alternatives with a compact tag. Its outer
        // (alternative, fields) pair is always definite; the fields needn't be.
        return new CborTag(
          102,
          new CborArray([
            new CborUInt(alternative.num),
            array(fields),
          ]),
        );
      }
    }
  }
  throw new Error("unsupported non-Plutus Data encoding");
}

/**
 * Match Aiken 1.1.21's serialiseData for decoded Plutus Data, without changing
 * the legacy public IBC commitment encoding. Input must be the original CML
 * subtree: Data.from()/Data.to() loses definite/indefinite container choices.
 * Use raw bytes/hex when exact original encoding matters: some CML versions
 * discard bignum leading zeros or convert small bignums to ordinary integers.
 * No serializer can recover information already discarded by its caller.
 *
 * This is a normalization adapter over the existing CBOR parser, not a general
 * CBOR codec. It preserves container forms, map order, and constructor/bignum
 * tags; normalizes integer/header widths; and rechunks byte strings at 64 bytes.
 * Reference implementation (the codec used by Aiken 1.1.21):
 * https://github.com/txpipe/pallas/blob/v0.33.0/pallas-primitives/src/plutus_data.rs
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

function fields(data: CborObj, count: number, label: string): CborObj[] {
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
  if (!(contents instanceof CborArray) || contents.array.length !== count) {
    throw new Error(`invalid ${label}`);
  }
  return contents.array;
}

/** Extract only the two public leaves of the prototype's singleton State. */
export function publicClientCommitmentValues(datumCbor: string): {
  clientValue: string;
  consensusValue: string;
} {
  const [client] = fields(parseData(datumCbor), 2, "prototype state");
  const [clientDatum] = fields(client, 2, "client datum");
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
