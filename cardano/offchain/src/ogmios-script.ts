import { type Script, toScriptRef } from "@lucid-evolution/lucid";
import { Cbor, CborBytes, CborTag } from "@harmoniclabs/cbor";

/** Ogmios's documented tagged-CBOR Script representation. Its v6.12 JSON
 * language/cbor decoder checks scripts at the language's introduction protocol
 * version, rejecting later enabled builtins (for example readBit in V3).
 * The CBOR representation retains the language tag and exact script bytes;
 * actual ledger evaluation still uses the node's current protocol/cost model.
 * Source: Ogmios v6.12.0 Data/Json/Query.hs decodeScript.
 */
export function toOgmiosScript(script: Script | undefined): string | null {
  if (!script) return null;
  return Cbor.encode(
    new CborTag(24, new CborBytes(toScriptRef(script).to_cbor_bytes())),
  ).toString();
}
