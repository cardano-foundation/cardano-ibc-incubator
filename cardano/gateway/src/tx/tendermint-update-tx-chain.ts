import { BinaryWriter } from '@cardano-ibc/proto-types/build/binary';

export const TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL = '/ibc.cardano.v1.TendermintUpdateTxChain';
export const TENDERMINT_UPDATE_TX_CHAIN_VERSION = 1;
export const MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH = 100;

function normalizeUnsignedTxCbor(unsignedTxCbor: string, index: number): string {
  if (unsignedTxCbor.length === 0 || unsignedTxCbor.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(unsignedTxCbor)) {
    throw new Error(`Invalid unsigned transaction CBOR hex at chain index ${index}`);
  }
  return unsignedTxCbor.toLowerCase();
}

export function encodeTendermintUpdateTxChain(
  unsignedTxCbor: readonly string[],
  options: { rebuildAfterSubmission?: boolean } = {},
): Uint8Array {
  if (unsignedTxCbor.length === 0 || unsignedTxCbor.length > MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH) {
    throw new Error(
      `Tendermint update transaction chain length must be between 1 and ${MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH}`,
    );
  }

  const writer = BinaryWriter.create().uint32(8).uint32(TENDERMINT_UPDATE_TX_CHAIN_VERSION);
  unsignedTxCbor.map(normalizeUnsignedTxCbor).forEach((cbor) => writer.uint32(18).string(cbor));
  if (options.rebuildAfterSubmission) {
    writer.uint32(24).bool(true);
  }
  return writer.finish();
}
