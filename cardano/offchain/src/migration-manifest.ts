import {
  fromText,
  type LucidEvolution,
  type UTxO,
  validatorToRewardAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import type { HostStateDatum } from "../types/plutus/HostState.ts";
import type { DeploymentPlan, PlannedValidator } from "./deployment-plan.ts";
import {
  canonicalMigrationJson,
  CHANNEL_OPERATION_NAMES,
} from "./migration-plan.ts";
import {
  type DeploymentTemplate,
  generateIdentifierTokenName,
} from "./utils.ts";
import {
  ICQ_MODULE_PORT,
  MOCK_MODULE_PORT,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";

/** Aliases must resolve to the committed inventory, even when an alias is not
 * itself used in the compatibility digest. Never trust a second copy of bytes.
 */
export async function assertBaselineAliases(plan: DeploymentPlan) {
  const byTitle = new Map(
    plan.validators.map((validator) => [validator.title, validator]),
  );
  if (byTitle.size !== plan.validators.length) {
    throw new Error("Duplicate baseline validator role");
  }
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const object = value as Record<string, unknown>;
    if (
      typeof object.title === "string" && "script" in object && "hash" in object
    ) {
      if (
        canonicalMigrationJson(byTitle.get(object.title)) !==
          canonicalMigrationJson(value)
      ) throw new Error(`Substituted baseline alias ${object.title}`);
      return;
    }
    for (const entry of Object.values(object)) visit(entry);
  }
  visit(plan);
  const expectedAliases: Record<string, string> = {
    sessionSpend:
      "spending_tendermint_update_session.spend_tendermint_update_session.spend",
    traceRegistry: "trace_registry.spend_trace_registry.spend",
    voucherMetadata: "voucher_metadata.voucher_metadata.spend",
    mintIdentifier: "minting_identifier.minting_identifier.mint",
    genericModule: "spending_mock_module.spend_mock_module.spend",
    mockToken: "minting_mock_token.mint_mock_token.mint",
    benchmarkVoucher:
      "minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint",
  };
  for (const [name, title] of Object.entries(expectedAliases)) {
    const alias = plan[name as keyof DeploymentPlan] as PlannedValidator | null;
    if (
      name === "benchmarkVoucher" && !plan.inputs.benchmarkVoucherEnabled &&
      alias === null
    ) continue;
    if (!alias || alias.title !== title) {
      throw new Error(`Substituted baseline alias ${name}`);
    }
  }
  if (
    plan.directoryAuthToken.policy_id !== plan.mintIdentifier.hash ||
    plan.directoryAuthToken.name !==
      await generateIdentifierTokenName(plan.inputs.traceDirectoryNonce)
  ) throw new Error("Substituted baseline directory identity");
}

/** Reject retained operational-field substitutions before exporting a manifest.
 * The registry commits to the applied inventory; the real HostState authenticates
 * application capabilities. Reference out-refs are checked on the canonical chain.
 * History discovery metadata is separately verified by the public-manifest exporter.
 */
export async function assertRetainedManifest(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  plan: DeploymentPlan,
  host: HostStateDatum,
) {
  const retained: Record<string, PlannedValidator | null> = {
    recoverClient: plan.recoverClient,
    spendTendermintUpdateSession: plan.sessionSpend,
    mintTendermintUpdateSession: plan.sessionMint,
    spendMockModule: plan.genericModule,
    mintIdentifier: plan.mintIdentifier,
    spendTraceRegistry: plan.traceRegistry,
    mintVoucher: plan.mintVoucher,
    mintTransferEscrowShard: plan.mintTransferEscrowShard,
    mintPort: plan.mintPort,
    voucherMetadata: plan.voucherMetadata,
    mintTraceRegistryBenchmarkVoucher: plan.benchmarkVoucher,
    verifyProof: plan.verifyProof,
    mintClientStt: plan.mintClient,
    mintConnectionStt: plan.mintConnection,
    mintChannelStt: plan.mintChannel,
  };
  const references: Array<{ name: string; hash: string; reference: UTxO }> = [];
  const check = (
    name: string,
    field: {
      script: string;
      scriptHash: string;
      address?: string;
      refUtxo: UTxO;
    } | undefined,
    expected: PlannedValidator | null,
  ) => {
    if (!expected && !field) return;
    if (
      !field || !expected || field.script !== expected.script.script ||
      field.scriptHash !== expected.hash ||
      (field.address !== undefined &&
        field.address !== (name === "recoverClient"
            ? validatorToRewardAddress(
              lucid.config().network || "Custom",
              expected.script,
            )
            : expected.title.endsWith(".mint")
            ? ""
            : expected.address)) ||
      !field.refUtxo
    ) throw new Error(`Substituted retained manifest field ${name}`);
    references.push({ name, hash: expected.hash, reference: field.refUtxo });
  };
  for (const [name, expected] of Object.entries(retained)) {
    check(
      name,
      deployment
        .validators[name as keyof typeof deployment.validators] as Parameters<
          typeof check
        >[1],
      expected,
    );
  }
  const operations = deployment.validators.spendChannel.refValidator;
  if (
    !operations ||
    Object.keys(operations).length !== CHANNEL_OPERATION_NAMES.length
  ) throw new Error("Incomplete retained channel operations");
  for (const name of CHANNEL_OPERATION_NAMES) {
    check(
      `channel.${name}`,
      operations[name],
      plan.spendingChannel.referredScripts[name],
    );
  }
  const known = new Set([
    ...Object.keys(retained),
    "hostStateStt",
    "spendClient",
    "spendConnection",
    "spendChannel",
    "spendTransferModule",
  ]);
  if (Object.keys(deployment.validators).some((name) => !known.has(name))) {
    throw new Error("Unsupported operational validator role");
  }
  if (
    deployment.consensusHistoryFormat !== "proof-backed-v1" ||
    deployment.ics20PacketCodec !== "ics20-classic-json-v1" ||
    deployment.hostStateNFT?.policyId !== plan.hostNft.hash ||
    deployment.hostStateNFT.name !== fromText("ibc_host_state") ||
    deployment.hostStateNFT.script !== plan.hostNft.script.script
  ) throw new Error("Substituted HostState identity or codec");
  if (
    canonicalMigrationJson(deployment.traceRegistry) !==
      canonicalMigrationJson({
        address: plan.traceRegistry.address,
        shardPolicyId: plan.mintIdentifier.hash,
        directory: {
          policyId: plan.directoryAuthToken.policy_id,
          name: plan.directoryAuthToken.name,
        },
      })
  ) throw new Error("Substituted trace registry identity");
  if (
    Object.keys(deployment.modules).sort().join(",") !== "icq,mock,transfer"
  ) throw new Error("Unsupported application inventory");
  for (const [name, module] of Object.entries(deployment.modules)) {
    const port = {
      icq: ICQ_MODULE_PORT,
      mock: MOCK_MODULE_PORT,
      transfer: TRANSFER_MODULE_PORT,
    }[name as "icq" | "mock" | "transfer"];
    const registration = host.control.port_registry.get(fromText(port));
    if (
      !registration ||
      module.identifier !==
        registration.module_token.policy_id + registration.module_token.name ||
      (name !== "transfer" && module.address !== plan.genericModule.address)
    ) throw new Error(`Substituted application capability ${name}`);
  }
  const live = await lucid.utxosByOutRef(
    references.map(({ reference }) => ({
      txHash: reference.txHash,
      outputIndex: reference.outputIndex,
    })),
  );
  for (const { name, hash, reference } of references) {
    const observed = live.find((utxo) =>
      utxo.txHash === reference.txHash &&
      utxo.outputIndex === reference.outputIndex
    );
    if (
      !observed || observed.address !== plan.referenceHolder.address ||
      !observed.scriptRef ||
      validatorToScriptHash(observed.scriptRef) !== hash ||
      !reference.scriptRef ||
      validatorToScriptHash(reference.scriptRef) !== hash ||
      reference.address !== observed.address
    ) throw new Error(`Missing or substituted retained reference ${name}`);
  }
}
