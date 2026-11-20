import type { DeploymentTemplate } from "./utils.ts";
import {
  type BridgeManifestCardanoIdentity,
  createBridgeManifest,
  normalizeBridgeManifestConfig,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/bridgeManifest.ts";

export async function writeDeploymentArtifacts(
  deployment: unknown,
  cardano: BridgeManifestCardanoIdentity,
  folder: string,
): Promise<void> {
  const manifest = createBridgeManifest(deployment, cardano);
  await Deno.mkdir(folder, { recursive: true });
  // Publish only after the complete manifest has been validated and written.
  const pending = await Deno.makeTempFile({
    dir: folder,
    prefix: ".bridge-manifest-",
  });
  try {
    await Deno.writeTextFile(
      pending,
      `${
        JSON.stringify(
          manifest,
          (_, value) => typeof value === "bigint" ? value.toString() : value,
          2,
        )
      }\n`,
    );
    await Deno.chmod(pending, 0o644);
    await Deno.rename(pending, `${folder}/bridge-manifest.json`);
  } finally {
    await Deno.remove(pending).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

// The public reader validates discovery fields. Operational tooling also needs
// the applied scripts and deployment metadata retained in the same manifest.
type OperationalDeployment = DeploymentTemplate & {
  hostStateNFT: NonNullable<DeploymentTemplate["hostStateNFT"]>;
};

export function deploymentFromManifest(value: unknown): OperationalDeployment {
  return normalizeBridgeManifestConfig(value)
    .deployment as unknown as OperationalDeployment;
}
