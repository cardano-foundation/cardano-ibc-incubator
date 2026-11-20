import { assertEquals, assertRejects } from "@std/assert";
import { writeDeploymentArtifacts } from "./deployment-artifacts.ts";
import { normalizeBridgeManifestConfig } from "../../../packages/cardano-ibc-tx-builder-runtime/src/bridgeManifest.ts";
import previousHandler from "../../../manifests/preview/cardano-preview-handler.json" with {
  type: "json",
};

const handler = {
  ...previousHandler,
  migration: {
    ...previousHandler.migration,
    profile: "cardano-ibc-compatible-v6",
  },
};

Deno.test("deployment publishes a usable public manifest beside its internal artifacts", async () => {
  const folder = await Deno.makeTempDir();
  try {
    await writeDeploymentArtifacts(
      handler,
      { chain_id: "cardano-preview", network_magic: 2, network: "Preview" },
      folder,
      "test",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(`${folder}/bridge-manifest.json`),
    );
    if (Deno.build.os !== "windows") {
      assertEquals(
        (await Deno.stat(`${folder}/bridge-manifest.json`)).mode! & 0o777,
        0o644,
      );
    }
    const loaded = normalizeBridgeManifestConfig(manifest);
    assertEquals(
      loaded.deployment.hostStateNFT.policyId,
      handler.hostStateNFT.policyId,
    );
    assertEquals(
      loaded.deployment.hostStateNFT.name,
      handler.hostStateNFT.name,
    );
    assertEquals(manifest.cardano.chain_id, "cardano-preview");
    assertEquals(manifest.history, handler.history);
    assertEquals(manifest.validators.host_state_stt.script, undefined);
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${folder}/handler.json`)),
      handler,
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${folder}/handler_test.json`)),
      handler,
    );
    await assertRejects(() =>
      writeDeploymentArtifacts({}, manifest.cardano, folder, "invalid")
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(`${folder}/bridge-manifest.json`)),
      manifest,
    );
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});
