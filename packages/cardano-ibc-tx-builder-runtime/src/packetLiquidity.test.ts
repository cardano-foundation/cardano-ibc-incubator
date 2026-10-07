import assert from "node:assert/strict";
import { test } from "node:test";
import type { UTxO } from "@lucid-evolution/lucid";
import { fromText } from "@lucid-evolution/lucid";
import { liquidityTokenName } from "@cardano-ibc/tx-builder/dist/packet-lanes";
import {
  encode,
  record,
  variant,
  selectPacketLiquidity,
  type PacketLaneDeployment,
} from "./packetLaneTransactions";

const deployment = {
  batchAddress: "batch",
  batchPolicy: "ab".repeat(28),
} as PacketLaneDeployment;
const denom = fromText("lovelace");
function deposits(principals: bigint[]): UTxO[] {
  return principals.map((principal, index) => {
    const hash = index.toString(16).padStart(64, "0");
    const identity =
      deployment.batchPolicy +
      liquidityTokenName("transfer", "channel-0", denom, hash, 0);
    return {
      txHash: hash,
      outputIndex: 0,
      address: "batch",
      assets: { lovelace: principal + 3_000_000n, [identity]: 1n },
      datum: encode(
        record(
          fromText("transfer"),
          fromText("channel-0"),
          fromText(denom),
          "",
          "",
          record(hash, 0n),
          principal,
          record(record("cd".repeat(28)), variant(1)),
        ),
      ),
    };
  });
}
const select = (inputs: UTxO[], amount: bigint, sequence = 1n) =>
  selectPacketLiquidity(
    inputs,
    deployment,
    "transfer",
    "channel-0",
    denom,
    amount,
    sequence,
  );

test("finds the sufficient deposit after five small deposits for every rotation", () => {
  const inputs = deposits([2n, 2n, 2n, 2n, 2n, 100n]);
  for (let sequence = 1n; sequence <= 12n; sequence++) {
    assert.deepEqual(select(inputs, 20n, sequence), [inputs[5]]);
  }
});

test("combines large deposits when no single input is sufficient", () => {
  const inputs = deposits([1n, 1n, 1n, 1n, 1n, 12n, 8n]);
  assert.deepEqual(select(inputs, 20n), [inputs[5], inputs[6]]);
});

test("honors the five-input bound and rejects unauthenticated large deposits", () => {
  assert.throws(
    () => select(deposits([3n, 3n, 3n, 3n, 3n, 3n]), 16n),
    /input limit/,
  );
  const inputs = deposits([2n, 100n]);
  const counterfeit = { ...inputs[1], assets: { lovelace: 103_000_000n } };
  assert.throws(() => select([inputs[0], counterfeit], 20n), /input limit/);
});

test("rotates equally sufficient inputs and equal-size combinations deterministically", () => {
  const inputs = deposits([10n, 10n, 10n]);
  assert.deepEqual(select(inputs, 9n, 2n), [inputs[1]]);
  assert.deepEqual(select(inputs, 20n, 2n), [inputs[1], inputs[2]]);
  assert.deepEqual(select([...inputs].reverse(), 20n, 2n), [
    inputs[1],
    inputs[2],
  ]);
});

test("finds a bounded selection whenever the five largest authenticated principals cover it", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const amounts = Array.from({ length: 9 }, (_, i) =>
      BigInt(((seed * (i + 3) * 17) % 29) + 1),
    );
    const inputs = deposits(amounts);
    const maximum = [...amounts]
      .sort((a, b) => Number(b - a))
      .slice(0, 5)
      .reduce((a, b) => a + b);
    for (const amount of [1n, maximum / 2n, maximum, maximum + 1n]) {
      if (amount > maximum)
        assert.throws(
          () => select(inputs, amount, BigInt(seed)),
          /input limit/,
        );
      else {
        const selected = select(inputs, amount, BigInt(seed));
        assert.ok(selected.length <= 5);
        assert.ok(
          selected.reduce(
            (total, input) => total + amounts[inputs.indexOf(input)],
            0n,
          ) >= amount,
        );
      }
    }
  }
});
