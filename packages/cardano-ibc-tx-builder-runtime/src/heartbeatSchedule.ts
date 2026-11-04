/** Immutable epoch timing applied to both HostState validators at deployment. */
export type HeartbeatSchedule = {
  epochOriginMs: number;
  epochLengthMs: number;
};

export const HEARTBEAT_MAX_VALIDITY_MS = 120_000;

export function checkedHeartbeatSchedule(value: unknown): HeartbeatSchedule {
  const schedule = value as HeartbeatSchedule | undefined;
  if (!schedule || !Number.isSafeInteger(schedule.epochOriginMs) ||
    schedule.epochOriginMs < 0 || !Number.isSafeInteger(schedule.epochLengthMs) ||
    schedule.epochLengthMs < 2) {
    throw new Error('Missing or invalid deployment heartbeat epoch timing');
  }
  return schedule;
}

/** Return the first eligible lower bound, including a retry after a missed midpoint. */
export function nextHeartbeatTime(
  value: HeartbeatSchedule,
  previousUpperBound: bigint,
  timeMs: number,
): number {
  const { epochOriginMs, epochLengthMs } = checkedHeartbeatSchedule(value);
  if (!Number.isSafeInteger(timeMs) || timeMs < epochOriginMs || previousUpperBound < 0n) {
    throw new Error('Invalid heartbeat clock');
  }
  const epoch = Math.floor((timeMs - epochOriginMs) / epochLengthMs);
  const previousEpoch = previousUpperBound === 0n ? -1n :
    (previousUpperBound - BigInt(epochOriginMs)) / BigInt(epochLengthMs);
  if (previousUpperBound !== 0n && previousUpperBound < BigInt(epochOriginMs)) {
    throw new Error('Heartbeat clock predates the deployment epoch origin');
  }
  const nextEpoch = previousEpoch >= BigInt(epoch) ? previousEpoch + 1n : BigInt(epoch);
  const midpoint = epochOriginMs + Number(nextEpoch) * epochLengthMs + Math.floor(epochLengthMs / 2);
  if (!Number.isSafeInteger(midpoint)) throw new Error('Heartbeat epoch overflows safe time');
  return Math.max(timeMs, midpoint);
}

/** Mirrors Aiken's finite, single-epoch heartbeat validity rule. */
export function heartbeatWindowAllowed(
  schedule: HeartbeatSchedule,
  previousUpperBound: bigint,
  fromMs: number,
  toMs: number,
): boolean {
  try {
    return Number.isSafeInteger(toMs) && toMs > fromMs &&
      toMs - fromMs <= HEARTBEAT_MAX_VALIDITY_MS &&
      nextHeartbeatTime(schedule, previousUpperBound, fromMs) === fromMs &&
      Math.floor((fromMs - schedule.epochOriginMs) / schedule.epochLengthMs) ===
        Math.floor((toMs - schedule.epochOriginMs) / schedule.epochLengthMs);
  } catch {
    return false;
  }
}
