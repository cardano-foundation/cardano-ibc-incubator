import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { blake2b } from "@noble/hashes/blake2b";
import {
  applyDoubleCborEncoding,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  type ProtocolParameters,
  type Script,
  type UTxO,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { loadDeploymentPlan } from "../deployment-plan.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { loadSuccessorImplementation } from "../migration-plan.ts";
import {
  buildMigrationTransaction,
  escrowShardName,
} from "../migration-transactions.ts";
import {
  generateIdentifierTokenName,
  generatePortTokenName,
  generateTokenName,
} from "../utils.ts";
import {
  HostStateDatum,
  ModuleRegistration,
} from "../../types/plutus/HostState.ts";
import {
  bech32Address,
  Registry,
  type RegistryRedeemer,
} from "../../types/plutus/Migration.ts";
import { TransferModuleDatum } from "../../types/plutus/TransferModuleDatum.ts";

export const EMPTY = "00".repeat(32);
const SEED = "abandon ".repeat(11) + "about"; // Public test mnemonic only.
const START = 1_700_000_000_000;
const record = (...fields: Data[]) => new Constr(0, fields);

/** Independent sparse-tree recomputation, not the migration builder's witness code. */
export function oracleRoot(entries: ReadonlyMap<string, string>): string {
  const hash = (...parts: Uint8Array[]) =>
    createHash("sha256").update(Buffer.concat(parts)).digest();
  const zero = Buffer.alloc(32);
  let nodes = new Map<bigint, Buffer>();
  for (const [key, value] of entries) {
    const keyHash = hash(Buffer.from(key));
    nodes.set(
      keyHash.readBigUInt64BE(),
      hash(Buffer.from([0]), keyHash, hash(Buffer.from(value, "hex"))),
    );
  }
  for (let level = 0; level < 64; level++) {
    const parents = new Map<bigint, Buffer>();
    for (const index of nodes.keys()) {
      const parent = index >> 1n;
      if (!parents.has(parent)) {
        parents.set(
          parent,
          hash(
            Buffer.from([1]),
            nodes.get(parent << 1n) ?? zero,
            nodes.get((parent << 1n) | 1n) ?? zero,
          ),
        );
      }
    }
    nodes = parents;
  }
  return (nodes.get(0n) ?? zero).toString("hex");
}

type Pending = {
  kind: "native-send" | "native-return" | "foreign-return";
  amount: bigint;
};

/** Economic oracle: migration cannot settle packets or change backing/supply.
 * This is an abstract accounting model, not a simulated IBC proof verifier.
 */
export class AccountingOracle {
  nativeAvailable = 1_000_000n;
  nativeEscrow = 0n;
  remoteNativeVouchers = 0n;
  foreignBacking = 0n;
  cardanoForeignVouchers = 0n;
  pending = new Map<string, Pending>();
  seen = new Set<string>();
  moving = false;
  remaining = new Set<string>();

  private active() {
    if (this.moving) throw new Error("accounting is frozen");
  }
  private put(id: string, packet: Pending) {
    if (this.seen.has(id)) throw new Error("duplicate packet identity");
    if (packet.amount <= 0n) throw new Error("positive amount required");
    this.seen.add(id);
    this.pending.set(id, packet);
  }
  sendNative(id: string, amount: bigint) {
    this.active();
    if (amount > this.nativeAvailable) {
      throw new Error("insufficient native funds");
    }
    this.put(id, { kind: "native-send", amount });
    this.nativeAvailable -= amount;
    this.nativeEscrow += amount;
    this.check();
  }
  burnRemoteNative(id: string, amount: bigint) {
    this.active();
    if (amount > this.remoteNativeVouchers) {
      throw new Error("insufficient remote vouchers");
    }
    this.put(id, { kind: "native-return", amount });
    this.remoteNativeVouchers -= amount;
    this.check();
  }
  receiveForeign(id: string, amount: bigint) {
    this.active();
    this.put(id, { kind: "foreign-return", amount });
    this.pending.delete(id);
    this.foreignBacking += amount;
    this.cardanoForeignVouchers += amount;
    this.check();
  }
  burnForeign(id: string, amount: bigint) {
    this.active();
    if (amount > this.cardanoForeignVouchers) {
      throw new Error("insufficient local vouchers");
    }
    this.put(id, { kind: "foreign-return", amount });
    this.cardanoForeignVouchers -= amount;
    this.check();
  }
  settle(id: string, success: boolean) {
    this.active();
    const packet = this.pending.get(id);
    if (!packet) throw new Error("packet already settled or unknown");
    const { kind, amount } = packet;
    if (kind === "native-send") {
      if (success) this.remoteNativeVouchers += amount;
      else {
        this.nativeEscrow -= amount;
        this.nativeAvailable += amount;
      }
    } else if (kind === "native-return") {
      if (success) {
        this.nativeEscrow -= amount;
        this.nativeAvailable += amount;
      } else this.remoteNativeVouchers += amount;
    } else if (success) this.foreignBacking -= amount;
    else this.cardanoForeignVouchers += amount;
    this.pending.delete(id);
    this.check();
  }
  begin(objects: string[]) {
    if (this.moving || new Set(objects).size !== objects.length) {
      throw new Error("invalid migration inventory");
    }
    this.moving = true;
    this.remaining = new Set(objects);
  }
  move(id: string) {
    if (!this.moving || !this.remaining.delete(id)) {
      throw new Error("object already migrated or absent");
    }
    this.check();
  }
  activate() {
    if (!this.moving || this.remaining.size) {
      throw new Error("unfinished inventory");
    }
    this.moving = false;
    this.check();
  }
  economicSnapshot() {
    return {
      nativeAvailable: this.nativeAvailable,
      nativeEscrow: this.nativeEscrow,
      remoteNativeVouchers: this.remoteNativeVouchers,
      foreignBacking: this.foreignBacking,
      cardanoForeignVouchers: this.cardanoForeignVouchers,
      pending: structuredClone(this.pending),
      seen: new Set(this.seen),
    };
  }
  check() {
    let nativePending = 0n, foreignPending = 0n;
    for (const packet of this.pending.values()) {
      if (packet.kind === "foreign-return") foreignPending += packet.amount;
      else nativePending += packet.amount;
    }
    if (this.nativeEscrow !== this.remoteNativeVouchers + nativePending) {
      throw new Error("native backing mismatch");
    }
    if (this.nativeAvailable + this.nativeEscrow !== 1_000_000n) {
      throw new Error("native conservation failure");
    }
    if (this.foreignBacking !== this.cardanoForeignVouchers + foreignPending) {
      throw new Error("foreign backing mismatch");
    }
    if (
      [
        this.nativeAvailable,
        this.nativeEscrow,
        this.remoteNativeVouchers,
        this.foreignBacking,
        this.cardanoForeignVouchers,
      ].some((n) => n < 0n)
    ) throw new Error("negative balance");
  }
}

/** Seeded isolated branch fixture. Authenticated tokens are placed directly in
 * the emulator; this does NOT demonstrate creation/handshake/packet acceptance.
 * Every move is nevertheless balanced and evaluated against compiled production scripts.
 */
export async function accountingFixture(seedNumber = 462, options: {
  protocolParameters?: ProtocolParameters;
  packetEntries?: number;
  channelCount?: bigint;
  channelIndex?: bigint;
  populateAllChannels?: boolean;
  escrowShards?: number;
} = {}) {
  const packetEntries = options.packetEntries ?? 2;
  const channelCount = options.channelCount ?? 1n;
  const channelIndex = options.channelIndex ?? 0n;
  const shardCount = options.escrowShards ?? 2;
  if (
    !Number.isInteger(packetEntries) || packetEntries < 0 ||
    packetEntries > 64 ||
    channelCount < 1n || channelIndex < 0n || channelIndex >= channelCount ||
    !Number.isInteger(shardCount) || shardCount < 2 || shardCount > 1024
  ) {
    throw new Error("Unsupported isolated accounting fixture dimensions");
  }
  const channelId = `channel-${channelIndex}`;
  const address = walletFromSeed(SEED, { network: "Custom" }).address;
  const authority = getAddressDetails(address).paymentCredential!.hash;
  const emulator = new Emulator(
    Array.from(
      { length: 8 },
      () => ({
        address,
        seedPhrase: SEED,
        privateKey: "",
        assets: { lovelace: 200_000_000n },
      }),
    ),
    options.protocolParameters ??
      { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 16_384 },
  );
  emulator.time = START;
  // Do not accept emulator budget echoes as script validation.
  emulator.evaluateTx = () => {
    throw new Error("local UPLC evaluation required");
  };
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(SEED);
  const funds = await lucid.wallet().getUtxos();
  const outref = (n: number) => ({
    transaction_id: funds[n].txHash,
    output_index: BigInt(funds[n].outputIndex),
  });
  const plan = await loadDeploymentPlan(lucid, {
    hostStateNonce: outref(0),
    transferModuleNonce: outref(1),
    traceDirectoryNonce: outref(2),
    deployerPaymentKeyHash: authority,
    benchmarkVoucherEnabled: false,
    migration: {
      registryNonce: outref(3),
      governance: { signers: [authority], quorum: 1n, delay_ms: 86_400_000n },
    },
  });
  if (!plan.registry || !plan.implementationRegistry) {
    throw new Error("missing migration plan");
  }
  const moduleToken = {
    policy_id: plan.mintIdentifier.hash,
    name: await generateIdentifierTokenName(plan.inputs.transferModuleNonce),
  };
  const portToken = {
    policy_id: plan.mintPort.hash,
    name: generatePortTokenName(fromText("transfer")),
  };
  const registration: ModuleRegistration = {
    module_script_hash: plan.spendTransferModule.hash,
    port_token: portToken,
    module_token: moduleToken,
  };
  const successor = await loadSuccessorImplementation(
    lucid,
    plan,
    2n,
    moduleToken,
  );
  let index = 0;
  const seed = (
    destination: string,
    assets: Record<string, bigint>,
    datum: string,
    scriptRef?: Script,
  ): UTxO => {
    const utxo = {
      txHash: "ab".repeat(32),
      outputIndex: index++,
      address: destination,
      assets,
      datum,
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  };
  const reference = (script: Script) =>
    seed(
      plan.referenceHolder.address,
      { lovelace: 100_000_000n },
      Data.void(),
      { ...script, script: applyDoubleCborEncoding(script.script) },
    );
  const registryReference = reference(plan.implementationRegistry.script);
  const transferReference = reference(plan.spendTransferModule.script);
  const channelReference = reference(plan.spendingChannel.base.script);
  const successorHostReference = reference(successor.validators[0].script);
  const nativeUnit = plan.mockToken.hash + fromText("native");
  const sideUnit = plan.mockToken.hash + fromText("side-effect");
  const voucherUnit = plan.mintVoucher.hash + "0014df10" +
    Buffer.from(
      blake2b(new TextEncoder().encode("transfer/channel-0/uatom"), {
        dkLen: 28,
      }),
    ).toString("hex");
  const supply = BigInt(seedNumber + 100);
  seed(address, {
    lovelace: 10_000_000n,
    [voucherUnit]: supply,
    [sideUnit]: 2n,
  }, Data.void());
  const inventoryTree = new DeploymentIbcTree();
  const inventory = new Map<string, string>();
  const shards = Array.from({ length: shardCount }, (_, n) => {
    const channel = fromText(
      options.populateAllChannels
        ? `channel-${BigInt(n) % channelCount}`
        : n < 2
        ? channelId
        : `channel-${n}`,
    );
    const shardNativeUnit = options.populateAllChannels && n >= 2
      ? plan.mockToken.hash + fromText(`native-${n}`)
      : nativeUnit;
    const denom = n === 0 ? fromText("lovelace") : fromText(shardNativeUnit);
    const amount = n === 0
      ? 3_000_000n + BigInt(seedNumber)
      : BigInt(seedNumber + 25);
    const name = escrowShardName(channel, denom);
    const key = `escrowShards/${name}`;
    inventory.set(key, "01");
    inventoryTree.set(key, "01");
    const nft = plan.mintTransferEscrowShard.hash + name;
    const assets: Record<string, bigint> = {
      lovelace: 12_000_000n + (n === 0 ? amount : 0n),
      [nft]: 1n,
    };
    if (n !== 0) assets[shardNativeUnit] = amount;
    const datum = Data.to(record(channel, denom, amount));
    return {
      key,
      nft,
      amount,
      unit: n === 0 ? "lovelace" : shardNativeUnit,
      utxo: seed(plan.spendTransferModule.address, assets, datum),
    };
  });
  const escrowRoot = await inventoryTree.getRoot();
  const root = seed(plan.spendTransferModule.address, {
    lovelace: 12_000_000n,
    [moduleToken.policy_id + moduleToken.name]: 1n,
    [portToken.policy_id + portToken.name]: 1n,
  }, Data.to({ escrow_shard_registry_root: escrowRoot }, TransferModuleDatum));
  const channelName = await generateTokenName(
    { policy_id: plan.hostNft.hash, name: fromText("ibc_host_state") },
    fromText("channel"),
    channelIndex,
  );
  const channelUnit = plan.mintChannel.hash + channelName;
  const commitments = new Map<Data, Data>(
    Array.from({ length: packetEntries }, (_, n) => [
      BigInt(n + 1),
      (81 + n).toString(16).padStart(2, "0").repeat(32),
    ]),
  );
  const channelEnd = record(
    new Constr(3, []),
    new Constr(1, []),
    record(fromText("transfer"), fromText("channel-7")),
    [fromText("connection-0")],
    fromText("ics20-1"),
  );
  const channelDatum = record(
    record(
      channelEnd,
      BigInt(packetEntries + 1),
      1n,
      1n,
      commitments,
      new Map(),
      new Map(),
      record(0n, 0n),
      record(0n, 0n),
    ),
    fromText("transfer"),
    record(plan.mintChannel.hash, channelName),
  );
  const channel = seed(plan.spendingChannel.base.address, {
    lovelace: 12_000_000n,
    [channelUnit]: 1n,
  }, Data.to(channelDatum));
  const ibcTree = new DeploymentIbcTree();
  const committed = new Map<string, string>([[
    "ports/transfer",
    Data.to(registration, ModuleRegistration),
  ], [
    `channelEnds/ports/transfer/channels/${channelId}`,
    Data.to(channelEnd),
  ]]);
  for (const [sequence, digest] of commitments) {
    committed.set(
      `commitments/ports/transfer/channels/${channelId}/sequences/${sequence}`,
      Data.to(digest),
    );
  }
  const channels = [channel];
  if (options.populateAllChannels) {
    for (let index = 0n; index < channelCount; index++) {
      if (index === channelIndex) continue;
      const name = await generateTokenName(
        { policy_id: plan.hostNft.hash, name: fromText("ibc_host_state") },
        fromText("channel"),
        index,
      );
      const datum = Data.from(Data.to(channelDatum)) as Constr<Data>;
      datum.fields[2] = record(plan.mintChannel.hash, name);
      channels.push(
        seed(plan.spendingChannel.base.address, {
          lovelace: 12_000_000n,
          [plan.mintChannel.hash + name]: 1n,
        }, Data.to(datum)),
      );
      const id = `channel-${index}`;
      committed.set(
        `channelEnds/ports/transfer/channels/${id}`,
        Data.to(channelEnd),
      );
      for (const [sequence, digest] of commitments) {
        committed.set(
          `commitments/ports/transfer/channels/${id}/sequences/${sequence}`,
          Data.to(digest),
        );
      }
    }
  }
  for (const [key, value] of committed) ibcTree.set(key, value);
  const hostDatum: HostStateDatum = {
    state: {
      version: 9n,
      ibc_state_root: await ibcTree.getRoot(),
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: channelCount,
      bound_port: [],
      last_update_time: BigInt(START),
    },
    nft_policy: plan.hostNft.hash,
    deployer: authority,
    control: {
      port_registry: new Map([[fromText("transfer"), registration]]),
      shutdown: "Active",
    },
  };
  const hostUnit = plan.hostNft.hash + fromText("ibc_host_state");
  const host = seed(successor.validators[0].address, {
    lovelace: 12_000_000n,
    [hostUnit]: 1n,
  }, Data.to(hostDatum, HostStateDatum));
  const registryDatum: Registry = {
    ...plan.registry,
    nonce: 1n,
    phase: {
      Moving: {
        target: successor.implementation,
        limits: { clients: 0n, connections: 0n, channels: channelCount },
        next: { clients: 0n, connections: 0n, channels: channelIndex },
        registration,
        escrow_remaining: escrowRoot,
        module_moved: false,
      },
    },
  };
  const registryUnit = registryDatum.token.policy_id + registryDatum.token.name;
  const registry = seed(plan.implementationRegistry.address, {
    lovelace: 25_000_000n,
    [registryUnit]: 1n,
  }, Data.to(registryDatum, Registry));
  const build = (
    object: UTxO,
    objectReference: UTxO,
    action: RegistryRedeemer,
    registryInput = registry,
  ) =>
    buildMigrationTransaction(lucid, registryUnit, {
      registry: registryInput,
      registryReference,
      object,
      objectReference,
      validFrom: emulator.now(),
      validTo: emulator.now() + 60_000,
    }, action);
  return {
    lucid,
    emulator,
    address,
    plan,
    successor,
    seed,
    reference,
    registryReference,
    transferReference,
    channelReference,
    successorHostReference,
    shards,
    inventoryTree,
    inventory,
    ibcTree,
    committed,
    root,
    channel,
    channels,
    channelUnit,
    host,
    hostUnit,
    hostDatum,
    registration,
    registry,
    registryDatum,
    registryUnit,
    nativeUnit,
    sideUnit,
    voucherUnit,
    supply,
    build,
    targetTransfer: bech32Address(
      "Custom",
      successor.implementation.addresses[4],
    ),
  };
}

export type AccountingFixture = Awaited<ReturnType<typeof accountingFixture>>;
