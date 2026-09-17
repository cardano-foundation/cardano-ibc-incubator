import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { assertEquals } from "@std/assert";
import type { Constr, Data } from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";

// Inspect the entire committed ledger, including script addresses and wallets
// the transaction builder does not control. Spent inputs are not supply.
export function ledgerBalances(
  emulator: Pick<Emulator, "ledger">,
  unit: string,
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const { utxo, spent } of Object.values(emulator.ledger)) {
    const amount = utxo.assets[unit] ?? 0n;
    if (!spent && amount !== 0n) {
      balances.set(utxo.address, (balances.get(utxo.address) ?? 0n) + amount);
    }
  }
  return balances;
}

export function assertLedgerSupply(
  emulator: Pick<Emulator, "ledger">,
  unit: string,
  expected: bigint,
) {
  assertEquals(
    [...ledgerBalances(emulator, unit).values()].reduce((a, b) => a + b, 0n),
    expected,
    "asset supply across the entire ledger",
  );
}

// Independently implement the ICS-04 commitment encoding. Do not reuse a
// commitment from the builder or infer expected values from the output datum.
export function packetCommitment(packet: Constr<Data>): string {
  const height = packet.fields[6] as Constr<Data>;
  const prefix = Buffer.alloc(24);
  prefix.writeBigUInt64BE(packet.fields[7] as bigint, 0);
  prefix.writeBigUInt64BE(height.fields[0] as bigint, 8);
  prefix.writeBigUInt64BE(height.fields[1] as bigint, 16);
  const dataHash = createHash("sha256")
    .update(Buffer.from(packet.fields[5] as string, "hex")).digest();
  return createHash("sha256").update(prefix).update(dataHash).digest("hex");
}

export function assertPacketInventories(
  state: Constr<Data>,
  pending: { packet: Constr<Data> }[],
  received: bigint[],
) {
  assertEquals(
    state.fields[4],
    new Map(pending.map(({ packet }) => [
      packet.fields[0],
      packetCommitment(packet),
    ])),
    "outstanding packet commitments",
  );
  assertEquals(
    state.fields[5],
    new Map(received.map((sequence) => [sequence, ""])),
    "packet receipts",
  );
  const acknowledgement = createHash("sha256")
    .update('{"result":"AQ=="}').digest("hex");
  assertEquals(
    state.fields[6],
    new Map(received.map((sequence) => [sequence, acknowledgement])),
    "packet acknowledgements",
  );
}
