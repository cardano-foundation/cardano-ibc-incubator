export * from './ics20-json-codec';
export * from './packet-lanes';
export const MAX_PACKET_ENTRIES_PER_CHANNEL = 64;

export type Height = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export type SendPacketOperator = {
  sourcePort: string;
  sourceChannel: string;
  token: {
    denom: string;
    amount: bigint;
  };
  sender: string;
  receiver: string;
  signer: string;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
  memo: string;
};

export type Ics20PacketDataStringifier = (packetData: {
  denom: string;
  amount: string;
  sender: string;
  receiver: string;
  memo?: string;
}) => string;

// Preserve the exact sorted JSON representation used by deployments created
// before the strict ICS-20 codec was introduced.
export const stringifyLegacyIcs20PacketData: Ics20PacketDataStringifier = (
  packetData,
) => {
  const ordered: Record<string, string> = {};
  if (packetData.amount) ordered.amount = packetData.amount;
  if (packetData.denom) ordered.denom = packetData.denom;
  if (packetData.memo) ordered.memo = packetData.memo;
  if (packetData.receiver) ordered.receiver = packetData.receiver;
  if (packetData.sender) ordered.sender = packetData.sender;
  return JSON.stringify(ordered);
};
