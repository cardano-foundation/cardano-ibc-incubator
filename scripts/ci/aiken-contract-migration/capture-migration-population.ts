/** Read-only rehearsal evidence. Authenticated counts/root bound state discovery;
 * observations are not a finality certificate or permission to omit liabilities. */
import {
  Data,
  fromText,
  getAddressDetails,
  type UTxO,
} from "@lucid-evolution/lucid";
import { join, resolve } from "@std/path";
import { buildOperationalLucid } from "../../../cardano/offchain/scripts/shutdown-deployment.ts";
import { inspectMigration } from "../../../cardano/offchain/src/migration.ts";
import { bech32Address } from "../../../cardano/offchain/types/plutus/Migration.ts";
import { HostStateDatum } from "../../../cardano/offchain/types/plutus/HostState.ts";
import { TransferModuleDatum } from "../../../cardano/offchain/types/plutus/TransferModuleDatum.ts";
import {
  type DeploymentTemplate,
  generateTokenName,
} from "../../../cardano/offchain/src/utils.ts";
import {
  datumFields,
  escrowDatum,
} from "../../../cardano/offchain/src/shutdown.ts";
import { escrowShardName } from "../../../cardano/offchain/src/migration-transactions.ts";
import { DeploymentIbcTree } from "../../../cardano/offchain/src/deployment.ts";
import { canonicalMigrationJson } from "../../../cardano/offchain/src/migration-plan.ts";
import { validateOwnedRuntime } from "./owned-migration-runtime.ts";

const root = resolve(import.meta.dirname!, "../../..");
const [runtimeArg, handlerArg, outputArg] = Deno.args;
if (!runtimeArg || !handlerArg || !outputArg) {
  throw new Error(
    "Usage: capture-migration-population.ts OWNED_RUNTIME HANDLER NEW_SNAPSHOT_JSON",
  );
}
const runtime = await Deno.realPath(runtimeArg),
  handler = await Deno.realPath(handlerArg),
  output = resolve(outputArg);
for (const p of [runtime, handler, output]) {
  if (!p.startsWith(join(root, ".deployment-smoke") + "/")) {
    throw new Error("Explicit disposable artifacts are required");
  }
}
const genesis = JSON.parse(
  await Deno.readTextFile(join(runtime, "runtime/genesis-shelley.json")),
);
if (genesis.networkMagic !== 42) {
  throw new Error("Only owned magic-42 rehearsal data is supported");
}
const genesisSha256 = await validateOwnedRuntime(runtime, true);
for (
  const name of [
    "DEPLOYER_SK",
    "MIGRATION_EXECUTOR_SK",
    "KUPO_API_KEY",
    "OGMIOS_API_KEY",
  ]
) Deno.env.delete(name);
Deno.env.set("KUPO_URL", "http://127.0.0.1:2742");
Deno.env.set("OGMIOS_URL", "http://127.0.0.1:2637");
Deno.env.set("CARDANO_NETWORK_MAGIC", "42");
const lucid = await buildOperationalLucid({ readOnly: true });
const deployment: DeploymentTemplate = JSON.parse(
  await Deno.readTextFile(handler),
);
const { registry, utxo: registryUtxo } = await inspectMigration(
  lucid,
  deployment,
);
const hostUnit = registry.host_policy + fromText("ibc_host_state");
const hostUtxo = await lucid.utxoByUnit(hostUnit);
const host = Data.from(hostUtxo.datum!, HostStateDatum);
const registration = host.control.port_registry.get(fromText("transfer"));
if (!registration) {
  throw new Error("Authenticated transfer registration is absent");
}
const current = registry.current.addresses.map((a) =>
  bech32Address("Custom", a)
);
const moving = typeof registry.phase === "object" && "Moving" in registry.phase
  ? registry.phase.Moving
  : undefined;
const target = moving?.target.addresses.map((a) => bech32Address("Custom", a));
const objects: Array<{ role: string; unit: string; utxo: UTxO }> = [];
function record(role: string, unit: string, utxo: UTxO, roleIndex: number) {
  if (
    utxo.assets[unit] !== 1n || !utxo.datum ||
    ![current[roleIndex], target?.[roleIndex]].includes(utxo.address)
  ) {
    throw new Error(`Wrong state identity/custody for ${role}/${unit}`);
  }
  if (objects.some((o) => o.unit === unit)) {
    throw new Error(`Duplicate state NFT ${unit}`);
  }
  objects.push({ role, unit, utxo });
}
record("host", hostUnit, hostUtxo, 0);
for (
  const [role, policy, count, index] of [
    [
      "ibc_client",
      registry.identity.client_policy,
      host.state.next_client_sequence,
      1,
    ],
    [
      "connection",
      registry.identity.connection_policy,
      host.state.next_connection_sequence,
      2,
    ],
    [
      "channel",
      registry.identity.channel_policy,
      host.state.next_channel_sequence,
      3,
    ],
  ] as const
) {
  for (let cursor = 0n; cursor < count; cursor++) {
    const unit = policy +
      await generateTokenName(
        { policy_id: registry.host_policy, name: fromText("ibc_host_state") },
        fromText(role),
        cursor,
      );
    record(`${role}/${cursor}`, unit, await lucid.utxoByUnit(unit), index);
  }
}
const moduleUnit = registration.module_token.policy_id +
  registration.module_token.name;
const module = await lucid.utxoByUnit(moduleUnit);
record("transfer-root", moduleUnit, module, 4);
const tree = new DeploymentIbcTree();
for (const address of new Set([current[4], ...(target ? [target[4]] : [])])) {
  for (const candidate of await lucid.utxosAt(address)) {
    const units = Object.keys(candidate.assets).filter((unit) =>
      unit.startsWith(registry.identity.escrow_policy)
    );
    if (!units.length) continue;
    const escrow = escrowDatum(candidate),
      name = escrowShardName(escrow.channelId, escrow.denom);
    if (
      units.length !== 1 || units[0] !== registry.identity.escrow_policy + name
    ) throw new Error("Unexpected escrow identity");
    record(
      `escrow/${escrow.channelId}/${escrow.denom}`,
      units[0],
      candidate,
      4,
    );
    tree.set(`escrowShards/${name}`, "01");
  }
}
if (
  await tree.getRoot() !==
    Data.from(module.datum!, TransferModuleDatum).escrow_shard_registry_root
) {
  throw new Error(
    "Discovered inventory does not match authenticated escrow root",
  );
}
const walletPopulation = JSON.parse(
  await Deno.readTextFile(join(runtime, "wallet-population.json")),
);
const wallets = [];
const ordered = (outputs: UTxO[]) =>
  outputs.sort((a, b) =>
    a.txHash.localeCompare(b.txHash) || a.outputIndex - b.outputIndex
  );
for (const address of [walletPopulation.primary, walletPopulation.secondary]) {
  wallets.push({ address, utxos: ordered(await lucid.utxosAt(address)) });
}
const executorFunding = JSON.parse(
  await Deno.readTextFile(join(runtime, "wallet-migration-executor.json")),
);
if (
  executorFunding.genesisSha256 !== genesisSha256 ||
  wallets.some((wallet) =>
    getAddressDetails(wallet.address).paymentCredential?.hash ===
      executorFunding.credential
  ) ||
  getAddressDetails(executorFunding.address).paymentCredential?.hash !==
    executorFunding.credential ||
  registry.governance.signers.includes(executorFunding.credential)
) {
  throw new Error(
    "Migration executor must be distinct from holders and authority",
  );
}
const executor = {
  address: executorFunding.address,
  credential: executorFunding.credential,
  utxos: ordered(await lucid.utxosAt(executorFunding.address)),
};
if (
  executor.utxos.some((utxo) =>
    Object.keys(utxo.assets).some((unit) => unit !== "lovelace")
  )
) throw new Error("Rehearsal migration executor must hold only external ADA");
// Freeze Cosmos observations at one actual committed height. This observation is
// not a replacement for counterparty membership-proof validation by the relayer.
const cosmos = "http://127.0.0.1:1527";
const json = async (url: string, height?: string) => {
  const response = await fetch(url, {
    headers: height ? { "x-cosmos-block-height": height } : {},
  });
  if (!response.ok) {
    throw new Error(`Counterparty query failed: ${response.status} ${url}`);
  }
  if (
    height &&
    (response.headers.get("x-cosmos-block-height") ??
        response.headers.get("grpc-metadata-x-cosmos-block-height")) !== height
  ) {
    throw new Error("Counterparty did not honor the requested snapshot height");
  }
  return response.json();
};
const block = await json(
  `${cosmos}/cosmos/base/tendermint/v1beta1/blocks/latest`,
);
const cosmosHeight = block.block?.header?.height;
if (
  !/^\d+$/.test(cosmosHeight ?? "") ||
  block.block.header.chain_id !== "migration-462-1"
) throw new Error("Unexpected counterparty network or height");
const cosmosAddress = "cosmos1rnr5jrt4exl0samwj0yegv99jeskl0hsge5zwt";
const balances = await json(
  `${cosmos}/cosmos/bank/v1beta1/balances/${cosmosAddress}?pagination.limit=1000`,
  cosmosHeight,
);
if (balances.pagination?.next_key) {
  throw new Error("Counterparty balance pagination must be exhausted");
}
const counterpartyEscrows = [];
for (
  const object of objects.filter((entry) => entry.role.startsWith("channel/"))
) {
  const [state] = datumFields(Data.from(object.utxo.datum!), 3);
  const [channel] = datumFields(state, 9);
  const counterparty = datumFields(channel, 5)[2];
  const [portHex, channelHex] = datumFields(counterparty, 2);
  if (
    typeof portHex !== "string" || typeof channelHex !== "string" ||
    portHex !== fromText("transfer")
  ) throw new Error("Unsupported counterparty route");
  const channelId = new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(
      channelHex.match(/../g) ?? [],
      (byte) => parseInt(byte, 16),
    ),
  );
  if (!/^channel-\d+$/.test(channelId)) {
    throw new Error("Invalid remote channel");
  }
  const addressResponse = await json(
    `${cosmos}/ibc/apps/transfer/v1/channels/${channelId}/ports/transfer/escrow_address`,
    cosmosHeight,
  );
  if (!/^cosmos1[a-z0-9]+$/.test(addressResponse.escrow_address)) {
    throw new Error("Unexpected remote escrow address");
  }
  const escrowBalances = await json(
    `${cosmos}/cosmos/bank/v1beta1/balances/${addressResponse.escrow_address}?pagination.limit=1000`,
    cosmosHeight,
  );
  if (escrowBalances.pagination?.next_key) {
    throw new Error("Incomplete remote escrow balances");
  }
  counterpartyEscrows.push({
    cardanoChannel: object.role.replace("channel/", "channel-"),
    channel: channelId,
    address: addressResponse.escrow_address,
    balances: escrowBalances.balances,
  });
}
for (const object of [...objects, { utxo: registryUtxo }]) {
  const [live] = await lucid.utxosByOutRef([{
    txHash: object.utxo.txHash,
    outputIndex: object.utxo.outputIndex,
  }]);
  if (canonicalMigrationJson(live) !== canonicalMigrationJson(object.utxo)) {
    throw new Error(
      "State changed while capturing; retry a quiescent observation",
    );
  }
}
for (const wallet of [...wallets, executor]) {
  if (
    canonicalMigrationJson(ordered(await lucid.utxosAt(wallet.address))) !==
      canonicalMigrationJson(wallet.utxos)
  ) throw new Error("Wallet changed during capture");
}
const snapshot = {
  format: "migration-rehearsal-population-v1",
  genesisSha256,
  registry,
  registryUtxo,
  host,
  objects,
  wallets,
  executor,
  counterparty: {
    chain: "migration-462-1",
    height: cosmosHeight,
    address: cosmosAddress,
    balances: balances.balances,
    escrows: counterpartyEscrows,
  },
  observation:
    "Quiescent canonical-provider observation, not a finality certificate; Cosmos and Cardano snapshots have independent heights.",
};
await Deno.writeTextFile(output, canonicalMigrationJson(snapshot) + "\n", {
  createNew: true,
});
console.log(
  canonicalMigrationJson({
    snapshot: output,
    generation: registry.current.generation,
    phase: registry.phase,
    stateObjects: objects.length,
    cosmosHeight,
  }),
);
