import {
  assertEmergencyAuthority,
  assertGovernance,
} from "../types/plutus/Migration.ts";
import type { DeploymentOptions } from "./deployment.ts";

/** Every deployment requires governance and a separate emergency authority. */
export async function deploymentOptionsFromEnvironment(
  env: (name: string) => string | undefined = Deno.env.get,
  read: (path: string) => Promise<string> = Deno.readTextFile,
): Promise<DeploymentOptions> {
  if (env("IBC_DEPLOYMENT_MODE")) {
    throw new Error(
      "IBC_DEPLOYMENT_MODE was removed. Configure MIGRATION_GOVERNANCE_FILE for the single governed deployment model",
    );
  }
  const path = env("MIGRATION_GOVERNANCE_FILE");
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
