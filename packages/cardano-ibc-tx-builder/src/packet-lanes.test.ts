import assert from "node:assert/strict";
import { test } from "node:test";
import {
  liquidityTokenName,
  MAX_PACKET_SEQUENCE,
  packetKeyLane,
  packetLane,
  packetLaneTokenName,
  parsePacketKey,
  sendSequencerTokenName,
} from "./packet-lanes";

test("packet lane identities match the Aiken and Go wire vectors", () => {
  assert.deepEqual(
    [1n, 2n, 3n, 4n, 5n].map((sequence) =>
      packetLane("transfer", "channel-0", sequence, 16),
    ),
    [7, 14, 6, 15, 12],
  );
  assert.equal(
    packetLaneTokenName("transfer", "channel-0", 0, 16),
    "31f732290ccec0a1b9dd878576dcfb232fd4b3a07125c849c0473fe61768d1c8",
  );
  assert.equal(
    sendSequencerTokenName("transfer", "channel-0"),
    "cf6734b7a7e0f38bb24b4570cc7dac2ad272d260116e9336afae5ee8c1495a1e",
  );
  assert.equal(
    liquidityTokenName("transfer", "channel-0", "lovelace", "ab".repeat(32), 3),
    "739f68318d16ddd05518b4e0ad566b84b70300fce1ed528db92913d5bd634e8a",
  );
});

test("all packet keys use the sequence lane and aliases fail closed", () => {
  for (const kind of ["commitments", "receipts", "acks"]) {
    assert.equal(
      packetKeyLane(
        `${kind}/ports/transfer/channels/channel-0/sequences/1`,
        16,
      ),
      7,
    );
  }
  for (const suffix of ["0", "01", "-1", "1/extra", "18446744073709551616"]) {
    assert.throws(() =>
      parsePacketKey(
        `receipts/ports/transfer/channels/channel-0/sequences/${suffix}`,
      ),
    );
  }
  for (const channel of [
    "channel-00",
    "channel--1",
    "channel-18446744073709551616",
  ]) {
    assert.throws(() => packetLane("transfer", channel, 1n, 16));
  }
  for (const count of [0, -1, 65, 1.5, NaN, Infinity]) {
    assert.throws(() => packetLane("transfer", "channel-0", 1n, count));
  }
  assert.throws(() => packetLane("transfer", "channel-0", 0n, 16));
  assert.equal(packetLane("transfer", "channel-0", MAX_PACKET_SEQUENCE, 1), 0);
});

test("same asset deposits on the same channel have separate liquidity identities", () => {
  const names = [0, 1, 2, 3, 4].map((index) =>
    liquidityTokenName(
      "transfer",
      "channel-0",
      "lovelace",
      "ab".repeat(32),
      index,
    ),
  );
  assert.equal(new Set(names).size, 5);
  assert.notEqual(
    names[0],
    liquidityTokenName("transfer", "channel-1", "lovelace", "ab".repeat(32), 0),
  );
  assert.notEqual(
    names[0],
    liquidityTokenName(
      "transfer",
      "channel-0",
      "other-asset",
      "ab".repeat(32),
      0,
    ),
  );
});
