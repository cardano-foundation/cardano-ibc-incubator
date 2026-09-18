import { assert, assertEquals } from "@std/assert";
import { Data, getAddressDetails } from "@lucid-evolution/lucid";
import { HostStateDatum } from "../../types/plutus/HostState.ts";
import { Registry } from "../../types/plutus/Migration.ts";
import { accountingFixture } from "./migration-accounting.ts";
import { MIGRATION_PROFILE, roleValidators } from "../migration-plan.ts";
import {
  authorizeMigration,
  nextMigrationStep,
  prepareMigration,
} from "../migration.ts";
import { MigrationInventory } from "../migration-inventory.ts";
import type { DeploymentTemplate } from "../utils.ts";

/** Seeded population, real operator/builders and compiled scripts for every
 * governance/handover transaction. Not creation or two-chain packet acceptance. */
export async function runOperatorPopulation(
  shards: number,
  cached: boolean,
  interrupt = false,
  channels = 1,
  packetEntries = 2,
  rootTurnover = false,
) {
  const f = await accountingFixture(462, {
    escrowShards: shards,
    channelCount: BigInt(channels),
    populateAllChannels: true,
    packetEntries,
  });
  const { lucid, emulator, plan } = f;
  assert(plan.registry && plan.implementationRegistry);
  f.host.address = plan.hostState.address;
  f.registry.datum = Data.to(plan.registry, Registry);
  for (
    const validator of [...roleValidators(plan), ...f.successor.validators]
  ) f.reference(validator.script);
  // Only migration fields are consumed by this operator; retain the real full
  // applied baseline so production alias/hash/compatibility checks still run.
  const deployment = {
    deploymentMode: "upgradeable",
    migration: {
      profile: MIGRATION_PROFILE,
      registryUnit: f.registryUnit,
      registryAddress: plan.implementationRegistry.address,
      registryDatum: Data.to(plan.registry, Registry),
      baseline: plan,
    },
  } as unknown as DeploymentTemplate;
  const queries = { byUnit: 0, byAddress: 0, byOutRef: 0, addressEntries: 0 };
  const byUnit = lucid.utxoByUnit.bind(lucid),
    byAddress = lucid.utxosAt.bind(lucid),
    byRef = lucid.utxosByOutRef.bind(lucid);
  lucid.utxoByUnit = (unit) => {
    queries.byUnit++;
    return byUnit(unit);
  };
  lucid.utxosAt = async (address) => {
    queries.byAddress++;
    const result = await byAddress(address);
    queries.addressEntries += result.length;
    return result;
  };
  lucid.utxosByOutRef = (refs) => {
    queries.byOutRef++;
    return byRef(refs);
  };
  const submit = async (
    tx: Awaited<ReturnType<typeof authorizeMigration>>["tx"],
  ) => {
    const completed = await tx.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    await signed.submit();
    emulator.awaitBlock();
    lucid.overrideUTxOs([]);
    return signed.toCBOR().length / 2;
  };
  const timing = () => ({
    validFrom: emulator.now(),
    validTo: emulator.now() + 60_000,
  });
  const artifact = await prepareMigration(lucid, deployment);
  const continueRoot = async () => {
    const unit = f.registration.module_token.policy_id +
      f.registration.module_token.name;
    const current = await byUnit(unit);
    // Isolated resolution regression: a same-NFT/value/datum continuation is
    // seeded, not claimed as execution of its ordinary channel/packet cause.
    delete emulator.ledger[current.txHash + current.outputIndex];
    f.seed(current.address, current.assets, current.datum!);
    lucid.overrideUTxOs([]);
  };
  if (rootTurnover) await continueRoot();
  const authorized = await authorizeMigration(lucid, deployment, artifact, {
    ...timing(),
    expiresAt: BigInt(emulator.now() + 3 * 86_400_000),
  }, [getAddressDetails(f.address).paymentCredential!.hash]);
  await submit(authorized.tx);
  if (rootTurnover) await continueRoot();
  emulator.awaitSlot(86_500);
  let inventory = new MigrationInventory();
  const totals = {
    scans: 0,
    entries: 0,
    trees: 0,
    proofs: 0,
    incrementalDeletes: 0,
  };
  const accumulate = () => {
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      totals[key] += inventory.metrics[key];
    }
  };
  let transactions = 0,
    maxBytes = 0,
    constructionMs = 0,
    evaluationSubmissionMs = 0;
  const start = performance.now();
  for (;;) {
    if (!cached || interrupt && transactions === 4) {
      accumulate();
      inventory = new MigrationInventory();
    }
    const before = performance.now();
    const step = await nextMigrationStep(
      lucid,
      deployment,
      artifact,
      timing(),
      await f.ibcTree.getSiblings("ports/transfer"),
      inventory,
    );
    constructionMs += performance.now() - before;
    if (step.complete) break;
    const evaluation = performance.now();
    maxBytes = Math.max(maxBytes, await submit(step.tx));
    evaluationSubmissionMs += performance.now() - evaluation;
    transactions++;
    assert(transactions <= shards + channels + 3);
  }
  accumulate();
  assertEquals(transactions, shards + channels + 3); // Begin + one channel + root + N shards + Activate.
  for (const shard of f.shards) {
    const current = await byUnit(shard.nft);
    assertEquals(current.address, f.targetTransfer);
    assertEquals(current.assets, shard.utxo.assets);
    assertEquals(current.datum, shard.utxo.datum);
  }
  const host = Data.from((await byUnit(f.hostUnit)).datum!, HostStateDatum);
  assertEquals(host.state.next_channel_sequence, BigInt(channels));
  for (const source of f.channels) {
    const unit = Object.keys(source.assets).find((unit) =>
      unit !== "lovelace"
    )!;
    const current = await byUnit(unit);
    assertEquals(current.address, f.successor.validators[3].address);
    assertEquals(current.datum, source.datum);
    assertEquals(current.assets, source.assets);
  }
  return {
    shards,
    channels,
    packetEntries,
    cached,
    interrupt,
    transactions,
    maxBytes,
    elapsedMs: performance.now() - start,
    constructionMs,
    evaluationSubmissionMs,
    queries,
    inventory: totals,
  };
}
