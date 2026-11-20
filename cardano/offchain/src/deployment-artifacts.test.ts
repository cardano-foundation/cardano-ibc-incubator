import { normalizeBridgeManifestConfig } from "../../../packages/cardano-ibc-tx-builder-runtime/src/bridgeManifest.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deploymentFromManifest,
  writeDeploymentArtifacts,
} from "./deployment-artifacts.ts";
import fixture from "../../../manifests/preview/cardano-preview-bridge-manifest.json" with {
  type: "json",
};

Deno.test("deployment publishes one complete manifest and preserves it on invalid input", async () => {
  const folder = await Deno.makeTempDir();
  try {
    const deployment = {
      ...deploymentFromManifest(fixture),
      backupOperatorKeyHash: "ab".repeat(28),
    };
    assertThrows(
      () => deploymentFromManifest(deployment),
      Error,
      "Invalid bridge config",
    );
    await writeDeploymentArtifacts(deployment, fixture.cardano, folder);
    const published = JSON.parse(
      await Deno.readTextFile(`${folder}/bridge-manifest.json`),
    );
    assertEquals(deploymentFromManifest(published), deployment);
    const discovery = normalizeBridgeManifestConfig(published).bridgeManifest;
    assertEquals("script" in discovery.validators.host_state_stt, false);
    assertEquals("baseline" in discovery.migration!, false);
    assertEquals(published.migration.baseline, fixture.migration.baseline);
    assertEquals(
      published.migration.registryReference,
      fixture.migration.registryReference,
    );
    assertEquals(
      published.backup_operator_key_hash,
      deployment.backupOperatorKeyHash,
    );
    assertEquals(
      published.validators.host_state_stt.script,
      fixture.validators.host_state_stt.script,
    );
    assertEquals(
      published.validators.host_state_stt.ref_utxo,
      fixture.validators.host_state_stt.ref_utxo,
    );
    assertEquals(published.history, fixture.history);
    const files = [];
    for await (const entry of Deno.readDir(folder)) files.push(entry.name);
    assertEquals(files, ["bridge-manifest.json"]);
    if (Deno.build.os !== "windows") {
      assertEquals(
        (await Deno.stat(`${folder}/bridge-manifest.json`)).mode! & 0o777,
        0o644,
      );
    }
    await assertRejects(() =>
      writeDeploymentArtifacts({}, fixture.cardano, folder)
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${folder}/bridge-manifest.json`)),
      published,
    );
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});
