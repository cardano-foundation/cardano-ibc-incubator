import { REDEEMER_TYPE } from '../constant/redeemer';
import { convertHex2String, convertString2Hex, hashSha3_256 } from '../shared/helpers/hex';
import { getDenomPrefix } from '../shared/helpers/helper';
import { decodeSpendChannelRedeemer, SpendChannelRedeemer } from '../shared/types/channel/channel-redeemer';
import {
  decodeMintVoucherRedeemer,
  MintVoucherRedeemer,
} from '../shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { Packet } from '../shared/types/channel/packet';

export type BackfillRedeemerRecord = {
  purpose: string;
  redeemerHex: string;
};

export type VoucherTraceCandidate = {
  voucherTokenName: string;
  fullDenomPath: string;
  derivation: 'recv_mint' | 'ack_refund' | 'timeout_refund';
};

type PacketContext = {
  kind: 'recv' | 'ack' | 'timeout';
  packet: Packet;
  denom: string;
};

type VoucherMintCase = {
  type: 'mint' | 'refund';
  redeemer: MintVoucherRedeemer;
};

export function parseIcs20DenomFromPacketData(packetDataHex: string): string | null {
  let parsed: unknown;
  try {
    const packetData = convertHex2String(packetDataHex);
    parsed = JSON.parse(packetData);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const maybePacket = parsed as Partial<Record<'denom' | 'amount' | 'sender' | 'receiver' | 'memo', unknown>>;
  const requiredKeys: Array<keyof typeof maybePacket> = ['denom', 'amount', 'sender', 'receiver', 'memo'];
  // Only treat payload as ICS-20 when all required string fields are present.
  const isIcs20Packet = requiredKeys.every((key) => typeof maybePacket[key] === 'string');
  if (!isIcs20Packet) return null;

  return maybePacket.denom as string;
}

export function deriveVoucherTraceCandidatesForTx(
  redeemers: BackfillRedeemerRecord[],
  Lucid: typeof import('@lucid-evolution/lucid'),
): VoucherTraceCandidate[] {
  const packetContexts: PacketContext[] = [];
  const voucherMints: VoucherMintCase[] = [];

  for (const redeemer of redeemers) {
    if (!redeemer.redeemerHex) continue;

    if (redeemer.purpose === REDEEMER_TYPE.SPEND) {
      // Spend redeemers contain packet data (the ICS-20 denom candidate lives here).
      const spendRedeemer = tryDecodeSpendChannelRedeemer(redeemer.redeemerHex, Lucid);
      if (!spendRedeemer) continue;

      const context = extractPacketContext(spendRedeemer);
      if (context) packetContexts.push(context);
      continue;
    }

    if (redeemer.purpose === REDEEMER_TYPE.MINT) {
      // Mint redeemers indicate whether this tx path is MintVoucher or RefundVoucher.
      const mintVoucherRedeemer = tryDecodeMintVoucherRedeemer(redeemer.redeemerHex, Lucid);
      if (!mintVoucherRedeemer || typeof mintVoucherRedeemer !== 'object' || mintVoucherRedeemer === null) continue;

      if ('MintVoucher' in mintVoucherRedeemer) {
        voucherMints.push({ type: 'mint', redeemer: mintVoucherRedeemer });
        continue;
      }
      if ('RefundVoucher' in mintVoucherRedeemer) {
        voucherMints.push({ type: 'refund', redeemer: mintVoucherRedeemer });
      }
    }
  }

  const candidates = new Map<string, VoucherTraceCandidate>();
  for (const mintCase of voucherMints) {
    if (mintCase.type === 'mint' && 'MintVoucher' in mintCase.redeemer) {
      const mint = mintCase.redeemer.MintVoucher;
      // MintVoucher must match recv packet endpoints exactly.
      const recvMatches = packetContexts.filter(
        (context) =>
          context.kind === 'recv' &&
          equalHex(context.packet.source_port, mint.packet_source_port) &&
          equalHex(context.packet.source_channel, mint.packet_source_channel) &&
          equalHex(context.packet.destination_port, mint.packet_dest_port) &&
          equalHex(context.packet.destination_channel, mint.packet_dest_channel),
      );

      for (const context of recvMatches) {
        // Recv mint denom is destination-prefixed before token-name hashing.
        const prefix = getDenomPrefix(
          convertHex2String(context.packet.destination_port),
          convertHex2String(context.packet.destination_channel),
        );
        const fullDenomPath = `${prefix}${context.denom}`;
        const voucherTokenName = hashSha3_256(convertString2Hex(fullDenomPath));
        // Include derivation in key so duplicate redeemers collapse without mixing variants.
        const key = `${voucherTokenName}|${fullDenomPath}|recv_mint`;
        candidates.set(key, {
          voucherTokenName,
          fullDenomPath,
          derivation: 'recv_mint',
        });
      }
      continue;
    }

    if (mintCase.type === 'refund' && 'RefundVoucher' in mintCase.redeemer) {
      const refund = mintCase.redeemer.RefundVoucher;
      // RefundVoucher can correspond to ack or timeout spend paths.
      const refundMatches = packetContexts.filter(
        (context) =>
          (context.kind === 'ack' || context.kind === 'timeout') &&
          equalHex(context.packet.source_port, refund.packet_source_port) &&
          equalHex(context.packet.source_channel, refund.packet_source_channel),
      );

      for (const context of refundMatches) {
        if (context.kind === 'ack') {
          // Ack refund re-applies source prefix before hashing.
          const prefix = getDenomPrefix(
            convertHex2String(context.packet.source_port),
            convertHex2String(context.packet.source_channel),
          );
          const fullDenomPath = `${prefix}${context.denom}`;
          const voucherTokenName = hashSha3_256(convertString2Hex(fullDenomPath));
          const key = `${voucherTokenName}|${fullDenomPath}|ack_refund`;
          candidates.set(key, {
            voucherTokenName,
            fullDenomPath,
            derivation: 'ack_refund',
          });
          continue;
        }

        // Timeout refund hashes the packet denom directly.
        const fullDenomPath = context.denom;
        const voucherTokenName = hashSha3_256(convertString2Hex(fullDenomPath));
        const key = `${voucherTokenName}|${fullDenomPath}|timeout_refund`;
        candidates.set(key, {
          voucherTokenName,
          fullDenomPath,
          derivation: 'timeout_refund',
        });
      }
    }
  }

  return Array.from(candidates.values());
}

export function splitTracePath(fullDenomPath: string): { path: string; baseDenom: string } | null {
  // Persisted form is path + base_denom, with base_denom as the last segment.
  const parts = fullDenomPath.split('/');
  const baseDenom = parts.pop();
  if (!baseDenom) return null;
  return {
    path: parts.join('/'),
    baseDenom,
  };
}

function extractPacketContext(spendRedeemer: SpendChannelRedeemer): PacketContext | null {
  if (typeof spendRedeemer !== 'object' || spendRedeemer === null) return null;

  if ('RecvPacket' in spendRedeemer) {
    const packet = spendRedeemer.RecvPacket.packet;
    const denom = parseIcs20DenomFromPacketData(packet.data);
    return denom ? { kind: 'recv', packet, denom } : null;
  }
  if ('AcknowledgePacket' in spendRedeemer) {
    const packet = spendRedeemer.AcknowledgePacket.packet;
    const denom = parseIcs20DenomFromPacketData(packet.data);
    return denom ? { kind: 'ack', packet, denom } : null;
  }
  if ('TimeoutPacket' in spendRedeemer) {
    const packet = spendRedeemer.TimeoutPacket.packet;
    const denom = parseIcs20DenomFromPacketData(packet.data);
    return denom ? { kind: 'timeout', packet, denom } : null;
  }
  return null;
}

function tryDecodeSpendChannelRedeemer(
  redeemerHex: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): SpendChannelRedeemer | null {
  try {
    return decodeSpendChannelRedeemer(redeemerHex, Lucid);
  } catch {
    return null;
  }
}

function tryDecodeMintVoucherRedeemer(
  redeemerHex: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): MintVoucherRedeemer | null {
  try {
    return decodeMintVoucherRedeemer(redeemerHex, Lucid);
  } catch {
    return null;
  }
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
