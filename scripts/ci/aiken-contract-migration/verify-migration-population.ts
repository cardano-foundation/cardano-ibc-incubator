/** Independent snapshot comparison of a quiescent handover, not a proof of
 * governance quality, ledger finality, or post-activation packet correctness. */
import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Data } from "@lucid-evolution/lucid";
import {
  HostStateDatum,
  ModuleRegistration,
} from "../../../cardano/offchain/types/plutus/HostState.ts";
import { bech32Address } from "../../../cardano/offchain/types/plutus/Migration.ts";
import { canonicalMigrationJson } from "../../../cardano/offchain/src/migration-plan.ts";

const [beforePath, afterPath, witnessPath] = Deno.args;
if (!beforePath || !afterPath || !witnessPath) {
  throw new Error(
    "Usage: verify-migration-population.ts BEFORE_JSON AFTER_JSON PORT_WITNESS_JSON",
  );
}
const before = JSON.parse(await Deno.readTextFile(beforePath));
const after = JSON.parse(await Deno.readTextFile(afterPath));
const witness = JSON.parse(await Deno.readTextFile(witnessPath));
assertEquals(before.format, "migration-rehearsal-population-v1");
assertEquals(after.format, before.format);
assertEquals(after.registry.phase, "Ready");
assertEquals(after.registry.host_policy, before.registry.host_policy);
assertEquals(after.registry.token, before.registry.token);
assertEquals(after.registry.identity, before.registry.identity);
assertEquals(after.registry.governance, before.registry.governance);
assertEquals(
  after.registry.current.compatibility,
  before.registry.current.compatibility,
);
assertEquals(
  BigInt(after.registry.current.generation),
  BigInt(before.registry.current.generation) + 1n,
);
assertEquals(BigInt(after.registry.nonce), BigInt(before.registry.nonce) + 1n);
assertEquals(after.objects.length, before.objects.length);
assertEquals(
  new Set(after.objects.map((o: any) => o.unit)).size,
  after.objects.length,
);
const nonAda = (assets: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(assets).filter(([unit]) => unit !== "lovelace"),
  );
for (const old of before.objects) {
  const next = after.objects.find((o: any) => o.unit === old.unit);
  assert(next, `Omitted state identity ${old.unit}`);
  assertEquals(next.role, old.role);
  assertEquals(
    nonAda(next.utxo.assets),
    nonAda(old.utxo.assets),
    `Principal/state-token conservation for ${old.role}`,
  );
  assert(
    BigInt(next.utxo.assets.lovelace) >= BigInt(old.utxo.assets.lovelace),
    `Infrastructure ADA decrease at ${old.role}`,
  );
  assertEquals(
    next.utxo.scriptRef,
    old.utxo.scriptRef,
    `Reference-script change at ${old.role}`,
  );
  assert(
    next.utxo.address !== old.utxo.address,
    `Role was not replaced: ${old.role}`,
  );
  const roleIndex = old.role === "host"
    ? 0
    : old.role.startsWith("ibc_client/")
    ? 1
    : old.role.startsWith("connection/")
    ? 2
    : old.role.startsWith("channel/")
    ? 3
    : 4;
  assertEquals(
    next.utxo.address,
    bech32Address("Custom", after.registry.current.addresses[roleIndex]),
  );
  if (old.role !== "host") {
    assertEquals(
      next.utxo.datum,
      old.utxo.datum,
      `Claims/sequences/datum changed at ${old.role}`,
    );
  }
}
const oldHost = Data.from(
  before.objects.find((o: any) => o.role === "host").utxo.datum,
  HostStateDatum,
);
const newHost = Data.from(
  after.objects.find((o: any) => o.role === "host").utxo.datum,
  HostStateDatum,
);
const port = "7472616e73666572";
const oldRegistration = oldHost.control.port_registry.get(port)!;
const newRegistration = newHost.control.port_registry.get(port)!;
assert(oldRegistration && newRegistration, "Transfer registration missing");
assertEquals(newRegistration, {
  ...oldRegistration,
  module_script_hash:
    after.registry.current.addresses[4].payment_credential.Script[0],
});
assertEquals(witness.format, "cardano-ibc-migration-port-witness-v1");
assertEquals(witness.root, oldHost.state.ibc_state_root);
assertEquals(witness.siblings.length, 64);
// Independent SHA-256 path traversal over the original and replacement port
// value. No migration builder or state-tree update implementation is called.
function rootFor(value: string): string {
  const hash = (...parts: Buffer[]) =>
    createHash("sha256").update(Buffer.concat(parts)).digest();
  const key = hash(Buffer.from("ports/transfer"));
  let index = key.readBigUInt64BE();
  let node = hash(Buffer.from([0]), key, hash(Buffer.from(value, "hex")));
  for (const siblingHex of witness.siblings) {
    assert(/^[0-9a-f]{64}$/.test(siblingHex), "Malformed proof sibling");
    const sibling = Buffer.from(siblingHex, "hex");
    node = (index & 1n) === 0n
      ? hash(Buffer.from([1]), node, sibling)
      : hash(Buffer.from([1]), sibling, node);
    index >>= 1n;
  }
  return node.toString("hex");
}
assertEquals(
  rootFor(Data.to(oldRegistration, ModuleRegistration)),
  oldHost.state.ibc_state_root,
  "Witness does not authenticate original committed state",
);
assertEquals(
  rootFor(Data.to(newRegistration, ModuleRegistration)),
  newHost.state.ibc_state_root,
  "Activation changed more than the permitted port commitment",
);
const expectedHost = structuredClone(oldHost);
// Begin records the custody handover; Activate records the port commitment.
expectedHost.state.version += 2n;
expectedHost.state.last_update_time = newHost.state.last_update_time;
expectedHost.state.ibc_state_root = newHost.state.ibc_state_root;
expectedHost.control.port_registry.set(port, newRegistration);
assertEquals(newHost, expectedHost, "Unexpected HostState transformation");
function walletAssets(wallet: any) {
  const total: Record<string, bigint> = {};
  for (const utxo of wallet.utxos) {
    for (const [unit, quantity] of Object.entries(utxo.assets)) {
      if (unit !== "lovelace") {
        total[unit] = (total[unit] ?? 0n) + BigInt(quantity as string);
      }
    }
  }
  return total;
}
assertEquals(after.wallets.length, before.wallets.length);
for (const wallet of before.wallets) {
  const next = after.wallets.find((w: any) => w.address === wallet.address);
  assert(next, "Holder missing");
  assertEquals(
    walletAssets(next),
    walletAssets(wallet),
    "Existing holder asset identity/quantity changed",
  );
}
assertEquals(after.counterparty.chain, before.counterparty.chain);
assertEquals(after.counterparty.address, before.counterparty.address);
assertEquals(
  after.genesisSha256,
  before.genesisSha256,
  "Genesis provenance changed",
);
assertEquals(
  after.counterparty.escrows,
  before.counterparty.escrows,
  "Remote escrow backing changed",
);
assertEquals(
  after.counterparty.balances,
  before.counterparty.balances,
  "Counterparty voucher balances changed during handover",
);
console.log(canonicalMigrationJson({
  verified: true,
  sourceGeneration: before.registry.current.generation,
  successorGeneration: after.registry.current.generation,
  objects: after.objects.length,
  holders: after.wallets.length,
  check:
    "Exact state/principal, existing assets, and independently recomputed port commitment transition",
}));
