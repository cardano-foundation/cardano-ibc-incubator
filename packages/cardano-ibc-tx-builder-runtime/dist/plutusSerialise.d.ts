import type { CML } from "@lucid-evolution/lucid";
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
export declare function serialisePlutusData(data: CML.PlutusData | Uint8Array | string): string;
/** Extract ledger-normalized public leaves independently of private history. */
export declare function publicClientCommitmentValues(datumCbor: string, layout?: "production" | "prototype"): {
    clientValue: string;
    consensusValue: string;
};
