import type { TransferStatusResponse } from '@/types/transferStatus';

export function fundsReceived(status: TransferStatusResponse | null): boolean {
  const last = status?.packets.at(-1);
  if (!last?.recv || last.index !== status!.routeChainIds.length - 2)
    return false;
  const hex =
    last.writeAcknowledgement?.acknowledgementHex ||
    last.acknowledge?.acknowledgementHex;
  if (!hex || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return false;
  try {
    const bytes = Uint8Array.from(hex.match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    const acknowledgement = JSON.parse(new TextDecoder().decode(bytes));
    return acknowledgement.result === 'AQ==' && !acknowledgement.error;
  } catch {
    return false;
  }
}
