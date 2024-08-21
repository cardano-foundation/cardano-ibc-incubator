/**
 * A hex-encoded string representing a CBOR encoded value.
 */
type CborHexStr = string;

/** A hex-encoded string representing an address. */
type AddressHexStr = string;

/** A hex-encoded string or a Bech32 string representing an address. */
type AddressInputStr = string;

/** A hex-encoded string of the corresponding bytes. */
type HexStr = string;

/**
 * `page` is zero indexed.
 */
type Paginate = { page: number; limit: number };

type WalletApiExtension = { cip: number };

interface DataSignature {
  key: HexStr;
  signature: HexStr;
}

export type {
  CborHexStr,
  AddressHexStr,
  AddressInputStr,
  HexStr,
  Paginate,
  WalletApiExtension,
  DataSignature,
};
