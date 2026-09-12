import {
  Constr,
  Data,
  getAddressDetails,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import { DeploymentIbcTree } from "./deployment.ts";
import type { DeploymentTemplate } from "./utils.ts";
import { fromText } from "@lucid-evolution/lucid";
import { HostStateDatum } from "../types/index.ts";

type StateKind =
  | "channel"
  | "connection"
  | "client"
  | "transfer"
  | "module"
  | "trace"
  | "metadata";
type Validator = {
  script: string;
  scriptHash: string;
  address: string;
  refUtxo?: UTxO;
};
export type ShutdownStateGroup = {
  kind: StateKind;
  validator: Validator;
  utxos: UTxO[];
};
const EMPTY_ROOT = "00".repeat(32);
const encode = (data: Data) =>
  Data.to(data as never, undefined as never, { canonical: true });
const record = (...fields: Data[]) => new Constr(0, fields);

export function datumFields(data: Data, length: number): Data[] {
  if (
    !(data instanceof Constr) || data.index !== 0 ||
    data.fields.length !== length
  ) {
    throw new Error(
      "Unexpected state datum, cleanup requires the deployed datum format",
    );
  }
  return data.fields;
}

export function escrowDatum(utxo: UTxO) {
  if (!utxo.datum) throw new Error("Escrow shard has no datum");
  const [channelId, denom, amount] = datumFields(Data.from(utxo.datum), 3);
  if (
    typeof channelId !== "string" || typeof denom !== "string" ||
    typeof amount !== "bigint" || amount < 0n
  ) {
    throw new Error("Escrow shard has no valid deposit balance");
  }
  return { channelId, denom, amount };
}

export async function scanDeploymentState(
  lucid: Pick<LucidEvolution, "utxosAt">,
  deployment: DeploymentTemplate,
): Promise<ShutdownStateGroup[]> {
  const definitions = [
    ["channel", deployment.validators.spendChannel],
    ["connection", deployment.validators.spendConnection],
    ["client", deployment.validators.spendClient],
    ["transfer", deployment.validators.spendTransferModule],
    ["module", deployment.validators.spendMockModule],
    ["trace", deployment.validators.spendTraceRegistry],
    ["metadata", deployment.validators.voucherMetadata],
  ] as const;
  const seen = new Set<string>();
  const groups: Array<{ kind: StateKind; validator: Validator }> = [];
  for (const [kind, validator] of definitions) {
    if (!validator?.address || seen.has(validator.address)) continue;
    if (
      !("script" in validator) || !validator.script ||
      !("scriptHash" in validator)
    ) {
      throw new Error(
        `Deployment does not include the ${kind} cleanup validator, deploy the updated contracts first`,
      );
    }
    seen.add(validator.address);
    groups.push({ kind, validator: validator as Validator });
  }
  for (const module of Object.values(deployment.modules ?? {})) {
    if (!seen.has(module.address)) {
      throw new Error(
        `No cleanup validator for module address ${module.address}`,
      );
    }
  }
  return await Promise.all(groups.map(async (group) => ({
    ...group,
    utxos: await lucid.utxosAt(group.validator.address),
  })));
}

export function assertStateDrained(
  groups: ShutdownStateGroup[],
  deployment: DeploymentTemplate,
) {
  const shardPolicy = deployment.validators.mintTransferEscrowShard?.scriptHash;
  for (const group of groups) {
    for (const utxo of group.utxos) {
      if (group.kind === "channel") {
        if (!utxo.datum) throw new Error("Channel has no datum");
        const [state] = datumFields(Data.from(utxo.datum), 3);
        const commitments = datumFields(state, 9)[4];
        if (!(commitments instanceof Map) || commitments.size !== 0) {
          throw new Error(
            `Channel ${utxo.txHash}#${utxo.outputIndex} still has unsettled packets`,
          );
        }
      }
      if (
        group.kind === "transfer" && shardPolicy &&
        Object.keys(utxo.assets).some((unit) => unit.startsWith(shardPolicy))
      ) {
        if (escrowDatum(utxo).amount !== 0n) {
          throw new Error(
            `Escrow ${utxo.txHash}#${utxo.outputIndex} still holds user deposits, withdraw or refund them before cleanup`,
          );
        }
      }
    }
  }
}

export function assertNoDeploymentState(groups: ShutdownStateGroup[]) {
  const remaining = groups.flatMap((group) =>
    group.utxos.map((utxo) =>
      `${group.kind} ${utxo.txHash}#${utxo.outputIndex}`
    )
  );
  if (remaining.length !== 0) {
    throw new Error(
      `Reclaim deployment state before removing its scripts or finalizing shutdown: ${
        remaining.join(", ")
      }`,
    );
  }
}

function addAssets(
  total: Record<string, bigint>,
  assets: Record<string, bigint>,
  sign = 1n,
) {
  for (const [unit, quantity] of Object.entries(assets)) {
    total[unit] = (total[unit] ?? 0n) + sign * quantity;
    if (total[unit] === 0n) delete total[unit];
  }
}

function decodeHost(hostUtxo: UTxO, walletAddress: string, validFrom: number) {
  if (!hostUtxo.datum) throw new Error("HostState has no datum");
  const datum = Data.from(hostUtxo.datum, HostStateDatum);
  const signer = getAddressDetails(walletAddress).paymentCredential;
  if (signer?.type !== "Key" || signer.hash !== datum.deployer) {
    throw new Error("Only the recorded deployer can reclaim deployment state");
  }
  if (
    datum.control.shutdown === "Active" ||
    BigInt(validFrom) < datum.control.shutdown.ShuttingDown.grace_period_end
  ) {
    throw new Error(
      "Deployment cleanup requires the shutdown grace period to have elapsed",
    );
  }
  return datum;
}

function stateBurns(
  group: ShutdownStateGroup,
  deployment: DeploymentTemplate,
  host: ReturnType<typeof decodeHost>,
) {
  const policies: Partial<Record<StateKind, string>> = {
    channel: deployment.validators.mintChannelStt.scriptHash,
    connection: deployment.validators.mintConnectionStt.scriptHash,
    client: deployment.validators.mintClientStt.scriptHash,
    trace: deployment.validators.mintIdentifier.scriptHash,
    metadata: deployment.validators.mintVoucher.scriptHash,
  };
  const registeredTokens = new Set(
    [...host.control.port_registry.values()].flatMap((registration) => [
      registration.port_token.policy_id + registration.port_token.name,
      registration.module_token.policy_id + registration.module_token.name,
    ]),
  );
  const burns: Record<string, bigint> = {};
  for (const utxo of group.utxos) {
    for (const [unit, quantity] of Object.entries(utxo.assets)) {
      if (
        unit !== "lovelace" &&
        (policies[group.kind]
          ? unit.startsWith(policies[group.kind]!)
          : registeredTokens.has(unit))
      ) {
        burns[unit] = (burns[unit] ?? 0n) - quantity;
      }
    }
  }
  return burns;
}

function applyBurns(
  tx: ReturnType<LucidEvolution["newTx"]>,
  burns: Record<string, bigint>,
  deployment: DeploymentTemplate,
  redeemers: Record<string, string> = {},
) {
  const byPolicy = new Map<string, Record<string, bigint>>();
  for (const [unit, amount] of Object.entries(burns)) {
    const policy = unit.slice(0, 56);
    const assets = byPolicy.get(policy) ?? {};
    assets[unit] = amount;
    byPolicy.set(policy, assets);
  }
  for (const [policy, assets] of byPolicy) {
    const validator = Object.values(deployment.validators).find((candidate) =>
      "scriptHash" in candidate && candidate.scriptHash === policy
    ) as Validator | undefined;
    if (!validator?.refUtxo) {
      throw new Error(`Missing minting reference for ${policy}`);
    }
    tx.readFrom([validator.refUtxo]).mintAssets(
      assets,
      redeemers[policy] ??
        (policy === deployment.validators.mintVoucher.scriptHash
          ? encode(new Constr(3, []))
          : Data.void()),
    );
  }
}

function transferWithdrawal(
  host: HostStateDatum,
  deployment: DeploymentTemplate,
): string {
  const registration = host.control.port_registry.get(fromText("transfer"));
  if (!registration) throw new Error("Missing transfer module registration");
  return encode(
    new Constr(2, [
      registration.port_token.policy_id + registration.port_token.name,
      registration.module_token.policy_id + registration.module_token.name,
      deployment.validators.mintTransferEscrowShard.scriptHash,
    ]),
  );
}

export function buildReclaimStateTx(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  hostUtxo: UTxO,
  group: ShutdownStateGroup,
  walletAddress: string,
  validFrom: number,
) {
  if (
    group.utxos.length === 0 ||
    group.utxos.some((utxo) => utxo.address !== group.validator.address)
  ) {
    throw new Error("Cleanup must consume state from one validator address");
  }
  if (group.kind === "client" && group.utxos.length !== 1) {
    throw new Error("Reclaim clients one at a time");
  }
  const host = decodeHost(hostUtxo, walletAddress, validFrom);
  assertStateDrained([group], deployment);
  if (group.kind === "transfer") {
    for (const utxo of group.utxos) {
      if (
        !utxo.datum || datumFields(Data.from(utxo.datum), 1)[0] !== EMPTY_ROOT
      ) {
        throw new Error(
          "Reclaim empty escrow shards before the transfer module root",
        );
      }
    }
  }
  const burns = stateBurns(group, deployment, host);
  const assets: Record<string, bigint> = {};
  for (const utxo of group.utxos) addAssets(assets, utxo.assets);
  addAssets(assets, burns);
  const index: Record<StateKind, number> = {
    channel: 10,
    connection: 2,
    client: 2,
    transfer: 2,
    module: 2,
    trace: 3,
    metadata: 0,
  };
  const tx = lucid.newTx().readFrom([hostUtxo]);
  if (group.validator.refUtxo) tx.readFrom([group.validator.refUtxo]);
  else {tx.attach.SpendingValidator({
      type: "PlutusV3",
      script: group.validator.script,
    });}
  tx.collectFrom(group.utxos, encode(new Constr(index[group.kind], [])));
  applyBurns(tx, burns, deployment);
  if (group.kind === "channel" || group.kind === "transfer") {
    const recovery = deployment.validators.recoverClient;
    if (!recovery) throw new Error("Missing shutdown withdrawal validator");
    tx.readFrom([recovery.refUtxo]).withdraw(
      recovery.address,
      0n,
      group.kind === "channel"
        ? encode(new Constr(1, []))
        : transferWithdrawal(host, deployment),
    );
  }
  return tx.pay.ToAddress(walletAddress, assets).addSignerKey(host.deployer)
    .validFrom(validFrom).validTo(validFrom + 10 * 60 * 1000);
}

export async function buildReclaimEscrowTx(
  lucid: LucidEvolution,
  deployment: DeploymentTemplate,
  hostUtxo: UTxO,
  group: ShutdownStateGroup,
  shard: UTxO,
  walletAddress: string,
  validFrom: number,
) {
  const host = decodeHost(hostUtxo, walletAddress, validFrom);
  assertStateDrained([group], deployment);
  const rootUnit = deployment.modules.transfer.identifier;
  const roots = group.utxos.filter((utxo) => utxo.assets[rootUnit] === 1n);
  if (roots.length !== 1) throw new Error("Expected one transfer module root");
  const root = roots[0];
  const shardPolicy = deployment.validators.mintTransferEscrowShard.scriptHash;
  const tree = new DeploymentIbcTree();
  const shardUnit = Object.keys(shard.assets).find((unit) =>
    unit.startsWith(shardPolicy)
  );
  if (!shardUnit || shard.assets[shardUnit] !== 1n) {
    throw new Error("Malformed escrow shard token");
  }
  for (const utxo of group.utxos) {
    const units = Object.keys(utxo.assets).filter((unit) =>
      unit.startsWith(shardPolicy)
    );
    if (units.length > 1) throw new Error("Malformed escrow shard holder");
    if (units.length === 1) {
      tree.set(`escrowShards/${units[0].slice(56)}`, "01");
    }
  }
  if (
    !root.datum ||
    datumFields(Data.from(root.datum), 1)[0] !== await tree.getRoot()
  ) {
    throw new Error(
      "Escrow shard inventory does not match the transfer module registry",
    );
  }
  const key = `escrowShards/${shardUnit.slice(56)}`;
  const siblings = await tree.getSiblings(key);
  tree.set(key, "");
  const { channelId, denom } = escrowDatum(shard);
  const redeemer = encode(new Constr(2, []));
  const mintRedeemer = encode(new Constr(1, [channelId, denom, siblings]));
  const burns = { [shardUnit]: -1n };
  const refund = { ...shard.assets };
  addAssets(refund, burns);
  if (!group.validator.refUtxo) {
    throw new Error("Missing transfer module reference");
  }
  const tx = lucid.newTx().readFrom([hostUtxo, group.validator.refUtxo])
    .collectFrom([root, shard], redeemer)
    .pay.ToContract(root.address, {
      kind: "inline",
      value: encode(record(await tree.getRoot())),
    }, root.assets);
  applyBurns(tx, burns, deployment, { [shardPolicy]: mintRedeemer });
  const recovery = deployment.validators.recoverClient;
  if (!recovery) throw new Error("Missing shutdown withdrawal validator");
  tx.readFrom([recovery.refUtxo]).withdraw(
    recovery.address,
    0n,
    transferWithdrawal(host, deployment),
  );
  return tx.pay.ToAddress(walletAddress, refund).addSignerKey(host.deployer)
    .validFrom(validFrom).validTo(validFrom + 10 * 60 * 1000);
}
