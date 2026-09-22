import {
  Data,
  fromText,
  type LucidEvolution,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  bech32Address,
  type RegistryRedeemer,
} from "../types/plutus/Migration.ts";
import { HostStateDatum } from "../types/plutus/HostState.ts";
import { TransferModuleDatum } from "../types/plutus/TransferModuleDatum.ts";
import { DeploymentIbcTree } from "./deployment.ts";
import {
  buildReferenceBatchTx,
  completeReferenceBatchTx,
} from "./deployment-transactions.ts";
import {
  buildMigrationTransaction,
  escrowShardName,
} from "./migration-transactions.ts";
import {
  inspectMigration,
  type MigrationArtifact,
  validateMigrationArtifact,
} from "./migration.ts";
import { canonicalMigrationJson, roleValidators } from "./migration-plan.ts";
import { requireHistoryBootstrap } from "../../../packages/cardano-ibc-tx-builder-runtime/src/historyBootstrap.ts";
import { escrowDatum } from "./shutdown.ts";
import { type DeploymentTemplate, generateTokenName } from "./utils.ts";
import { assertRetainedManifest } from "./migration-manifest.ts";
import type { MigrationSubmit } from "./migration-submission.ts";

export async function migrationArtifactDigest(
  artifact: MigrationArtifact,
): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalMigrationJson(artifact)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function migrationControl(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  action: RegistryRedeemer,
  timing: { validFrom: number; validTo: number },
  signers: string[] = [],
) {
  const { registry, utxo, baseline } = await inspectMigration(
    lucid,
    deployment,
  );
  const references = await lucid.utxosAt(
    bech32Address(
      lucid.config().network || "Custom",
      registry.identity.reference_holder,
    ),
  );
  const reference = references.find((entry) =>
    entry.scriptRef &&
    validatorToScriptHash(entry.scriptRef) ===
      baseline.implementationRegistry!.hash
  );
  if (!reference) {
    throw new Error(
      "Publish the original registry reference script before continuing",
    );
  }
  return buildMigrationTransaction(lucid, deployment.migration!.registryUnit, {
    registry: utxo,
    registryReference: reference,
    ...timing,
    signers,
  }, action);
}

/** Reuse canonical publications. Exact signed bytes are measured by the repository's
 * deployment builder. Deposits and fees come solely from the executor wallet.
 */
export async function publishMigration(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  artifact: MigrationArtifact,
  submit: MigrationSubmit,
  timing: () => Promise<{ validFrom: number; validTo: number }>,
  report: (entry: unknown) => void = console.log,
) {
  const { registry } = await inspectMigration(lucid, deployment);
  validateMigrationArtifact(lucid, registry, artifact);
  const holder = bech32Address(
    lucid.config().network || "Custom",
    registry.identity.reference_holder,
  );
  const wallet = await lucid.wallet().address();
  for (const validator of artifact.validators) {
    const existing = (await lucid.utxosAt(holder)).find((entry) =>
      entry.scriptRef &&
      validatorToScriptHash(entry.scriptRef) === validator.hash
    );
    if (existing) {
      report({
        role: validator.title,
        reference: `${existing.txHash}#${existing.outputIndex}`,
        present: true,
      });
      continue;
    }
    lucid.clearUTxOOverride();
    const scripts = [validator.script];
    const { totalOutputAssets } = await buildReferenceBatchTx(
      lucid,
      holder,
      scripts,
    ).config();
    const fundingAmount = totalOutputAssets.lovelace + 1_500_000n;
    const fundingHash = await submit({
      build: async (anchor) => {
        lucid.clearUTxOOverride();
        let tx = lucid.newTx().validTo((await timing()).validTo);
        if (anchor) tx = tx.collectFrom([anchor]);
        return await (await tx.pay.ToAddress(wallet, {
          lovelace: fundingAmount,
        }).complete()).sign.withWallet().complete();
      },
    }, `funding-${deployment.migration!.registryUnit}-${validator.hash}`);
    lucid.clearUTxOOverride();
    const dedicated = (await lucid.utxosAt(wallet)).find((entry) =>
      entry.txHash === fundingHash && entry.assets.lovelace === fundingAmount
    );
    if (!dedicated) {
      throw new Error(
        "Confirmed publication funding is not indexed; re-run publish after synchronization",
      );
    }
    let measured: { hash: string; bytes: number; fee: string } | undefined;
    const hash = await submit(
      {
        anchor: dedicated,
        build: async (anchor) => {
          if (!anchor) {
            throw new Error("Publication requires its original funding input");
          }
          lucid.clearUTxOOverride();
          const { signedTx } = await completeReferenceBatchTx(
            lucid,
            holder,
            scripts,
            anchor,
            (await timing()).validTo,
          );
          const bytes = signedTx.toCBOR().length / 2;
          if (
            bytes > (lucid.config().protocolParameters?.maxTxSize ?? 16_384)
          ) {
            throw new Error(
              `Successor ${validator.title} cannot be published within maxTxSize (${bytes} bytes)`,
            );
          }
          measured = {
            hash: signedTx.toHash(),
            bytes,
            fee: signedTx.toTransaction().body().fee().toString(),
          };
          return signedTx;
        },
      },
      `publication-${validator.hash}-${dedicated.txHash}-${dedicated.outputIndex}`,
    );
    report({
      role: validator.title,
      transaction: hash,
      ...(measured?.hash === hash ? measured : {}),
      deposit: totalOutputAssets.lovelace.toString(),
    });
  }
  lucid.clearUTxOOverride();
}

/** Construct a replacement operational manifest only after checking canonical
 * activation and every discoverable state NFT against the authenticated counts
 * and shard root. The old baseline and history bootstrap are retained verbatim.
 * This is a chain-tip observation, not a finality certificate.
 */
export async function verifyAndInstallMigration(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  artifact: MigrationArtifact,
) {
  const { registry, utxo, baseline } = await inspectMigration(
    lucid,
    deployment,
  );
  const approved = validateMigrationArtifact(lucid, registry, artifact);
  if (
    registry.phase !== "Ready" || registry.nonce < approved.nonce ||
    canonicalMigrationJson(registry.current) !==
      canonicalMigrationJson(approved.target)
  ) throw new Error("Approved migration is not canonically activated");
  const network = lucid.config().network || "Custom";
  requireHistoryBootstrap(
    deployment.history,
    network === "Mainnet"
      ? 764824073
      : network === "Preprod"
      ? 1
      : network === "Preview"
      ? 2
      : 42,
  );
  const addresses = registry.current.addresses.map((address) =>
    bech32Address(network, address)
  );
  const hostUnit = registry.host_policy + fromText("ibc_host_state");
  const hostUtxo = await lucid.utxoByUnit(hostUnit);
  if (
    hostUtxo.address !== addresses[0] || hostUtxo.assets[hostUnit] !== 1n ||
    !hostUtxo.datum
  ) throw new Error("Missing successor HostState");
  const host = Data.from(hostUtxo.datum, HostStateDatum);
  await assertRetainedManifest(lucid, deployment, baseline, host);
  const registration = host.control.port_registry.get(fromText("transfer"));
  if (
    host.nft_policy !== registry.host_policy ||
    host.control.shutdown !== "Active" ||
    registration?.module_script_hash !== artifact.validators[4].hash
  ) {
    throw new Error(
      "HostState does not authorize the current transfer implementation",
    );
  }
  const counts = [
    host.state.next_client_sequence,
    host.state.next_connection_sequence,
    host.state.next_channel_sequence,
  ];
  const policies = [
    registry.identity.client_policy,
    registry.identity.connection_policy,
    registry.identity.channel_policy,
  ];
  const prefixes = ["ibc_client", "connection", "channel"];
  for (let role = 0; role < counts.length; role++) {
    for (let cursor = 0n; cursor < counts[role]; cursor++) {
      const name = await generateTokenName(
        { policy_id: registry.host_policy, name: fromText("ibc_host_state") },
        fromText(prefixes[role]),
        cursor,
      );
      const unit = policies[role] + name;
      const object = await lucid.utxoByUnit(unit);
      if (
        object.address !== addresses[role + 1] || object.assets[unit] !== 1n ||
        !object.datum
      ) {
        throw new Error(`Missing canonical ${prefixes[role]} ${cursor}`);
      }
    }
  }
  const moduleUnit = registration.module_token.policy_id +
    registration.module_token.name;
  const root = await lucid.utxoByUnit(moduleUnit);
  if (
    root.address !== addresses[4] || root.assets[moduleUnit] !== 1n ||
    root.assets[
        registration.port_token.policy_id + registration.port_token.name
      ] !== 1n ||
    !root.datum
  ) throw new Error("Missing migrated transfer capabilities");
  const tree = new DeploymentIbcTree();
  let shards = 0;
  for (const candidate of await lucid.utxosAt(addresses[4])) {
    const units = Object.keys(candidate.assets).filter((unit) =>
      unit.startsWith(registry.identity.escrow_policy)
    );
    if (!units.length) continue;
    const escrow = escrowDatum(candidate);
    const name = escrowShardName(escrow.channelId, escrow.denom);
    if (
      units.length !== 1 ||
      units[0] !== registry.identity.escrow_policy + name ||
      candidate.assets[units[0]] !== 1n
    ) throw new Error("Invalid canonical escrow shard");
    tree.set(`escrowShards/${name}`, "01");
    shards++;
  }
  if (
    await tree.getRoot() !==
      Data.from(root.datum, TransferModuleDatum).escrow_shard_registry_root
  ) throw new Error("Indexed successor escrow inventory is incomplete");
  const next = structuredClone(deployment);
  const references = await lucid.utxosAt(
    bech32Address(network, registry.identity.reference_holder),
  );
  const names = [
    "hostStateStt",
    "spendClient",
    "spendConnection",
    "spendChannel",
    "spendTransferModule",
  ] as const;
  for (let role = 0; role < names.length; role++) {
    const validator = artifact.validators[role];
    const reference = references.find((entry) =>
      entry.scriptRef &&
      validatorToScriptHash(entry.scriptRef) === validator.hash
    );
    if (!reference) {
      throw new Error(`Missing successor reference ${validator.title}`);
    }
    next.validators[names[role]] = {
      ...next.validators[names[role]],
      title: validator.title,
      script: validator.script.script,
      scriptHash: validator.hash,
      address: addresses[role],
      refUtxo: reference,
    };
  }
  next.modules.transfer.address = addresses[4];
  // The mint and proof policies are retained, but the client spends at the successor.
  next.clientRegistrations = [{
    clientType: "07-tendermint",
    implementation: "tendermint",
    mintPolicy: registry.identity.client_policy,
    spendValidator: next.validators.spendClient.scriptHash,
    proofPolicy: baseline.verifyProof.hash,
  }];
  next.migration!.generation = registry.current.generation.toString();
  next.migration!.compatibility = registry.current.compatibility;
  next.migration!.originalAddresses = roleValidators(baseline).map((
    { address },
  ) => address);
  // A later rotation may have consumed the activation output. This reference is
  // deliberately named an observation, not represented as the activation tx.
  next.migration!.lineage = [
    ...next.migration!.lineage.filter((entry) =>
      entry.generation !== registry.current.generation.toString()
    ),
    {
      generation: registry.current.generation.toString(),
      observedRegistry: { txHash: utxo.txHash, outputIndex: utxo.outputIndex },
      addresses,
    },
  ];
  // Detect rollback/concurrent control activity during the potentially long scan.
  const latest = await lucid.utxoByUnit(deployment.migration!.registryUnit);
  const latestHost = await lucid.utxoByUnit(hostUnit);
  if (
    latest.txHash !== utxo.txHash || latest.outputIndex !== utxo.outputIndex ||
    latestHost.txHash !== hostUtxo.txHash ||
    latestHost.outputIndex !== hostUtxo.outputIndex
  ) {
    throw new Error(
      "Canonical state changed during verification; retry from a fresh snapshot",
    );
  }
  return {
    deployment: next,
    evidence: {
      registry: `${utxo.txHash}#${utxo.outputIndex}`,
      host: `${hostUtxo.txHash}#${hostUtxo.outputIndex}`,
      generation: registry.current.generation.toString(),
      counts: counts.map(String),
      shards,
      suppliedArtifactSha256: await migrationArtifactDigest(artifact),
      attestation:
        "installed implementation and retained identities; historical approval transaction is not attested",
      historyCoverage:
        "not verified here; public manifest export and Gateway startup must verify retained canonical history",
    },
  };
}
