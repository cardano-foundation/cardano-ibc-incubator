import {
  assertEmergencyAuthority,
  assertGovernance,
} from "../types/plutus/Migration.ts";
import type { DeploymentOptions } from "./deployment.ts";

/** Resolve before network access or funding: omission never selects legacy. */
export async function deploymentOptionsFromEnvironment(
  env: (name: string) => string | undefined = Deno.env.get,
  read: (path: string) => Promise<string> = Deno.readTextFile,
): Promise<DeploymentOptions> {
  const deploymentMode = env("IBC_DEPLOYMENT_MODE");
  if (deploymentMode !== "upgradeable" && deploymentMode !== "legacy") {
    throw new Error(
      "Set IBC_DEPLOYMENT_MODE explicitly to upgradeable or legacy; legacy has no recovery capability",
    );
  }
  const path = env("MIGRATION_GOVERNANCE_FILE");
  if (deploymentMode === "legacy") {
    if (path) {
      throw new Error(
        "Legacy mode conflicts with MIGRATION_GOVERNANCE_FILE; select upgradeable",
      );
    }
    return { deploymentMode };
  }
  if (!path?.trim()) {
    throw new Error(
      "Upgradeable deployment requires MIGRATION_GOVERNANCE_FILE; no transactions were submitted",
    );
  }
  try {
    const input = JSON.parse(await read(path));
    const governance = {
      signers: input.signers,
      quorum: BigInt(input.quorum),
      delay_ms: BigInt(input.delay_ms),
    };
    assertGovernance(governance);
    if (!input.emergency) {
      throw new Error("Explicit separate emergency authority is required");
    }
    const emergency = {
      signers: input.emergency.signers,
      quorum: BigInt(input.emergency.quorum),
    };
    assertEmergencyAuthority(emergency, governance);
    return {
      deploymentMode,
      migration: {
        governance,
        emergency,
        bootstrapSigners: governance.signers,
      },
    };
  } catch (error) {
    throw new Error(
      "Invalid MIGRATION_GOVERNANCE_FILE: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
