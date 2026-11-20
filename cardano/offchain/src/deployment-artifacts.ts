import {
  type BridgeManifestCardanoIdentity,
  normalizeHandlerJsonDeploymentConfig,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/bridgeManifest.ts";

export async function writeDeploymentArtifacts(
  deployment: unknown,
  cardano: BridgeManifestCardanoIdentity,
  folder: string,
  timestamp: string,
): Promise<void> {
  const manifest =
    normalizeHandlerJsonDeploymentConfig(deployment, cardano).bridgeManifest;
  await Deno.mkdir(folder, { recursive: true });
  const handler = JSON.stringify(deployment);
  await Deno.writeTextFile(`${folder}/handler_${timestamp}.json`, handler);
  await Deno.writeTextFile(`${folder}/handler.json`, handler);
  // Publish only after the complete manifest has been validated and written.
  const pending = await Deno.makeTempFile({
    dir: folder,
    prefix: ".bridge-manifest-",
  });
  try {
    await Deno.writeTextFile(pending, `${JSON.stringify(manifest, null, 2)}\n`);
    await Deno.chmod(pending, 0o644);
    await Deno.rename(pending, `${folder}/bridge-manifest.json`);
  } finally {
    await Deno.remove(pending).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}
