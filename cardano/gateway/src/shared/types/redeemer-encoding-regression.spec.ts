import * as Lucid from '@lucid-evolution/lucid';
import { encodeMintChannelRedeemer, encodeSpendChannelRedeemer } from './channel/channel-redeemer';
import { encodeMintConnectionRedeemer, encodeSpendConnectionRedeemer } from './connection/connection-redeemer';
import { encodeVerifyProofRedeemer } from './connection/verify-proof-redeemer';

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
          handler_token: { policyId: 'aa', name: 'bb' },
          counterparty_version: '6962632d7631',
          proof_init: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe('d87a84d8798241aa41bb466962632d7631d8798180d87982000b');
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

  it('keeps MintConnection redeemer encoding stable', async () => {
    const encoded = await encodeMintConnectionRedeemer(
      {
        ConnOpenTry: {
          handler_auth_token: { policyId: 'aa', name: 'bb' },
          client_state: MITHRIL_CLIENT_STATE_HEX,
          proof_init: EMPTY_PROOF as any,
          proof_client: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe(
      'd87a85d8798241aa41bb44aabbccddd8798180d8798180d87982000b',
    );
  });

  it('keeps SpendConnection redeemer encoding stable', async () => {
    const encoded = await encodeSpendConnectionRedeemer(
      {
        ConnOpenAck: {
          counterparty_client_state: MITHRIL_CLIENT_STATE_HEX,
          proof_try: EMPTY_PROOF as any,
          proof_client: EMPTY_PROOF as any,
          proof_height: HEIGHT,
        },
      },
      Lucid,
    );

    expect(encoded).toBe(
      'd8798444aabbccddd8798180d8798180d87982000b',
    );
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
      'd87988d879884a656e747279706f696e74d879820103187818f00ad879820000d8798200183280d87983187b41aad8798141bbd87982000b0000d8798180d879818243696263447061746847636f6e74656e74',
    );
  });
});
