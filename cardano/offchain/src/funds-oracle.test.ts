import { assertEquals, assertThrows } from "@std/assert";
import { Constr, type Data } from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";
import {
  assertLedgerSupply,
  assertPacketInventories,
  ledgerBalances,
  packetCommitment,
} from "./testing/funds-oracle.ts";

const packet = new Constr<Data>(0, [
  7n,
  "",
  "",
  "",
  "",
  "010203",
  new Constr(0, [2n, 3n]),
  1n,
]);
const commitment =
  "5b0cf5e329d27666bff2039d1e0ad4b17a8b185ce7d0c5febfa3ac8f7cff60eb";
const acknowledgement =
  "08f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c";

Deno.test("packet oracle commits to timestamp, both height fields and payload", () => {
  assertEquals(packetCommitment(packet), commitment);
});

Deno.test("packet oracle rejects wrong values even when sequence keys match", () => {
  const state = new Constr<Data>(0, [
    0n,
    0n,
    0n,
    0n,
    new Map([[7n, commitment]]),
    new Map([[8n, ""]]),
    new Map([[8n, acknowledgement]]),
  ]);
  assertPacketInventories(state, [{ packet }], [8n]);
  for (const index of [4, 5, 6]) {
    const original = state.fields[index];
    state.fields[index] = new Map([[index === 4 ? 7n : 8n, "ff"]]);
    assertThrows(() => assertPacketInventories(state, [{ packet }], [8n]));
    state.fields[index] = original;
  }
  assertThrows(() => assertPacketInventories(state, [], [8n]));
  assertThrows(() => assertPacketInventories(state, [{ packet }], []));
});

Deno.test("supply oracle detects vouchers outside the wallet and excludes spent inputs", () => {
  const entry = (address: string, quantity: bigint, spent = false) => ({
    spent,
    utxo: {
      address,
      txHash: "00".repeat(32),
      outputIndex: 0,
      assets: { voucher: quantity, unrelated: 99n },
    },
  });
  const emulator: Pick<Emulator, "ledger"> = {
    ledger: {
      wallet: entry("wallet", 10n),
      secondWalletOutput: entry("wallet", 2n),
      spent: entry("wallet", 100n, true),
      script: entry("script", 3n),
      recipient: entry("recipient", 5n),
    },
  };
  assertEquals(
    ledgerBalances(emulator, "voucher"),
    new Map([
      ["wallet", 12n],
      ["script", 3n],
      ["recipient", 5n],
    ]),
  );
  assertLedgerSupply(emulator, "voucher", 20n);
  assertThrows(() => assertLedgerSupply(emulator, "voucher", 12n));
  emulator.ledger.unexpected = entry("attacker", 1n);
  assertThrows(() => assertLedgerSupply(emulator, "voucher", 20n));
});
