import assert from 'node:assert/strict';
import test from 'node:test';
import { heartbeatWindowAllowed, nextHeartbeatTime } from './heartbeatSchedule';

test('epoch boundaries work for five-day, Preview and accelerated network timing', () => {
  for (const epochLengthMs of [432_000_000, 86_400_000, 50_000]) {
    const schedule = { epochOriginMs: 1_700_000_000_000, epochLengthMs };
    const midpoint = schedule.epochOriginMs + 7 * epochLengthMs + Math.floor(epochLengthMs / 2);
    assert.equal(nextHeartbeatTime(schedule, 0n, midpoint - 1), midpoint);
    assert.equal(heartbeatWindowAllowed(schedule, 0n, midpoint - 1, midpoint + 1), false);
    assert.equal(heartbeatWindowAllowed(schedule, 0n, midpoint, midpoint + 1), true);
    assert.equal(heartbeatWindowAllowed(schedule, BigInt(midpoint + 1), midpoint + 2, midpoint + 3), false);
    assert.equal(nextHeartbeatTime(schedule, BigInt(midpoint + 1), midpoint + 2), midpoint + epochLengthMs);
    const end = schedule.epochOriginMs + 8 * epochLengthMs;
    assert.equal(heartbeatWindowAllowed(schedule, 0n, end - 2, end - 1), true);
    assert.equal(heartbeatWindowAllowed(schedule, 0n, end - 1, end), false);
  }
});

test('invalid clocks and timing cannot produce an eligible witness', () => {
  const schedule = { epochOriginMs: 1_000, epochLengthMs: 1_000_000 };
  for (const [previous, from, to] of [
    [-1n, 501_000, 502_000], [1n, 501_000, 502_000],
    [0n, 999, 1_001], [0n, 501_000, 501_000], [0n, 501_000, 621_001],
  ] as const) assert.equal(heartbeatWindowAllowed(schedule, previous, from, to), false);
  assert.throws(() => nextHeartbeatTime({ epochOriginMs: 0, epochLengthMs: 0 }, 0n, 1));
});

test('a thirty-day idle period has six midpoint opportunities', () => {
  const schedule = { epochOriginMs: 0, epochLengthMs: 5 * 86_400_000 };
  let time = 1;
  let previous = 0n;
  let heartbeats = 0;
  for (;;) {
    time = nextHeartbeatTime(schedule, previous, time);
    if (time > 30 * 86_400_000) break;
    assert.equal(heartbeatWindowAllowed(schedule, previous, time, time + 1_000), true);
    previous = BigInt(time + 1_000);
    heartbeats++;
  }
  assert.equal(heartbeats, 6);
});
