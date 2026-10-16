import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { Constr, Data, fromText, type UTxO } from "@lucid-evolution/lucid";
import { transferEscrowShardTokenName } from "../../../packages/cardano-ibc-tx-builder-runtime/src/transferEscrowIdentity.ts";
import { assertEscrowIncrease, escrowSnapshot } from "./recovery-escrow.ts";

const address = "transfer-address";
const policy = "01".repeat(28);
const asset = "02".repeat(28) + "abcd";
const channel = "channel-3";
const token = policy +
  transferEscrowShardTokenName(fromText(channel), fromText(asset));

function holder(amount = 12345n): UTxO {
  return {
    txHash: "03".repeat(32),
    outputIndex: 1,
    address,
    assets: { [token]: 1n, [asset]: amount, lovelace: 2000000n },
    datum: Data.to<Data>(
      new Constr(0, [fromText(channel), fromText(asset), amount]),
      undefined,
      { canonical: true },
    ),
  };
}

const snapshot = (utxos: UTxO[]) =>
  escrowSnapshot(utxos, address, policy, channel, asset);

Deno.test("escrow snapshot binds the route to its shard and preserves integer precision", () => {
  const amount = 9007199254740993n;
  const utxo = holder(amount);
  const other = holder();
  other.assets = { lovelace: 2000000n };
  const before = snapshot([other, utxo]);
  assertEquals(before.output, `${utxo.txHash}#1`);
  assertEquals(before.shardToken, token);
  assertEquals(before.escrowedAmount, "9007199254740993");
  assertEquals(before.assets[asset], "9007199254740993");
  const reordered = {
    ...utxo,
    assets: { lovelace: 2000000n, [asset]: amount, [token]: 1n },
  };
  assertEquals(JSON.stringify(before), JSON.stringify(snapshot([reordered])));
  const after = holder(amount + 12345n);
  after.txHash = "04".repeat(32);
  assertEscrowIncrease(before, snapshot([after]), 12345n);
});

Deno.test("escrow snapshot rejects absent, duplicate and foreign route shards", () => {
  assertThrows(() => snapshot([]), Error, "exactly one");
  assertThrows(() => snapshot([holder(), holder()]), Error, "exactly one");
  assertThrows(
    () => escrowSnapshot([holder()], address, policy, "channel-4", asset),
    Error,
    "exactly one",
  );
  assertThrows(
    () => escrowSnapshot([holder()], address, "05".repeat(28), channel, asset),
    Error,
    "exactly one",
  );
});

Deno.test("ADA escrow keeps its reserve separate from the recorded deposit", () => {
  const packetDenom = fromText(fromText("lovelace"));
  const adaToken = policy +
    transferEscrowShardTokenName(fromText(channel), packetDenom);
  const utxo = holder();
  utxo.assets = { [adaToken]: 1n, lovelace: 2012345n };
  utxo.datum = Data.to<Data>(
    new Constr(0, [fromText(channel), packetDenom, 12345n]),
    undefined,
    { canonical: true },
  );
  const before = escrowSnapshot([utxo], address, policy, channel, "lovelace");
  assertEquals(before.asset, "lovelace");
  assertEquals(before.escrowedAmount, "12345");
  assertEquals(before.assets.lovelace, "2012345");
  utxo.txHash = "04".repeat(32);
  utxo.assets.lovelace += 12345n;
  utxo.datum = Data.to<Data>(
    new Constr(0, [fromText(channel), packetDenom, 24690n]),
    undefined,
    { canonical: true },
  );
  assertEscrowIncrease(
    before,
    escrowSnapshot([utxo], address, policy, channel, "lovelace"),
    12345n,
  );
});

Deno.test("escrow snapshot rejects malformed holders and ledger/datum disagreements", () => {
  const mutations: Array<(utxo: UTxO) => void> = [
    (u) => {
      u.assets[token] = 2n;
    },
    (u) => {
      u.address = "wrong-address";
    },
    (u) => {
      u.datum = undefined;
    },
    (u) => {
      u.datum = "not-cbor";
    },
    (u) => {
      u.assets[asset] = 12344n;
    },
    (u) => {
      u.assets.lovelace = -1n;
    },
    (u) => {
      u.assets["09".repeat(28)] = 1n;
    },
    (u) => {
      u.datum = Data.to(
        new Constr(0, [fromText("channel-4"), fromText(asset), 12345n]),
      );
    },
    (u) => {
      u.datum = Data.to(
        new Constr(0, [fromText(channel), fromText("09".repeat(28)), 12345n]),
      );
    },
    (u) => {
      u.datum = Data.to(
        new Constr(0, [fromText(channel), fromText(asset), -1n]),
      );
    },
  ];
  for (const mutate of mutations) {
    const utxo = holder();
    mutate(utxo);
    assertThrows(() => snapshot([utxo]));
  }
});

Deno.test("post-transfer escrow must replace the output and change only the transferred amount", () => {
  const before = snapshot([holder()]);
  const next = holder(24690n);
  next.txHash = "04".repeat(32);
  const after = snapshot([next]);
  assertNotEquals(before.datum, after.datum);
  assertEscrowIncrease(before, after, 12345n);
  assertThrows(() =>
    assertEscrowIncrease(before, { ...after, output: before.output }, 12345n)
  );
  assertThrows(() =>
    assertEscrowIncrease(
      before,
      { ...after, shardToken: "other-token" },
      12345n,
    )
  );
  assertThrows(() => assertEscrowIncrease(before, after, 12344n));
  assertThrows(() =>
    assertEscrowIncrease(before, { ...after, escrowedAmount: "24689" }, 12345n)
  );
  for (
    const [unit, amount] of [[asset, "24691"], ["lovelace", "1999999"], [
      token,
      "2",
    ]]
  ) {
    assertThrows(() =>
      assertEscrowIncrease(before, {
        ...after,
        assets: { ...after.assets, [unit]: amount },
      }, 12345n)
    );
  }
});
