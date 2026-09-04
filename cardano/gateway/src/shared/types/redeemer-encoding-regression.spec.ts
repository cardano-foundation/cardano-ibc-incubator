import * as Lucid from '@lucid-evolution/lucid';
import {
  decodeSpendChannelRedeemer,
  encodeMintChannelRedeemer,
  encodeSpendChannelRedeemer,
} from './channel/channel-redeemer';
import { encodeMintConnectionRedeemer, encodeSpendConnectionRedeemer } from './connection/connection-redeemer';
import { encodeVerifyProofRedeemer } from './connection/verify-proof-redeemer';
import {
  decodeTransferIBCModuleRedeemer,
  encodeTransferIBCModuleRedeemer,
  TransferIBCModuleRedeemer,
} from './apps/transfer/transfer-ibc-module-redeemer';
import { decodeIBCModuleRedeemer, encodeIBCModuleRedeemer } from './port/ibc_module_redeemer';

const EMPTY_PROOF = { proofs: [] } as const;
const HEIGHT = { revisionNumber: 0n, revisionHeight: 11n } as const;

const PACKET = {
  sequence: 3n,
  source_port: '7472616e73666572',
  source_channel: '6368616e6e656c2d30',
  destination_port: '7472616e73666572',
  destination_channel: '6368616e6e656c2d31',
  data: '7b7d',
  timeout_height: { revisionNumber: 0n, revisionHeight: 99n },
  timeout_timestamp: 0n,
} as const;

const MITHRIL_CLIENT_STATE_HEX = 'aabbccdd';

describe('Redeemer encoding regression', () => {
  it('keeps MintChannel redeemer encoding stable', async () => {
    const encoded = await encodeMintChannelRedeemer(
      {
        ChanOpenTry: {
          counterparty_version: '6962632d7631',
          proof_init: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe('d87a83466962632d7631d8798180d87982000b');
  });

  it('keeps SpendChannel redeemer encoding stable', async () => {
    const encoded = await encodeSpendChannelRedeemer(
      {
        AcknowledgePacket: {
          packet: PACKET as any,
          acknowledgement: '6f6b',
          proof_acked: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe('d87d84d8798803487472616e73666572496368616e6e656c2d30487472616e73666572496368616e6e656c2d31427b7dd8798200186300426f6bd8798180d87982000b');
  });

  it('appends PrunePacketHistory after all existing SpendChannel constructors', async () => {
    const redeemer = {
      PrunePacketHistory: {
        sequence: 3n,
        proof_commitment_absence: EMPTY_PROOF as any,
        proof_height: HEIGHT,
      },
    } as const;

    const encoded = await encodeSpendChannelRedeemer(redeemer, Lucid);

    expect(encoded).toBe('d905018303d8798180d87982000b');
    expect(decodeSpendChannelRedeemer(encoded, Lucid)).toEqual(redeemer);
  });

  it('appends TimeoutOnClose after all existing SpendChannel constructors', async () => {
    const redeemer = {
      TimeoutOnClose: {
        packet: PACKET,
        proof_unreceived: EMPTY_PROOF,
        proof_close: EMPTY_PROOF,
        proof_height: HEIGHT,
        next_sequence_recv: 2n,
      },
    } as const;

    const encoded = await encodeSpendChannelRedeemer(redeemer as any, Lucid);

    expect(encoded).toBe(
      'd9050285d8798803487472616e73666572496368616e6e656c2d30487472616e73666572496368616e6e656c2d31427b7dd8798200186300d8798180d8798180d87982000b02',
    );
    expect(decodeSpendChannelRedeemer(encoded, Lucid)).toEqual(redeemer);
  });

  it('keeps MintConnection redeemer encoding stable', async () => {
    const encoded = await encodeMintConnectionRedeemer(
      {
        ConnOpenTry: {
          client_state: MITHRIL_CLIENT_STATE_HEX,
          proof_init: EMPTY_PROOF as any,
          proof_client: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe(
      'd87a8444aabbccddd8798180d8798180d87982000b',
    );
  });

  it('keeps SpendConnection redeemer encoding stable', async () => {
    const encoded = await encodeSpendConnectionRedeemer(
      'ConnOpenAck',
      Lucid,
    );

    expect(encoded).toBe('d87980');
  });

  it('keeps VerifyProof redeemer encoding stable', () => {
    const encoded = encodeVerifyProofRedeemer(
      {
        VerifyMembership: {
          cs: {
            chainId: '656e747279706f696e74',
            trustLevel: { numerator: 1n, denominator: 3n },
            trustingPeriod: 120n,
            unbondingPeriod: 240n,
            maxClockDrift: 10n,
            frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
            latestHeight: { revisionNumber: 0n, revisionHeight: 50n },
            proofSpecs: [],
          },
          cons_state: {
            timestamp: 123n,
            next_validators_hash: 'aa',
            root: { hash: 'bb' },
          },
          height: HEIGHT,
          processed_time: 0n,
          processed_height: 0n,
          delay_time_period: 0n,
          delay_block_period: 0n,
          proof: EMPTY_PROOF as any,
          path: { key_path: ['696263', '70617468'] },
          value: '636f6e74656e74',
        },
      },
      Lucid,
    );

    expect(encoded).toBe(
      'd8798ad879884a656e747279706f696e74d879820103187818f00ad879820000d8798200183280d87983187b41aad8798141bbd87982000b00000000d8798180d879818243696263447061746847636f6e74656e74',
    );
  });

  it('appends the mixed proof batch after VerifyOther', () => {
    const encoded = encodeVerifyProofRedeemer(
      {
        BatchVerifyMembershipAndNonMembership: {
          memberships: [],
          non_memberships: [],
        },
      },
      Lucid,
    );

    expect(encoded).toBe('d87d828080');
  });

  it('encodes channel close-confirm module callback with the close-confirm constructor', async () => {
    const encoded = await encodeIBCModuleRedeemer(
      {
        Callback: [
          {
            OnChanCloseConfirm: {
              channel_id: '6368616e6e656c2d30',
            },
          },
        ],
      },
      Lucid,
    );

    expect(encoded).toBe('d87981d87e81496368616e6e656c2d30');
  });

  it('round-trips the packet bytes authenticated by a receive callback', async () => {
    const redeemer = {
      Callback: [
        {
          OnRecvPacket: {
            channel_id: PACKET.destination_channel,
            packet_data: PACKET.data,
            acknowledgement: {
              response: {
                AcknowledgementResult: {
                  result: '01',
                },
              },
            },
            data: 'OtherModuleData' as const,
          },
        },
      ],
    };

    const encoded = await encodeIBCModuleRedeemer(redeemer, Lucid);

    expect(decodeIBCModuleRedeemer(encoded, Lucid)).toEqual(redeemer);
  });

  it('keeps the transfer callback CBOR stable behind the opaque module envelope', async () => {
    const redeemer: TransferIBCModuleRedeemer = {
      Callback: [
        {
          OnSendPacket: {
            channel_id: PACKET.source_channel,
            packet_data: PACKET.data,
            packet_commitment: 'aabb',
            data: {
              ModuleDataV1: [
                {
                  denom: '75616461',
                  amount: '31',
                  sender: 'aa',
                  receiver: 'bb',
                  memo: '',
                },
              ],
            },
          },
        },
      ],
    };

    const encoded = await encodeTransferIBCModuleRedeemer(redeemer, Lucid);

    expect(encoded).toBe(
      'd87981d9050284496368616e6e656c2d30427b7d42aabbd87981d879854475616461413141aa41bb40',
    );
    expect(decodeTransferIBCModuleRedeemer(encoded, Lucid)).toEqual(redeemer);
  });
});
