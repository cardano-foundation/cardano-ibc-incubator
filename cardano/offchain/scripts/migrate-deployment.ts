import { MigrationInventory } from "../src/migration-inventory.ts";
import { type TxBuilder } from "@lucid-evolution/lucid";
import { buildOperationalLucid } from "./shutdown-deployment.ts";
import {
  authorizeMigration,
  inspectMigration,
  type MigrationArtifact,
  nextMigrationStep,
  prepareMigration,
} from "../src/migration.ts";
import {
  migrationArtifactDigest,
  migrationControl,
  publishMigration,
  verifyAndInstallMigration,
} from "../src/migration-operations.ts";
import {
  canonicalMigrationJson,
  type SuccessorBlueprint,
} from "../src/migration-plan.ts";
import { assertGovernance } from "../types/plutus/Migration.ts";
import type { DeploymentTemplate } from "../src/utils.ts";
import { migrationSubmitter } from "../src/migration-submission.ts";
import { migrationTiming } from "../src/migration-timing.ts";

const commands = [
  "restrict",
  "propose-restoration",
  "restore",
  "cancel-restoration",
  "prepare",
  "inspect",
  "publish",
  "authorize",
  "cancel",
  "rotate",
  "activate-authority",
  "execute",
  "resume",
  "verify",
];
export function parseMigrationArgs(args: string[]) {
  const [command, ...rest] = args;
  if (!commands.includes(command)) {
    throw new Error(`Command must be one of: ${commands.join(", ")}`);
  }
  const flags: Record<string, string> = {};
  const allowed = new Set([
    "mask",
    "emergency-authority",
    "handler",
    "plan",
    "blueprint",
    "out",
    "outbox",
    "port-witness",
    "governance",
    "signers",
    "wallet-address",
    "expires-at",
    "max-steps",
    "submit",
  ]);
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].slice(2);
    if (!rest[index].startsWith("--") || !allowed.has(key) || key in flags) {
      throw new Error(`Unknown or duplicate option ${rest[index]}`);
    }
    if (key === "submit") flags[key] = "true";
    else {
      const value = rest[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      flags[key] = value;
    }
  }
  if (!flags.handler) {
    throw new Error(
      "--handler must identify the original deployment manifest (including its migration baseline)",
    );
  }
  if (["prepare", "verify"].includes(command) && !flags.out) {
    throw new Error(
      `${command} requires --out; the original manifest is never overwritten implicitly`,
    );
  }
  if (command === "prepare" && !flags.blueprint) {
    throw new Error(
      "prepare requires --blueprint pointing to the reviewed compiled successor contracts",
    );
  }
  if (
    ["publish", "authorize", "execute", "resume", "verify"].includes(command) &&
    !flags.plan
  ) {
    throw new Error(
      `${command} requires the backed-up approved --plan artifact`,
    );
  }
  if (command === "publish" && !flags.submit) {
    throw new Error(
      "publish spends executor funds on reference deposits; pass --submit to perform publication",
    );
  }
  if (
    [
      "authorize",
      "cancel",
      "rotate",
      "activate-authority",
      "execute",
      "resume",
      "restrict",
      "propose-restoration",
      "restore",
      "cancel-restoration",
    ]
      .includes(command) && !flags.submit && !flags.out
  ) {
    throw new Error(
      "Use --out to export an unsigned transaction, or --submit with an explicitly configured executor wallet",
    );
  }
  const maxSteps = Number(flags["max-steps"] ?? "1");
  if (
    !Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000 ||
    (!flags.submit && maxSteps !== 1)
  ) {
    throw new Error(
      "--max-steps must be 1–1000 (unsigned export builds one canonical step)",
    );
  }
  return { command, flags, maxSteps };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}
async function writeJson(path: string, value: unknown) {
  // createNew protects the reviewed plan and baseline from accidental replacement.
  await Deno.writeTextFile(path, canonicalMigrationJson(value) + "\n", {
    createNew: true,
  });
}

export async function main(args = Deno.args) {
  const { command, flags, maxSteps } = parseMigrationArgs(args);
  const deployment = await readJson<DeploymentTemplate>(flags.handler);
  const readOnly = ["prepare", "inspect", "verify"].includes(command);
  const lucid = await buildOperationalLucid({
    keyEnvironment: "MIGRATION_EXECUTOR_SK",
    walletAddress: flags["wallet-address"],
    readOnly,
  });
  const observed = await inspectMigration(lucid, deployment);
  const signers = flags.signers ? flags.signers.split(",") : [];
  if (
    signers.some((key) => !/^[0-9a-f]{56}$/.test(key)) ||
    new Set(signers).size !== signers.length
  ) throw new Error("--signers requires distinct 28-byte payment key hashes");
  const timing = () => migrationTiming(lucid, Deno.env.get("OGMIOS_URL")!);
  const submit = migrationSubmitter(
    lucid,
    flags.outbox ?? `${flags.plan ?? flags.handler}.migration-outbox`,
    (entry) => console.log(canonicalMigrationJson(entry)),
    3,
    async () => BigInt((await timing()).slot),
  );
  const expiration = () => {
    const value = flags["expires-at"];
    if (!value || !/^[0-9]+$/.test(value)) {
      throw new Error(
        "Approval requires an explicit --expires-at POSIX timestamp in milliseconds",
      );
    }
    return BigInt(value);
  };
  const emit = async (tx: TxBuilder, label: string) => {
    const completed = await tx.complete({ localUPLCEval: false });
    if (!flags.submit) {
      await writeJson(flags.out, {
        format: "cardano-ibc-migration-unsigned-v1",
        action: label,
        cbor: completed.toCBOR(),
        requiredSigners: signers,
        registry: `${observed.utxo.txHash}#${observed.utxo.outputIndex}`,
        note:
          "Sign this exact body with the required quorum and executor; stale inputs require rebuilding and re-signing.",
      });
      return;
    }
    const signed = await completed.sign.withWallet().complete();
    const bytes = signed.toCBOR().length / 2;
    if (bytes > (lucid.config().protocolParameters?.maxTxSize ?? 16_384)) {
      throw new Error(`Transaction exceeds maxTxSize: ${bytes} bytes`);
    }
    const hash = await submit(signed, `${label}-${signed.toHash()}`);
    console.log(
      canonicalMigrationJson({
        action: label,
        transaction: hash,
        bytes,
        fee: signed.toTransaction().body().fee(),
      }),
    );
    lucid.overrideUTxOs([]);
  };
  if (command === "inspect") {
    console.log(canonicalMigrationJson({
      registry: observed.registry,
      outref: {
        txHash: observed.utxo.txHash,
        outputIndex: observed.utxo.outputIndex,
      },
      finality: "canonical provider observation; no finality assertion",
    }));
    return;
  }
  if (command === "prepare") {
    const artifact = await prepareMigration(
      lucid,
      deployment,
      await readJson<SuccessorBlueprint>(flags.blueprint),
    );
    await writeJson(flags.out, artifact);
    console.log(canonicalMigrationJson({
      path: flags.out,
      sha256: await migrationArtifactDigest(artifact),
      instruction:
        "Review all five applied scripts, complete addresses and the compatibility boundary; back up this artifact before approval.",
    }));
    return;
  }
  if (
    ["restrict", "propose-restoration", "restore", "cancel-restoration"]
      .includes(command)
  ) {
    const maskText = flags.mask;
    if (
      ["restrict", "propose-restoration"].includes(command) &&
      (!maskText || !/^[0-9]+$/.test(maskText) || BigInt(maskText) > 15n)
    ) {
      throw new Error(
        "--mask must be 0–15: traffic/topology=1, clients=2, heartbeat=4, handover=8",
      );
    }
    const input = flags["emergency-authority"]
      ? await readJson<{ signers: string[]; quorum: string }>(
        flags["emergency-authority"],
      )
      : observed.registry.emergency.authority;
    const authority = { signers: input.signers, quorum: BigInt(input.quorum) };
    const action = command === "restrict"
      ? { Restrict: { mask: BigInt(maskText) } }
      : command === "propose-restoration"
      ? {
        ProposeRestoration: {
          mask: BigInt(maskText),
          authority,
          expires_at: expiration(),
        },
      }
      : command === "restore"
      ? "Restore" as const
      : "CancelRestoration" as const;
    await emit(
      (await migrationControl(
        lucid,
        deployment,
        action,
        await timing(),
        signers,
      )).tx,
      command,
    );
    return;
  }
  if (command === "cancel" || command === "activate-authority") {
    await emit(
      (await migrationControl(
        lucid,
        deployment,
        command === "cancel" ? "Cancel" : "RotateAuthority",
        await timing(),
        signers,
      )).tx,
      command,
    );
    return;
  }
  if (command === "rotate") {
    if (!flags.governance) {
      throw new Error(
        "rotate requires --governance JSON with explicit signers, quorum and delay_ms",
      );
    }
    const input = await readJson<
      { signers: string[]; quorum: string; delay_ms: string }
    >(flags.governance);
    const governance = {
      ...input,
      quorum: BigInt(input.quorum),
      delay_ms: BigInt(input.delay_ms),
    };
    assertGovernance(governance);
    await emit(
      (await migrationControl(
        lucid,
        deployment,
        {
          Propose: {
            proposal: {
              Rotate: { nonce: observed.registry.nonce + 1n, governance },
            },
            expires_at: expiration(),
          },
        },
        await timing(),
        signers,
      )).tx,
      command,
    );
    return;
  }
  const artifact = await readJson<MigrationArtifact>(flags.plan);
  console.log(
    canonicalMigrationJson({
      planSha256: await migrationArtifactDigest(artifact),
    }),
  );
  if (command === "publish") {
    await publishMigration(
      lucid,
      deployment,
      artifact,
      submit,
      timing,
      (entry) => console.log(canonicalMigrationJson(entry)),
    );
    return;
  }
  if (command === "authorize") {
    await emit(
      (await authorizeMigration(lucid, deployment, artifact, {
        ...await timing(),
        expiresAt: expiration(),
      }, signers)).tx,
      command,
    );
    return;
  }
  if (command === "verify") {
    const verified = await verifyAndInstallMigration(
      lucid,
      deployment,
      artifact,
    );
    await writeJson(flags.out, verified.deployment);
    console.log(canonicalMigrationJson(verified.evidence));
    return;
  }
  const witness = flags["port-witness"]
    ? await readJson<{ siblings: string[] }>(flags["port-witness"])
    : undefined;
  const inventory = new MigrationInventory();
  for (let index = 0; index < maxSteps; index++) {
    const step = await nextMigrationStep(
      lucid,
      deployment,
      artifact,
      await timing(),
      witness?.siblings,
      inventory,
    );
    if (step.complete) {
      console.log(
        "Migration is canonically activated; run verify to export its operational manifest.",
      );
      return;
    }
    await emit(
      step.tx,
      typeof step.action === "string"
        ? step.action
        : Object.keys(step.action)[0],
    );
  }
  console.log(
    "Step limit reached; inspect or resume from canonical state. No local progress checkpoint is authoritative.",
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `migration failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    Deno.exit(1);
  });
}
