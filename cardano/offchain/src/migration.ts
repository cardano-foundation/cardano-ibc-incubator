import {
  Data,
  fromText,
  type LucidEvolution,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  bech32Address,
  Proposal,
  Registry,
  type RegistryRedeemer,
} from "../types/plutus/Migration.ts";
import { HostStateDatum } from "../types/plutus/HostState.ts";
import { TransferModuleDatum } from "../types/plutus/TransferModuleDatum.ts";
import { MigrationInventory } from "./migration-inventory.ts";
import type { DeploymentPlan, PlannedValidator } from "./deployment-plan.ts";
import {
  canonicalMigrationJson,
  compatibilityDigest,
  loadSuccessorImplementation,
  MIGRATION_PROFILE,
  type SuccessorBlueprint,
} from "./migration-plan.ts";
import {
  buildMigrationTransaction,
  type MigrationInputs,
  readRegistry,
} from "./migration-transactions.ts";
import { type DeploymentTemplate, generateTokenName } from "./utils.ts";
import { assertBaselineAliases } from "./migration-manifest.ts";

export type MigrationArtifact = {
  format: "cardano-ibc-migration-v1";
  registryUnit: string;
  proposal: string;
  validators: PlannedValidator[];
  // Preparation provenance only: authenticated continuations need not retain these outrefs.
  preparedHost: { txHash: string; outputIndex: number };
  preparedTransferRoot: { txHash: string; outputIndex: number };
};
const HOST_NAME = fromText("ibc_host_state");
const EMPTY_ROOT = "00".repeat(32);
const outref = ({ txHash, outputIndex }: UTxO) => ({ txHash, outputIndex });
const unitOf = ({ policy_id, name }: { policy_id: string; name: string }) =>
  policy_id + name;

export async function loadMigrationBaseline(
  deployment: DeploymentTemplate,
): Promise<DeploymentPlan> {
  const manifest = deployment.migration;
  if (!manifest || manifest.profile !== MIGRATION_PROFILE) {
    throw new Error(
      "This immutable deployment has no authenticated handover mechanism; a new bridge is not a migration",
    );
  }
  const baseline = structuredClone(manifest.baseline) as DeploymentPlan;
  if (
    !baseline?.inputs?.migration || !baseline.implementationRegistry ||
    !baseline.mintImplementationRegistry
  ) throw new Error("Missing original applied deployment artifacts");
  for (
    const nonce of [
      baseline.inputs.hostStateNonce,
      baseline.inputs.transferModuleNonce,
      baseline.inputs.traceDirectoryNonce,
      baseline.inputs.migration.registryNonce,
    ]
  ) nonce.output_index = BigInt(nonce.output_index);
  const governance = baseline.inputs.migration.governance;
  governance.quorum = BigInt(governance.quorum);
  governance.delay_ms = BigInt(governance.delay_ms);
  baseline.inputs.migration.emergency.quorum = BigInt(
    baseline.inputs.migration.emergency.quorum,
  );
  baseline.registry = Data.from(manifest.registryDatum, Registry);
  if (
    unitOf(baseline.registry.token) !== manifest.registryUnit ||
    baseline.mintImplementationRegistry.hash !==
      baseline.registry.token.policy_id ||
    baseline.implementationRegistry.address !== manifest.registryAddress
  ) throw new Error("Baseline registry identity mismatch");
  const digest = await compatibilityDigest(baseline);
  if (digest !== baseline.registry.current.compatibility) {
    throw new Error(
      `Baseline compatibility commitment mismatch: computed ${digest}, authenticated ${baseline.registry.current.compatibility}`,
    );
  }
  for (const artifact of baseline.validators) {
    if (validatorToScriptHash(artifact.script) !== artifact.hash) {
      throw new Error(`Corrupt retained script ${artifact.title}`);
    }
  }
  await assertBaselineAliases(baseline);
  return baseline;
}

/** A fresh NFT lookup, never a local 'last completed step' checkpoint. */
export async function inspectMigration(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
) {
  const baseline = await loadMigrationBaseline(deployment);
  const manifest = deployment.migration!;
  const utxo = await lucid.utxoByUnit(manifest.registryUnit);
  const registry = readRegistry(utxo, manifest.registryUnit);
  if (
    utxo.address !== manifest.registryAddress ||
    registry.host_policy !== baseline.hostNft.hash ||
    registry.current.compatibility !==
      baseline.registry!.current.compatibility ||
    canonicalMigrationJson(registry.identity) !==
      canonicalMigrationJson(baseline.registry!.identity)
  ) {
    throw new Error(
      "Canonical registry does not authenticate the supplied deployment",
    );
  }
  return { utxo, registry, baseline };
}

async function referenceFor(
  lucid: LucidEvolution,
  references: UTxO[],
  hash: string,
): Promise<UTxO> {
  const candidates = references.filter((utxo) =>
    utxo.scriptRef && validatorToScriptHash(utxo.scriptRef) === hash
  );
  for (const candidate of candidates) {
    const [live] = await lucid.utxosByOutRef([outref(candidate)]);
    if (live?.scriptRef && validatorToScriptHash(live.scriptRef) === hash) {
      return live;
    }
  }
  throw new Error(
    `Missing canonical reference script ${hash}; publish the approved applied artifact before continuing`,
  );
}

export async function prepareMigration(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  successorBlueprint?: SuccessorBlueprint,
): Promise<MigrationArtifact> {
  const { registry, baseline } = await inspectMigration(lucid, deployment);
  if (registry.phase !== "Ready") {
    throw new Error(
      "Cancel or complete the current transition before preparing another",
    );
  }
  const hostUtxo = await lucid.utxoByUnit(registry.host_policy + HOST_NAME);
  const host = Data.from(hostUtxo.datum!, HostStateDatum);
  const registration = host.control.port_registry.get(fromText("transfer"));
  if (!registration || host.control.shutdown !== "Active") {
    throw new Error("Active authenticated transfer port is required");
  }
  const root = await lucid.utxoByUnit(unitOf(registration.module_token));
  const successor = await loadSuccessorImplementation(
    lucid,
    { ...baseline, registry },
    registry.current.generation + 1n,
    registration.module_token,
    successorBlueprint,
  );
  const proposal: Proposal = {
    Replace: {
      source_generation: registry.current.generation,
      nonce: registry.nonce + 1n,
      target: successor.implementation,
      maximum: {
        clients: host.state.next_client_sequence,
        connections: host.state.next_connection_sequence,
        channels: host.state.next_channel_sequence,
      },
      escrow_inventory:
        Data.from(root.datum!, TransferModuleDatum).escrow_shard_registry_root,
    },
  };
  return {
    format: "cardano-ibc-migration-v1",
    registryUnit: unitOf(registry.token),
    proposal: Data.to(proposal, Proposal),
    validators: successor.validators,
    preparedHost: outref(hostUtxo),
    preparedTransferRoot: outref(root),
  };
}

export function validateMigrationArtifact(
  lucid: LucidEvolution,
  registry: Registry,
  artifact: MigrationArtifact,
) {
  if (
    artifact.format !== "cardano-ibc-migration-v1" ||
    artifact.registryUnit !== unitOf(registry.token)
  ) {
    throw new Error(
      "Migration plan belongs to another deployment or unsupported format",
    );
  }
  const proposal = Data.from(artifact.proposal, Proposal);
  if (
    !("Replace" in proposal) ||
    proposal.Replace.target.compatibility !== registry.current.compatibility ||
    artifact.validators.length !== 5
  ) throw new Error("Unsupported migration compatibility profile");
  const target = proposal.Replace.target;
  if (
    proposal.Replace.source_generation < 1n ||
    target.generation !== proposal.Replace.source_generation + 1n ||
    proposal.Replace.nonce < 1n || target.addresses.length !== 5
  ) throw new Error("Invalid migration generation, nonce, or role count");
  for (let role = 0; role < 5; role++) {
    const artifactRole = artifact.validators[role];
    const credential = target.addresses[role]?.payment_credential;
    if (
      !credential || !("Script" in credential) ||
      validatorToScriptHash(artifactRole.script) !== credential.Script[0] ||
      artifactRole.hash !== credential.Script[0] ||
      artifactRole.address !==
        bech32Address(
          lucid.config().network || "Custom",
          target.addresses[role],
        )
    ) throw new Error(`Substituted successor artifact for role ${role}`);
  }
  return proposal.Replace;
}

export async function authorizeMigration(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  artifact: MigrationArtifact,
  timing: { validFrom: number; validTo: number; expiresAt: bigint },
  signers: string[],
) {
  const observed = await inspectMigration(lucid, deployment);
  const approved = validateMigrationArtifact(
    lucid,
    observed.registry,
    artifact,
  );
  // The registry nonce changes on every proposal, including authority rotation
  // and cancellation. Together with the source generation it binds the reviewed
  // authority/implementation epoch without pinning frequently consumed objects.
  if (
    observed.registry.phase !== "Ready" ||
    approved.nonce !== observed.registry.nonce + 1n ||
    approved.source_generation !== observed.registry.current.generation
  ) {
    throw new Error(
      "Reviewed authority or source generation is stale; prepare and review a fresh plan",
    );
  }
  const host = await lucid.utxoByUnit(
    observed.registry.host_policy + HOST_NAME,
  );
  if (
    host.assets[observed.registry.host_policy + HOST_NAME] !== 1n || !host.datum
  ) {
    throw new Error("Missing authenticated HostState");
  }
  const state = Data.from(host.datum, HostStateDatum);
  const registration = state.control.port_registry.get(fromText("transfer"));
  const transferCredential =
    observed.registry.current.addresses[4].payment_credential;
  if (
    !registration || state.control.shutdown !== "Active" ||
    state.nft_policy !== observed.registry.host_policy ||
    !("Script" in transferCredential) ||
    registration.module_script_hash !== transferCredential.Script[0]
  ) {
    throw new Error("Incompatible authenticated transfer registration");
  }
  const root = await lucid.utxoByUnit(unitOf(registration.module_token));
  const references = await lucid.utxosAt(
    bech32Address(
      lucid.config().network || "Custom",
      observed.registry.identity.reference_holder,
    ),
  );
  return buildMigrationTransaction(lucid, deployment.migration!.registryUnit, {
    registry: observed.utxo,
    registryReference: await referenceFor(
      lucid,
      references,
      observed.baseline.implementationRegistry!.hash,
    ),
    preparationHost: host,
    transferRoot: root,
    validFrom: timing.validFrom,
    validTo: timing.validTo,
    signers,
  }, {
    Propose: {
      proposal: Data.from(artifact.proposal, Proposal),
      expires_at: timing.expiresAt,
    },
  });
}

/** Return the next permissionless step. The caller submits, confirms, and re-reads. */
export async function nextMigrationStep(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  artifact: MigrationArtifact,
  timing: { validFrom: number; validTo: number },
  hostWitness?: string[],
  inventory = new MigrationInventory(),
) {
  const observed = await inspectMigration(lucid, deployment);
  const { registry, baseline } = observed;
  const approved = validateMigrationArtifact(lucid, registry, artifact);
  if (registry.phase === "Ready") {
    if (
      registry.nonce >= approved.nonce &&
      canonicalMigrationJson(registry.current) ===
        canonicalMigrationJson(approved.target)
    ) return { complete: true as const, registry };
    throw new Error(
      "No approved migration is executing; authorize the exact plan first",
    );
  }
  if (
    registry.nonce !== approved.nonce ||
    registry.current.generation !== approved.source_generation
  ) throw new Error("Plan is stale or has been replayed");
  const network = lucid.config().network || "Custom";
  const references = await lucid.utxosAt(
    bech32Address(network, registry.identity.reference_holder),
  );
  const inputs: MigrationInputs = {
    ...timing,
    registry: observed.utxo,
    registryReference: await referenceFor(
      lucid,
      references,
      baseline.implementationRegistry!.hash,
    ),
  };
  let action: RegistryRedeemer;
  const withObject = async (unit: string, role: number, target = false) => {
    inputs.object = await lucid.utxoByUnit(unit);
    const implementation = target ? approved.target : registry.current;
    const credential = implementation.addresses[role].payment_credential;
    if (!("Script" in credential)) {
      throw new Error("Unsupported payment credential");
    }
    inputs.objectReference = await referenceFor(
      lucid,
      references,
      credential.Script[0],
    );
  };
  if ("Proposed" in registry.phase) {
    if (
      Data.to(registry.phase.Proposed.proposal, Proposal) !== artifact.proposal
    ) throw new Error("On-chain approval binds a different plan");
    await withObject(registry.host_policy + HOST_NAME, 0);
    const host = Data.from(inputs.object!.datum!, HostStateDatum);
    const registration = host.control.port_registry.get(fromText("transfer"));
    if (!registration) {
      throw new Error("Missing authenticated transfer registration");
    }
    inputs.transferRoot = await lucid.utxoByUnit(
      unitOf(registration.module_token),
    );
    inputs.successorReferences = await Promise.all(
      artifact.validators.map(({ hash }) =>
        referenceFor(lucid, references, hash)
      ),
    );
    action = "Begin";
  } else {
    const phase = registry.phase.Moving;
    if (
      canonicalMigrationJson(phase.target) !==
        canonicalMigrationJson(approved.target)
    ) {
      throw new Error(
        "Canonical migration target differs from supplied artifacts",
      );
    }
    const roles = [["clients", registry.identity.client_policy, "ibc_client"], [
      "connections",
      registry.identity.connection_policy,
      "connection",
    ], ["channels", registry.identity.channel_policy, "channel"]] as const;
    const role = roles.findIndex(([key]) =>
      phase.next[key] < phase.limits[key]
    );
    if (role >= 0) {
      const [key, policy, prefix] = roles[role];
      const name = await generateTokenName(
        { policy_id: registry.host_policy, name: HOST_NAME },
        fromText(prefix),
        phase.next[key],
      );
      await withObject(policy + name, role + 1);
      action = { MoveCore: { role: BigInt(role + 1) } };
    } else if (!phase.module_moved) {
      await withObject(unitOf(phase.registration.module_token), 4);
      action = "MoveTransferRoot";
    } else if (phase.escrow_remaining !== EMPTY_ROOT) {
      const sourceAddress = bech32Address(
        network,
        registry.current.addresses[4],
      );
      const { name, siblings } = await inventory.witness(
        `${artifact.registryUnit}/${registry.nonce}/${sourceAddress}`,
        registry.identity.escrow_policy,
        phase.escrow_remaining,
        () => lucid.utxosAt(sourceAddress),
      );
      await withObject(registry.identity.escrow_policy + name, 4);
      action = { MoveEscrow: { siblings } };
    } else {
      if (!hostWitness) {
        throw new Error(
          "Activation requires the authenticated historical-tree witness for ports/transfer; rebuild the tree against canonical HostState",
        );
      }
      await withObject(registry.host_policy + HOST_NAME, 0, true);
      action = { Activate: { port_siblings: hostWitness } };
    }
  }
  const built = await buildMigrationTransaction(
    lucid,
    deployment.migration!.registryUnit,
    inputs,
    action,
  );
  return { complete: false as const, action, ...built };
}
