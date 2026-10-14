import type {
  ErrorReceiptValue,
  PendingUpgradeValue,
  UpgradeFieldsValue,
  UpgradeValue,
} from '@cardano-ibc/tx-builder-runtime/channelDatum';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { convertString2Hex } from '@shared/helpers/hex';
import { ChannelDatum, ChannelUpgradeState } from '@shared/types/channel/channel-datum';
import { Channel } from '@shared/types/channel/channel';
import { ChannelState } from '@shared/types/channel/state';

// Off-chain mirror of the transfer-channel upgrade transitions in
// cardano/onchain/validators/spending_channel/chan_upgrade*.ak. The Gateway
// builds the successor datum the validators expect, and rejects a step early
// when a validator would fail.

export const MIN_UPGRADE_TIMEOUT_PERIOD_MS = 3_600_000n;
export const MAX_UPGRADE_TIMEOUT_PERIOD_MS = 2_592_000_000n;
export const INVALID_UPGRADE_MESSAGE = 'ABCI code: 28: restored channel to pre-upgrade state';
export const UPGRADE_TIMEOUT_MESSAGE = 'ABCI code: 34: restored channel to pre-upgrade state';

const ZERO_HEIGHT = { revisionNumber: 0n, revisionHeight: 0n };

function reject(message: string): never {
  throw new GrpcInvalidArgumentException(`channel upgrade: ${message}`);
}

function successor(datum: ChannelDatum, channel: Channel, upgrade: ChannelUpgradeState): ChannelDatum {
  return { ...datum, state: { ...datum.state, channel, upgrade } };
}

function requirePending(datum: ChannelDatum): PendingUpgradeValue {
  const pending = datum.state.upgrade.pending;
  if (!pending) reject('the channel has no upgrade in progress');
  return pending;
}

function nextErrorReceipt(upgrade: ChannelUpgradeState, sequence: bigint, message: string): ErrorReceiptValue {
  // Receipts only move forward, as in ibc-go.
  if (upgrade.error_receipt && upgrade.error_receipt.sequence >= sequence) {
    reject(`error receipt ${upgrade.error_receipt.sequence} is not older than sequence ${sequence}`);
  }
  return { sequence, message: convertString2Hex(message) };
}

function sameHops(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((hop, index) => hop === right[index]);
}

/**
 * The counterparty proposes the same ordering and version on the counterparty
 * of this end's replacement connection. Hex fields.
 */
export function requireCompatibleUpgrade(
  own: UpgradeFieldsValue,
  counterparty: UpgradeFieldsValue,
  replacementCounterpartyConnectionId: string,
): void {
  if (own.ordering !== counterparty.ordering) reject('the counterparty proposes a different ordering');
  if (own.version !== counterparty.version) reject('the counterparty proposes a different version');
  if (!sameHops(counterparty.connection_hops, [replacementCounterpartyConnectionId])) {
    reject("the counterparty's connection is not the counterparty of the replacement connection");
  }
}

/** INIT: the deployment authority proposes a replacement connection. */
export function initUpgrade(datum: ChannelDatum, fields: UpgradeFieldsValue, timeoutPeriod: bigint): ChannelDatum {
  const channel = datum.state.channel;
  const upgrade = datum.state.upgrade;
  if (channel.state !== ChannelState.Open) reject(`the channel is ${channel.state}, not Open`);
  if (timeoutPeriod < MIN_UPGRADE_TIMEOUT_PERIOD_MS || timeoutPeriod > MAX_UPGRADE_TIMEOUT_PERIOD_MS) {
    reject(
      `the timeout period must be between ${MIN_UPGRADE_TIMEOUT_PERIOD_MS} and ${MAX_UPGRADE_TIMEOUT_PERIOD_MS} ms`,
    );
  }
  if (fields.ordering !== channel.ordering) reject('only the connection hop can change');
  if (fields.version !== channel.version) reject('only the connection hop can change');
  if (fields.connection_hops.length !== 1) reject('an upgrade uses exactly one connection hop');
  if (sameHops(fields.connection_hops, channel.connection_hops)) reject('the channel already uses this connection');
  // A new proposal replaces one that has not started flushing.
  const errorReceipt = upgrade.pending
    ? nextErrorReceipt(upgrade, channel.upgrade_sequence, INVALID_UPGRADE_MESSAGE)
    : upgrade.error_receipt;
  return successor(
    datum,
    { ...channel, upgrade_sequence: channel.upgrade_sequence + 1n },
    {
      ...upgrade,
      pending: {
        upgrade: {
          fields,
          timeout: { height: ZERO_HEIGHT, timestamp: 0n },
          next_sequence_send: 0n,
        },
        timeout_period: timeoutPeriod,
        counterparty_upgrade: null,
        flushed_lanes: 0n,
      },
      error_receipt: errorReceipt,
    },
  );
}

/**
 * Flushing fixes the upgrade timeout from the transaction's upper validity
 * bound and the next sequence the send sequencer will assign.
 */
export function startFlushing(
  pending: PendingUpgradeValue,
  validToMs: bigint,
  nextSequenceSend: bigint,
): PendingUpgradeValue {
  if (pending.upgrade.next_sequence_send !== 0n) reject('the upgrade already started flushing');
  return {
    ...pending,
    upgrade: {
      ...pending.upgrade,
      timeout: {
        height: ZERO_HEIGHT,
        timestamp: (validToMs + pending.timeout_period) * 1_000_000n,
      },
      next_sequence_send: nextSequenceSend,
    },
  };
}

/** TRY answers a counterparty proposal that crosses this end's own. */
export function tryUpgrade(
  datum: ChannelDatum,
  counterpartyUpgradeSequence: bigint,
  validToMs: bigint,
  nextSequenceSend: bigint,
): ChannelDatum {
  const channel = datum.state.channel;
  const pending = requirePending(datum);
  if (channel.state !== ChannelState.Open) reject(`the channel is ${channel.state}, not Open`);
  if (counterpartyUpgradeSequence < channel.upgrade_sequence) {
    reject(`counterparty upgrade sequence ${counterpartyUpgradeSequence} is behind ${channel.upgrade_sequence}`);
  }
  return successor(
    datum,
    {
      ...channel,
      state: ChannelState.Flushing,
      upgrade_sequence:
        counterpartyUpgradeSequence > channel.upgrade_sequence ? counterpartyUpgradeSequence : channel.upgrade_sequence,
    },
    { ...datum.state.upgrade, pending: startFlushing(pending, validToMs, nextSequenceSend) },
  );
}

function recordCounterpartyUpgrade(
  datum: ChannelDatum,
  pending: PendingUpgradeValue,
  counterpartyUpgrade: UpgradeValue,
  laneCount: bigint,
  validToMs: bigint,
): ChannelDatum {
  if (pending.counterparty_upgrade) reject("the counterparty's upgrade is already recorded");
  const timeout = counterpartyUpgrade.timeout;
  if (timeout.height.revisionNumber !== 0n || timeout.height.revisionHeight !== 0n) {
    reject('the counterparty upgrade times out at a height, which Cardano cannot observe');
  }
  if (timeout.timestamp <= validToMs * 1_000_000n) reject("the counterparty's upgrade has timed out");
  const next = { ...pending, counterparty_upgrade: counterpartyUpgrade };
  return successor(
    datum,
    {
      ...datum.state.channel,
      state: next.flushed_lanes === laneCount ? ChannelState.FlushComplete : ChannelState.Flushing,
    },
    { ...datum.state.upgrade, pending: next },
  );
}

/** ACK records the counterparty's flushing upgrade, starting this end's flush if needed. */
export function ackUpgrade(
  datum: ChannelDatum,
  counterpartyUpgrade: UpgradeValue,
  laneCount: bigint,
  validToMs: bigint,
  nextSequenceSend: bigint | null,
): ChannelDatum {
  const channel = datum.state.channel;
  let pending = requirePending(datum);
  if (channel.state === ChannelState.Open) {
    if (nextSequenceSend === null) reject('the send sequencer is required to start flushing');
    pending = startFlushing(pending, validToMs, nextSequenceSend);
  } else if (channel.state !== ChannelState.Flushing) {
    reject(`the channel is ${channel.state}, not Open or Flushing`);
  }
  return recordCounterpartyUpgrade(datum, pending, counterpartyUpgrade, laneCount, validToMs);
}

/** CONFIRM records the counterparty's upgrade after this end answered with TRY. */
export function confirmUpgrade(
  datum: ChannelDatum,
  counterpartyChannelState: ChannelState,
  counterpartyUpgrade: UpgradeValue,
  laneCount: bigint,
  validToMs: bigint,
): ChannelDatum {
  if (datum.state.channel.state !== ChannelState.Flushing) {
    reject(`the channel is ${datum.state.channel.state}, not Flushing`);
  }
  if (counterpartyChannelState !== ChannelState.Flushing && counterpartyChannelState !== ChannelState.FlushComplete) {
    reject(`the counterparty is ${counterpartyChannelState}, not Flushing or FlushComplete`);
  }
  return recordCounterpartyUpgrade(datum, requirePending(datum), counterpartyUpgrade, laneCount, validToMs);
}

/** FLUSH certifies that the next `lanes` packet lanes hold no commitments. */
export function flushUpgrade(datum: ChannelDatum, lanes: bigint, laneCount: bigint): ChannelDatum {
  if (datum.state.channel.state !== ChannelState.Flushing) {
    reject(`the channel is ${datum.state.channel.state}, not Flushing`);
  }
  const pending = requirePending(datum);
  const flushed = pending.flushed_lanes + lanes;
  if (lanes <= 0n || flushed > laneCount) reject(`cannot flush ${lanes} more of ${laneCount} lanes`);
  const next = { ...pending, flushed_lanes: flushed };
  return successor(
    datum,
    {
      ...datum.state.channel,
      state: flushed === laneCount && next.counterparty_upgrade ? ChannelState.FlushComplete : ChannelState.Flushing,
    },
    { ...datum.state.upgrade, pending: next },
  );
}

/** OPEN moves the channel to its replacement connection. */
export function openUpgrade(datum: ChannelDatum, counterpartyUpgradeSequence: bigint): ChannelDatum {
  const channel = datum.state.channel;
  if (channel.state !== ChannelState.FlushComplete) reject(`the channel is ${channel.state}, not FlushComplete`);
  const pending = requirePending(datum);
  if (!pending.counterparty_upgrade) reject("the counterparty's upgrade is not recorded");
  if (counterpartyUpgradeSequence < channel.upgrade_sequence) {
    reject(`counterparty upgrade sequence ${counterpartyUpgradeSequence} is behind ${channel.upgrade_sequence}`);
  }
  const fields = pending.upgrade.fields;
  return successor(
    datum,
    {
      ...channel,
      state: ChannelState.Open,
      ordering: fields.ordering as Channel['ordering'],
      connection_hops: fields.connection_hops,
      version: fields.version,
    },
    {
      ...datum.state.upgrade,
      pending: null,
      // Packets the counterparty sent before its upgrade were received on this
      // channel while it flushed. They must not be received again.
      recv_start_sequence: pending.counterparty_upgrade.next_sequence_send,
    },
  );
}

/** TIMEOUT and CANCEL restore the pre-upgrade channel and record why. */
export function restoreChannel(datum: ChannelDatum, sequence: bigint, message: string): ChannelDatum {
  requirePending(datum);
  const upgrade = datum.state.upgrade;
  return successor(
    datum,
    { ...datum.state.channel, state: ChannelState.Open, upgrade_sequence: sequence },
    { ...upgrade, pending: null, error_receipt: nextErrorReceipt(upgrade, sequence, message) },
  );
}

/** TIMEOUT applies once the counterparty passed this end's upgrade timeout without opening. */
export function timeoutUpgrade(
  datum: ChannelDatum,
  counterpartyChannel: Channel,
  proofTimestamp: bigint,
  replacementCounterpartyConnectionId: string,
): ChannelDatum {
  const channel = datum.state.channel;
  if (channel.state !== ChannelState.Flushing && channel.state !== ChannelState.FlushComplete) {
    reject(`the channel is ${channel.state}, not Flushing or FlushComplete`);
  }
  const pending = requirePending(datum);
  const timeout = pending.upgrade.timeout.timestamp;
  if (timeout === 0n || proofTimestamp < timeout) reject('the upgrade has not timed out at the proof height');
  if (counterpartyChannel.state !== ChannelState.Open && counterpartyChannel.state !== ChannelState.Flushing) {
    reject(`the counterparty is ${counterpartyChannel.state}, not Open or Flushing`);
  }
  if (counterpartyChannel.upgrade_sequence < channel.upgrade_sequence) {
    reject('the counterparty channel is at an older upgrade sequence');
  }
  const fields = pending.upgrade.fields;
  const counterpartyUpgraded =
    counterpartyChannel.state === ChannelState.Open &&
    counterpartyChannel.ordering === fields.ordering &&
    counterpartyChannel.version === fields.version &&
    sameHops(counterpartyChannel.connection_hops, [replacementCounterpartyConnectionId]);
  if (counterpartyUpgraded) reject('the counterparty already opened with this upgrade');
  return restoreChannel(datum, channel.upgrade_sequence, UPGRADE_TIMEOUT_MESSAGE);
}

/**
 * CANCEL with the counterparty's error receipt, or without one by the
 * deployment authority before this end finished flushing.
 */
export function cancelUpgrade(datum: ChannelDatum, errorReceipt: ErrorReceiptValue | null): ChannelDatum {
  const channel = datum.state.channel;
  requirePending(datum);
  if (!errorReceipt) {
    if (channel.state === ChannelState.FlushComplete) {
      reject('the authority cannot cancel after this end finished flushing');
    }
    return restoreChannel(datum, channel.upgrade_sequence, INVALID_UPGRADE_MESSAGE);
  }
  if (errorReceipt.sequence < channel.upgrade_sequence) reject('the error receipt is for an older upgrade');
  if (channel.state === ChannelState.FlushComplete && errorReceipt.sequence !== channel.upgrade_sequence) {
    reject('a flushed channel only cancels on a receipt for its own upgrade');
  }
  return restoreChannel(datum, errorReceipt.sequence, INVALID_UPGRADE_MESSAGE);
}
