import * as Lucid from '@lucid-evolution/lucid';
import { REDEEMER_TYPE } from '../../constant/redeemer';
import { convertString2Hex, hashSha3_256 } from '../../shared/helpers/hex';
import { encodeSpendChannelRedeemer } from '../../shared/types/channel/channel-redeemer';
import { encodeMintVoucherRedeemer } from '../../shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { deriveVoucherTraceCandidatesForTx, splitTracePath } from '../backfill-denom-traces.helpers';

const emptyProof = { proofs: [] } as any;

describe('backfill-denom-traces.helpers', () => {
  it('derives recv mint candidate from strict redeemer decoding', async () => {
    const packet = buildPacket('transfer', 'channel-1', 'transfer', 'channel-9', 'uatom');
    const spendRedeemerHex = await encodeSpendChannelRedeemer(
      {
        RecvPacket: {
          packet,
          proof_commitment: emptyProof,
          proof_height: { revisionNumber: 0n, revisionHeight: 10n },
        },
      },
      Lucid,
    );
    const mintVoucherRedeemerHex = encodeMintVoucherRedeemer(
      {
        MintVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
          packet_dest_port: packet.destination_port,
          packet_dest_channel: packet.destination_channel,
        },
      },
      Lucid,
    );

    const candidates = deriveVoucherTraceCandidatesForTx(
      [
        { purpose: REDEEMER_TYPE.SPEND, redeemerHex: spendRedeemerHex },
        { purpose: REDEEMER_TYPE.MINT, redeemerHex: mintVoucherRedeemerHex },
      ],
      Lucid,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fullDenomPath).toBe('transfer/channel-9/uatom');
    expect(candidates[0].voucherTokenName).toBe(hashSha3_256(convertString2Hex('transfer/channel-9/uatom')));
    expect(candidates[0].derivation).toBe('recv_mint');
  });

  it('derives acknowledgement refund candidate with source prefix', async () => {
    const packet = buildPacket('transfer', 'channel-3', 'transfer', 'channel-4', 'uosmo');
    const spendRedeemerHex = await encodeSpendChannelRedeemer(
      {
        AcknowledgePacket: {
          packet,
          acknowledgement: convertString2Hex('ok'),
          proof_acked: emptyProof,
          proof_height: { revisionNumber: 0n, revisionHeight: 22n },
        },
      },
      Lucid,
    );
    const mintVoucherRedeemerHex = encodeMintVoucherRedeemer(
      {
        RefundVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
        },
      },
      Lucid,
    );

    const candidates = deriveVoucherTraceCandidatesForTx(
      [
        { purpose: REDEEMER_TYPE.SPEND, redeemerHex: spendRedeemerHex },
        { purpose: REDEEMER_TYPE.MINT, redeemerHex: mintVoucherRedeemerHex },
      ],
      Lucid,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fullDenomPath).toBe('transfer/channel-3/uosmo');
    expect(candidates[0].voucherTokenName).toBe(hashSha3_256(convertString2Hex('transfer/channel-3/uosmo')));
    expect(candidates[0].derivation).toBe('ack_refund');
  });

  it('derives timeout refund candidate without additional prefix', async () => {
    const packet = buildPacket('transfer', 'channel-3', 'transfer', 'channel-4', 'lovelace');
    const spendRedeemerHex = await encodeSpendChannelRedeemer(
      {
        TimeoutPacket: {
          packet,
          proof_unreceived: emptyProof,
          proof_height: { revisionNumber: 0n, revisionHeight: 22n },
          next_sequence_recv: 9n,
        },
      },
      Lucid,
    );
    const mintVoucherRedeemerHex = encodeMintVoucherRedeemer(
      {
        RefundVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
        },
      },
      Lucid,
    );

    const candidates = deriveVoucherTraceCandidatesForTx(
      [
        { purpose: REDEEMER_TYPE.SPEND, redeemerHex: spendRedeemerHex },
        { purpose: REDEEMER_TYPE.MINT, redeemerHex: mintVoucherRedeemerHex },
      ],
      Lucid,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].fullDenomPath).toBe('lovelace');
    expect(candidates[0].voucherTokenName).toBe(hashSha3_256(convertString2Hex('lovelace')));
    expect(candidates[0].derivation).toBe('timeout_refund');
  });

  it('rejects non-ICS20 packet payloads', async () => {
    const packet = buildPacket('transfer', 'channel-1', 'transfer', 'channel-9', undefined, { foo: 'bar' });
    const spendRedeemerHex = await encodeSpendChannelRedeemer(
      {
        RecvPacket: {
          packet,
          proof_commitment: emptyProof,
          proof_height: { revisionNumber: 0n, revisionHeight: 10n },
        },
      },
      Lucid,
    );
    const mintVoucherRedeemerHex = encodeMintVoucherRedeemer(
      {
        MintVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
          packet_dest_port: packet.destination_port,
          packet_dest_channel: packet.destination_channel,
        },
      },
      Lucid,
    );

    const candidates = deriveVoucherTraceCandidatesForTx(
      [
        { purpose: REDEEMER_TYPE.SPEND, redeemerHex: spendRedeemerHex },
        { purpose: REDEEMER_TYPE.MINT, redeemerHex: mintVoucherRedeemerHex },
      ],
      Lucid,
    );

    expect(candidates).toEqual([]);
  });

  it('splits canonical path/base denom correctly', () => {
    expect(splitTracePath('transfer/channel-0/uatom')).toEqual({
      path: 'transfer/channel-0',
      baseDenom: 'uatom',
    });
    expect(splitTracePath('lovelace')).toEqual({
      path: '',
      baseDenom: 'lovelace',
    });
  });
});

function buildPacket(
  sourcePort: string,
  sourceChannel: string,
  destinationPort: string,
  destinationChannel: string,
  denom?: string,
  overridePayload?: Record<string, string>,
) {
  const payload =
    overridePayload ??
    ({
      denom: denom ?? 'uatom',
      amount: '100',
      sender: 'sender',
      receiver: 'receiver',
      memo: '',
    } as const);

  return {
    sequence: 7n,
    source_port: convertString2Hex(sourcePort),
    source_channel: convertString2Hex(sourceChannel),
    destination_port: convertString2Hex(destinationPort),
    destination_channel: convertString2Hex(destinationChannel),
    data: convertString2Hex(JSON.stringify(payload)),
    timeout_height: {
      revisionNumber: 0n,
      revisionHeight: 999n,
    },
    timeout_timestamp: 0n,
  };
}

