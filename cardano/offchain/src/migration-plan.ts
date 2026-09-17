import {
  Data,
  fromText,
  type LucidEvolution,
  toHex,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "../types/plutus/AuthToken.ts";
import {
  CredentialSchema,
  type Implementation,
  plutusAddress,
  type Registry,
} from "../types/plutus/Migration.ts";
import type {
  DeploymentPlanInputs,
  PlannedValidator,
} from "./deployment-plan.ts";
import {
  generateIdentifierTokenName,
  generatePortTokenName,
  readValidator,
} from "./utils.ts";

export const MIGRATION_PROFILE = "cardano-ibc-compatible-v1";
export type SuccessorBlueprint = {
  validators: Array<{ title: string; compiledCode: string }>;
};
// Parameter order is an ABI, never the iteration order of a JSON object.
export const CHANNEL_OPERATION_NAMES = [
  "chan_open_ack",
  "chan_open_confirm",
  "chan_close_init",
  "chan_close_confirm",
  "recv_packet",
  "send_packet",
  "timeout_packet",
  "acknowledge_packet",
  "prune_packet_history",
] as const;
export const REGISTRY_TOKEN_NAME = fromText("ibc_implementation_registry");
export const MIGRATION_ROLES = [
  "host",
  "client",
  "connection",
  "channel",
  "transfer",
] as const;
export function canonicalMigrationJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (typeof entry === "bigint") return entry.toString();
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([key, field]) => [key, normalize(field)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}
type BasePlan = {
  inputs: DeploymentPlanInputs;
  validators: PlannedValidator[];
  hostNft: PlannedValidator;
  hostState: PlannedValidator;
  spendClient: PlannedValidator;
  spendConnection: PlannedValidator;
  spendingChannel: {
    base: PlannedValidator;
    referredScripts: Record<string, PlannedValidator>;
  };
  spendTransferModule: PlannedValidator;
  mintClient: PlannedValidator;
  mintConnection: PlannedValidator;
  mintChannel: PlannedValidator;
  mintTransferEscrowShard: PlannedValidator;
  referenceHolder: PlannedValidator;
  implementationRegistry: PlannedValidator | null;
  mintImplementationRegistry: PlannedValidator | null;
  sessionMint: PlannedValidator;
  recoverClient: PlannedValidator;
  verifyProof: PlannedValidator;
  mintPort: PlannedValidator;
  mintVoucher: PlannedValidator;
};
export const roleValidators = (plan: BasePlan): PlannedValidator[] => [
  plan.hostState,
  plan.spendClient,
  plan.spendConnection,
  plan.spendingChannel.base,
  plan.spendTransferModule,
];

/** Canonical ordered commitment to the exact retained script bytes and codec. */
export async function compatibilityDigest(plan: BasePlan): Promise<string> {
  const replaced = new Set(roleValidators(plan).map(({ hash }) => hash));
  const fixed = plan.validators.filter(({ hash }) => !replaced.has(hash))
    .map(({ title, hash, script }) => [title, hash, script.type, script.script])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          canonicalMigrationJson([
            MIGRATION_PROFILE,
            "proof-backed-v1",
            "ics20-classic-json-v1",
            fixed,
            plan.inputs,
            [
              plan.hostNft,
              plan.mintClient,
              plan.mintConnection,
              plan.mintChannel,
              plan.mintTransferEscrowShard,
              plan.referenceHolder,
              plan.implementationRegistry,
              plan.mintImplementationRegistry,
              plan.sessionMint,
              plan.recoverClient,
              plan.verifyProof,
              plan.mintPort,
              plan.mintVoucher,
              ...CHANNEL_OPERATION_NAMES.map((name) =>
                plan.spendingChannel.referredScripts[name]
              ),
            ],
          ]),
        ),
      ),
    ),
  );
}

export async function initialRegistry(plan: BasePlan): Promise<Registry> {
  if (
    !plan.inputs.migration || !plan.mintImplementationRegistry ||
    !plan.implementationRegistry
  ) {
    throw new Error(
      "Immutable deployment has no registry; redeployment requires a fresh upgrade-capable baseline",
    );
  }
  return {
    token: {
      policy_id: plan.mintImplementationRegistry.hash,
      name: REGISTRY_TOKEN_NAME,
    },
    host_policy: plan.hostNft.hash,
    identity: {
      client_policy: plan.mintClient.hash,
      connection_policy: plan.mintConnection.hash,
      channel_policy: plan.mintChannel.hash,
      escrow_policy: plan.mintTransferEscrowShard.hash,
      reference_holder: plutusAddress(plan.referenceHolder.address),
    },
    governance: plan.inputs.migration.governance,
    nonce: 0n,
    current: {
      generation: 1n,
      addresses: roleValidators(plan).map(({ address }) =>
        plutusAddress(address)
      ),
      compatibility: await compatibilityDigest(plan),
    },
    phase: "Ready",
  };
}

/** Successors retain the original applied policies; none are reconstructed. */
export async function loadSuccessorImplementation(
  lucid: LucidEvolution,
  baseline: BasePlan & { registry: Registry | null },
  generation: bigint,
  moduleToken: { policy_id: string; name: string },
  successorBlueprint?: SuccessorBlueprint,
): Promise<{ implementation: Implementation; validators: PlannedValidator[] }> {
  const registry = baseline.registry;
  if (!registry || generation <= registry.current.generation) {
    throw new Error(
      "Successor requires an upgrade-capable manifest and a strictly later generation",
    );
  }
  if (await compatibilityDigest(baseline) !== registry.current.compatibility) {
    throw new Error(
      "Retained dependency inventory does not match the authenticated compatibility digest",
    );
  }
  if (
    moduleToken.name !==
      await generateIdentifierTokenName(baseline.inputs.transferModuleNonce) ||
    !baseline.validators.some(({ title, hash }) =>
      title === "minting_identifier.minting_identifier.mint" &&
      hash === moduleToken.policy_id
    )
  ) {
    throw new Error(
      "Transfer module identity does not match the original deployment",
    );
  }
  for (const validator of baseline.validators) {
    if (
      validatorToScriptHash(validator.script) !== validator.hash ||
      validatorToAddress(
          lucid.config().network || "Custom",
          validator.script,
        ) !== validator.address
    ) {
      throw new Error(`Corrupt applied artifact: ${validator.title}`);
    }
  }
  const validators: PlannedValidator[] = [];
  const load = (title: string, params: unknown[], schema: unknown) => {
    const [script, hash, address] = readValidator(
      title,
      lucid,
      params as Data[],
      schema as Data[],
      successorBlueprint,
    );
    validators.push({ title, publication: "runtime", script, hash, address });
  };
  const base = [registry.token.policy_id, generation];
  load(
    "upgradeable/host_state.host_state.spend",
    base,
    Data.Tuple([Data.Bytes(), Data.Integer()]),
  );
  load(
    "upgradeable/client.client.spend",
    [...base, baseline.hostNft.hash, baseline.sessionMint.hash, {
      Script: [baseline.recoverClient.hash],
    }],
    Data.Tuple([
      Data.Bytes(),
      Data.Integer(),
      Data.Bytes(),
      Data.Bytes(),
      CredentialSchema,
    ]),
  );
  load(
    "upgradeable/connection.connection.spend",
    [
      ...base,
      baseline.hostNft.hash,
      baseline.mintClient.hash,
      baseline.verifyProof.hash,
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Integer(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]),
  );
  load(
    "upgradeable/channel.channel.spend",
    [
      ...base,
      baseline.hostNft.hash,
      CHANNEL_OPERATION_NAMES.map((name) =>
        baseline.spendingChannel.referredScripts[name].hash
      ),
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Integer(),
      Data.Bytes(),
      Data.Array(Data.Bytes()),
    ]),
  );
  load(
    "upgradeable/transfer.transfer.spend",
    [
      ...base,
      baseline.hostNft.hash,
      baseline.mintChannel.hash,
      baseline.mintTransferEscrowShard.hash,
      {
        policy_id: baseline.mintPort.hash,
        name: generatePortTokenName(fromText("transfer")),
      },
      moduleToken,
      baseline.mintVoucher.hash,
      baseline.recoverClient.hash,
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Integer(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
    ]),
  );
  return {
    implementation: {
      generation,
      addresses: validators.map(({ address }) => plutusAddress(address)),
      compatibility: registry.current.compatibility,
    },
    validators,
  };
}
