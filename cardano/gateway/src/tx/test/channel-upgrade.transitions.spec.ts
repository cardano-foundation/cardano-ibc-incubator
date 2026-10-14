import { convertString2Hex } from '@shared/helpers/hex';
import { ChannelDatum, initialChannelUpgradeState } from '@shared/types/channel/channel-datum';
import { Order } from '@shared/types/channel/order';
import { ChannelState } from '@shared/types/channel/state';
import {
  INVALID_UPGRADE_MESSAGE,
  UPGRADE_TIMEOUT_MESSAGE,
  ackUpgrade,
  cancelUpgrade,
  confirmUpgrade,
  flushUpgrade,
  initUpgrade,
  openUpgrade,
  requireCompatibleUpgrade,
  timeoutUpgrade,
  tryUpgrade,
} from '../helper/channel-upgrade';

// Mirrors cardano/onchain/validators/spending_channel/chan_upgrade.test.ak.

const hex = convertString2Hex;
const LANES = 16n;
const VALID_TO = 1_700_000_000_000n;
const PERIOD = 3_600_000n;
const fields = { ordering: Order.Unordered, connection_hops: [hex('connection-1')], version: hex('ics20-1') };

function channel(state = ChannelState.Open, upgradeSequence = 0n): ChannelDatum {
  return {
    state: {
      channel: {
        state,
        ordering: Order.Unordered,
        counterparty: { port_id: hex('transfer'), channel_id: hex('channel-7') },
        connection_hops: [hex('connection-0')],
        version: hex('ics20-1'),
        upgrade_sequence: upgradeSequence,
      },
      next_sequence_send: 1n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      packet_commitment: new Map(),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      upgrade: initialChannelUpgradeState(),
    },
    port: hex('transfer'),
    token: { policyId: '11'.repeat(28), name: '22' },
  };
}

function counterpartyUpgrade(nextSequenceSend = 9n, timestamp = (VALID_TO + PERIOD) * 1_000_000n) {
  return {
    fields: { ...fields, connection_hops: [hex('connection-5')] },
    timeout: { height: { revisionNumber: 0n, revisionHeight: 0n }, timestamp },
    next_sequence_send: nextSequenceSend,
  };
}

describe('channel upgrade transitions', () => {
  it('INIT proposes a replacement connection at the next upgrade sequence', () => {
    const next = initUpgrade(channel(), fields, PERIOD);

    expect(next.state.channel).toEqual({ ...channel().state.channel, upgrade_sequence: 1n });
    expect(next.state.upgrade).toEqual({
      pending: {
        upgrade: {
          fields,
          timeout: { height: { revisionNumber: 0n, revisionHeight: 0n }, timestamp: 0n },
          next_sequence_send: 0n,
        },
        timeout_period: PERIOD,
        counterparty_upgrade: null,
        flushed_lanes: 0n,
      },
      error_receipt: null,
      recv_start_sequence: 0n,
    });
  });

  it('INIT changes only the connection hop', () => {
    expect(() => initUpgrade(channel(), { ...fields, version: hex('ics20-2') }, PERIOD)).toThrow(/connection hop/);
    expect(() => initUpgrade(channel(), { ...fields, ordering: Order.Ordered }, PERIOD)).toThrow(/connection hop/);
    expect(() => initUpgrade(channel(), { ...fields, connection_hops: [hex('connection-0')] }, PERIOD)).toThrow(
      /already uses/,
    );
    expect(() => initUpgrade(channel(), fields, PERIOD - 1n)).toThrow(/timeout period/);
    expect(() => initUpgrade(channel(ChannelState.Flushing), fields, PERIOD)).toThrow(/not Open/);
  });

  it('a new INIT replaces an unflushed proposal and records why', () => {
    const replaced = initUpgrade(initUpgrade(channel(), fields, PERIOD), fields, PERIOD);

    expect(replaced.state.channel.upgrade_sequence).toBe(2n);
    expect(replaced.state.upgrade.error_receipt).toEqual({ sequence: 1n, message: hex(INVALID_UPGRADE_MESSAGE) });
  });

  it('INIT then ACK starts flushing at the send boundary and records the counterparty', () => {
    const acked = ackUpgrade(initUpgrade(channel(), fields, PERIOD), counterpartyUpgrade(), LANES, VALID_TO, 4n);
    const pending = acked.state.upgrade.pending!;

    expect(acked.state.channel.state).toBe(ChannelState.Flushing);
    expect(pending.upgrade.timeout.timestamp).toBe((VALID_TO + PERIOD) * 1_000_000n);
    expect(pending.upgrade.next_sequence_send).toBe(4n);
    expect(pending.counterparty_upgrade).toEqual(counterpartyUpgrade());
  });

  it('ACK rejects a counterparty upgrade that timed out or uses a height', () => {
    const init = initUpgrade(channel(), fields, PERIOD);

    expect(() => ackUpgrade(init, counterpartyUpgrade(9n, VALID_TO * 1_000_000n), LANES, VALID_TO, 4n)).toThrow(
      /timed out/,
    );
    const byHeight = counterpartyUpgrade();
    byHeight.timeout.height = { revisionNumber: 1n, revisionHeight: 10n };
    expect(() => ackUpgrade(init, byHeight, LANES, VALID_TO, 4n)).toThrow(/height/);
  });

  it('FLUSH completes once every lane is certified and the counterparty upgrade is known', () => {
    const acked = ackUpgrade(initUpgrade(channel(), fields, PERIOD), counterpartyUpgrade(), LANES, VALID_TO, 4n);
    const half = flushUpgrade(acked, 8n, LANES);
    const done = flushUpgrade(half, 8n, LANES);

    expect(half.state.channel.state).toBe(ChannelState.Flushing);
    expect(done.state.channel.state).toBe(ChannelState.FlushComplete);
    expect(() => flushUpgrade(done, 1n, LANES)).toThrow(/not Flushing/);
    expect(() => flushUpgrade(half, 9n, LANES)).toThrow(/cannot flush/);
  });

  it('a crossing TRY flushes before the counterparty upgrade is known', () => {
    const tried = tryUpgrade(initUpgrade(channel(), fields, PERIOD), 3n, VALID_TO, 4n);
    const flushed = flushUpgrade(tried, LANES, LANES);
    const confirmed = confirmUpgrade(flushed, ChannelState.FlushComplete, counterpartyUpgrade(), LANES, VALID_TO);

    expect(tried.state.channel.upgrade_sequence).toBe(3n);
    expect(flushed.state.channel.state).toBe(ChannelState.Flushing);
    expect(confirmed.state.channel.state).toBe(ChannelState.FlushComplete);
    expect(() => tryUpgrade(initUpgrade(channel(), fields, PERIOD), 0n, VALID_TO, 4n)).toThrow(/behind/);
  });

  it('OPEN moves to the replacement connection and rejects packets settled before it', () => {
    const complete = flushUpgrade(
      ackUpgrade(initUpgrade(channel(), fields, PERIOD), counterpartyUpgrade(9n), LANES, VALID_TO, 4n),
      LANES,
      LANES,
    );
    const opened = openUpgrade(complete, 1n);

    expect(opened.state.channel).toEqual({
      ...channel().state.channel,
      connection_hops: fields.connection_hops,
      upgrade_sequence: 1n,
    });
    expect(opened.state.upgrade).toEqual({ pending: null, error_receipt: null, recv_start_sequence: 9n });
    expect(() => openUpgrade(complete, 0n)).toThrow(/behind/);
  });

  it('TIMEOUT restores the channel unless the counterparty opened with the upgrade', () => {
    const acked = ackUpgrade(initUpgrade(channel(), fields, PERIOD), counterpartyUpgrade(), LANES, VALID_TO, 4n);
    const timeout = acked.state.upgrade.pending!.upgrade.timeout.timestamp;
    const counterparty = { ...acked.state.channel, state: ChannelState.Flushing };

    const restored = timeoutUpgrade(acked, counterparty, timeout, hex('connection-5'));
    expect(restored.state.channel).toEqual({ ...channel().state.channel, upgrade_sequence: 1n });
    expect(restored.state.upgrade.error_receipt).toEqual({ sequence: 1n, message: hex(UPGRADE_TIMEOUT_MESSAGE) });

    expect(() => timeoutUpgrade(acked, counterparty, timeout - 1n, hex('connection-5'))).toThrow(/not timed out/);
    const upgraded = { ...counterparty, state: ChannelState.Open, connection_hops: [hex('connection-5')] };
    expect(() => timeoutUpgrade(acked, upgraded, timeout, hex('connection-5'))).toThrow(/already opened/);
  });

  it('CANCEL restores the channel at the receipt sequence or by the authority', () => {
    const init = initUpgrade(channel(), fields, PERIOD);
    const byReceipt = cancelUpgrade(init, { sequence: 4n, message: hex('ABCI code: 28: x') });

    expect(byReceipt.state.channel.upgrade_sequence).toBe(4n);
    expect(byReceipt.state.upgrade).toEqual({
      pending: null,
      error_receipt: { sequence: 4n, message: hex(INVALID_UPGRADE_MESSAGE) },
      recv_start_sequence: 0n,
    });
    expect(cancelUpgrade(init, null).state.channel.upgrade_sequence).toBe(1n);
    expect(() => cancelUpgrade(init, { sequence: 0n, message: '' })).toThrow(/older upgrade/);

    const complete = flushUpgrade(ackUpgrade(init, counterpartyUpgrade(), LANES, VALID_TO, 4n), LANES, LANES);
    expect(() => cancelUpgrade(complete, null)).toThrow(/finished flushing/);
    expect(() => cancelUpgrade(complete, { sequence: 2n, message: '' })).toThrow(/its own upgrade/);
    expect(cancelUpgrade(complete, { sequence: 1n, message: '' }).state.channel.state).toBe(ChannelState.Open);
  });

  it('accepts only the counterparty of the replacement connection', () => {
    expect(() => requireCompatibleUpgrade(fields, counterpartyUpgrade().fields, hex('connection-5'))).not.toThrow();
    expect(() => requireCompatibleUpgrade(fields, counterpartyUpgrade().fields, hex('connection-6'))).toThrow(
      /replacement connection/,
    );
  });
});
