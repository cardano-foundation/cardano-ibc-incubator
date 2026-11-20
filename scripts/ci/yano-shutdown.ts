import { deploymentFromManifest } from "../../cardano/offchain/src/deployment-artifacts.ts";
// Run unchanged against a fresh deployment and each restored baseline.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  Data,
  generatePrivateKey,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { HostStateDatum } from "../../cardano/offchain/types/index.ts";
import { type DeploymentTemplate } from "../../cardano/offchain/src/utils.ts";
import {
  buildEnterShutdownTx,
  MIN_SHUTDOWN_GRACE_PERIOD_MS,
} from "../../cardano/offchain/scripts/shutdown-deployment.ts";

export async function testShutdown(
  lucid: LucidEvolution,
  base: string,
  ownerKey: string,
) {
  const started = performance.now();
  const deployment = deploymentFromManifest(JSON.parse(
    await Deno.readTextFile("deployments/bridge-manifest.json"),
  ));
  const nft = deployment.hostStateNFT!;
  const readHost = async () => {
    const utxo = await lucid.utxoByUnit(nft.policyId + nft.name);
    return { utxo, datum: Data.from(utxo.datum!, HostStateDatum) };
  };
  const submitShutdown = async (grace: { gracePeriodMs: number }) => {
    const tx = await buildEnterShutdownTx(lucid, deployment, grace);
    const signed = await (await tx.complete()).sign.withWallet().complete();
    const hash = await signed.submit();
    await lucid.awaitTx(hash);
  };
  const before = await readHost();
  assertEquals(before.datum.control.shutdown, "Active");

  // Give an unrelated wallet enough funds so rejection cannot be caused by fees.
  lucid.selectWallet.fromPrivateKey(generatePrivateKey());
  const address = await lucid.wallet().address();
  const response = await fetch(`${base}/devnet/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, ada: 100 }),
  });
  if (!response.ok) throw new Error(await response.text());
  await response.json();
  const deadline = performance.now() + 30000;
  while (!(await lucid.utxosAt(address)).length) {
    if (performance.now() > deadline) {
      throw new Error("Unauthorized wallet funding timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const rejection = await assertRejects(() =>
    submitShutdown({
      gracePeriodMs: MIN_SHUTDOWN_GRACE_PERIOD_MS,
    })
  );
  // Require an authorization rejection, not a transport or balancing error.
  if (
    !/governance quorum|EvaluationFailure.*Script evaluation failed|MissingVKeyWitnesses|MissingRequiredSigners|[Mm]issing.*[Ww]itness/
      .test(String(rejection))
  ) {
    throw rejection;
  }
  assertEquals(await readHost(), before);

  lucid.selectWallet.fromPrivateKey(ownerKey);
  await assertRejects(
    () => submitShutdown({ gracePeriodMs: 1 }),
    Error,
    "Shutdown requires at least",
  );
  await submitShutdown({
    gracePeriodMs: MIN_SHUTDOWN_GRACE_PERIOD_MS,
  });
  const after = await readHost();
  if (after.datum.control.shutdown === "Active") {
    throw new Error("Shutdown transaction was not adopted");
  }
  assertEquals(after.datum.state.version, before.datum.state.version + 1n);
  // The larger shutdown datum may require a higher minimum ADA deposit.
  assert(after.utxo.assets.lovelace >= before.utxo.assets.lovelace);
  assertEquals(
    { ...after.utxo.assets, lovelace: 0n },
    { ...before.utxo.assets, lovelace: 0n },
  );
  const shutdown = after.datum.control.shutdown.ShuttingDown;
  assertEquals(
    shutdown.grace_period_end - shutdown.initiated_at,
    BigInt(MIN_SHUTDOWN_GRACE_PERIOD_MS),
  );
  await assertRejects(
    () =>
      submitShutdown({
        gracePeriodMs: MIN_SHUTDOWN_GRACE_PERIOD_MS,
      }),
    Error,
    "already shutting down",
  );
  console.log(
    JSON.stringify({
      passed: true,
      cases: [
        "unauthorized-shutdown",
        "minimum-grace",
        "authorized-shutdown",
        "duplicate-shutdown",
      ],
      seconds: (performance.now() - started) / 1000,
    }),
  );
}
