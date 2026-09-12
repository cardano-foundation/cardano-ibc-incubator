import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  applyDoubleCborEncoding,
  Constr,
  Data,
  fromHex,
  fromText,
  getAddressDetails,
  Lucid,
  type Script,
  type UTxO,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { blake2b } from "@noble/hashes/blake2b";
import { Buffer } from "node:buffer";
import { buildChannelValidators, DeploymentIbcTree } from "./deployment.ts";
import {
  type DeploymentTemplate,
  generatePortTokenName,
  readValidator,
} from "./utils.ts";
import { AuthTokenSchema, HostStateDatum } from "../types/index.ts";
import {
  assertNoDeploymentState,
  assertStateDrained,
  buildReclaimEscrowTx,
  buildReclaimStateTx,
  datumFields,
  scanDeploymentState,
} from "./shutdown.ts";
import { buildReclaimRecoveryStakeTx } from "../scripts/shutdown-deployment.ts";

const record = (...fields: Data[]) => new Constr(0, fields);
const encode = (data: Data) => Data.to(data);
const hash = (byte: string) => byte.repeat(28);
const EMPTY_ROOT = "00".repeat(32);

async function fixture(escrowAmount = 0n) {
  const account = generateEmulatorAccount({ lovelace: 10_000_000_000n });
  const referenceAccount = generateEmulatorAccount({});
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const deployer = getAddressDetails(account.address).paymentCredential!.hash;
  const hostPolicy = hash("44");
  let outputIndex = 0;
  function seed(
    address: string,
    assets: Record<string, bigint>,
    datum: string,
    scriptRef?: Script,
  ): UTxO {
    const utxo = {
      txHash: "ab".repeat(32),
      outputIndex: outputIndex++,
      address,
      assets,
      datum,
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  }
  function reference(script: Script) {
    return seed(
      referenceAccount.address,
      { lovelace: 100_000_000n },
      Data.void(),
      {
        ...script,
        script: applyDoubleCborEncoding(script.script),
      },
    );
  }
  function validator(title: string, parameters: unknown[] = []) {
    const schemas = parameters.map((parameter) =>
      typeof parameter === "string"
        ? Data.Bytes()
        : parameter && typeof parameter === "object" && "policy_id" in parameter
        ? AuthTokenSchema
        : Data.Enum([
          Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
          Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
        ])
    );
    const [script, scriptHash, address] = readValidator(
      title,
      lucid,
      parameters as never,
      Data.Tuple(schemas) as never,
    );
    return {
      title,
      script: script.script,
      scriptHash,
      address,
      refUtxo: reference(script),
    };
  }
  const recoverClient = validator("recover_client.recover_client.withdraw", [
    hostPolicy,
  ]);
  recoverClient.address = validatorToRewardAddress("Custom", {
    type: "PlutusV3",
    script: recoverClient.script,
  });
  const spendClient = validator("spending_client.spend_client.spend", [
    hostPolicy,
    { Script: [recoverClient.scriptHash] },
  ]);
  const mintClientStt = validator("minting_client_stt.mint_client_stt.mint", [
    spendClient.scriptHash,
    hostPolicy,
  ]);
  const spendConnection = validator(
    "spending_connection.spend_connection.spend",
    [mintClientStt.scriptHash, hash("55"), hostPolicy],
  );
  const mintConnectionStt = validator(
    "minting_connection_stt.mint_connection_stt.mint",
    [
      mintClientStt.scriptHash,
      hash("55"),
      spendConnection.scriptHash,
      hostPolicy,
    ],
  );
  const mintPort = validator("minting_port.mint_port.mint", [hostPolicy]);
  const mintIdentifier = validator(
    "minting_identifier.minting_identifier.mint",
  );
  const channels = buildChannelValidators(
    lucid,
    mintClientStt.scriptHash,
    mintConnectionStt.scriptHash,
    mintPort.scriptHash,
    hash("55"),
    hostPolicy,
  );
  const spendChannel = {
    title: "spending_channel.spend_channel.spend",
    script: channels.base.script.script,
    scriptHash: channels.base.hash,
    address: channels.base.address,
    refUtxo: reference(channels.base.script),
  };
  const mintChannelStt = validator(
    "minting_channel_stt.mint_channel_stt.mint",
    [
      mintClientStt.scriptHash,
      mintConnectionStt.scriptHash,
      mintPort.scriptHash,
      hash("55"),
      spendChannel.scriptHash,
      hostPolicy,
      recoverClient.scriptHash,
    ],
  );
  const spendMockModule = validator(
    "spending_mock_module.spend_mock_module.spend",
    [hostPolicy],
  );
  const portToken = {
    policy_id: mintPort.scriptHash,
    name: generatePortTokenName(fromText("transfer")),
  };
  const moduleToken = { policy_id: mintIdentifier.scriptHash, name: "01" };
  const mockPortToken = {
    policy_id: mintPort.scriptHash,
    name: generatePortTokenName(fromText("mock")),
  };
  const mockToken = { policy_id: mintIdentifier.scriptHash, name: "02" };
  const directory = { policy_id: mintIdentifier.scriptHash, name: "03" };
  const voucherMetadata = validator("voucher_metadata.voucher_metadata.spend", [
    hostPolicy,
  ]);
  const mintVoucher = validator("minting_voucher.mint_voucher.mint", [
    moduleToken,
    directory,
    voucherMetadata.scriptHash,
    mintChannelStt.scriptHash,
    hostPolicy,
  ]);
  const mintTransferEscrowShard = validator(
    "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
    [portToken, hostPolicy],
  );
  const spendTransferModule = validator(
    "spending_transfer_module.spend_transfer_module.spend",
    [
      portToken,
      moduleToken,
      fromText("transfer"),
      mintTransferEscrowShard.scriptHash,
      mintChannelStt.scriptHash,
      mintVoucher.scriptHash,
      hostPolicy,
      recoverClient.scriptHash,
    ],
  );
  const spendTraceRegistry = validator(
    "trace_registry.spend_trace_registry.spend",
    [
      mintIdentifier.scriptHash,
      directory,
      mintVoucher.scriptHash,
      "",
      hostPolicy,
    ],
  );
  const host = validator("host_state_stt.host_state_stt.spend", [
    hostPolicy,
    spendClient.scriptHash,
    spendConnection.scriptHash,
    spendChannel.scriptHash,
    mintClientStt.scriptHash,
    mintConnectionStt.scriptHash,
    mintChannelStt.scriptHash,
  ]);
  const now = emulator.now();
  const hostDatum = {
    state: {
      version: 1n,
      ibc_state_root: EMPTY_ROOT,
      next_client_sequence: 1n,
      next_connection_sequence: 1n,
      next_channel_sequence: 1n,
      bound_port: [],
      last_update_time: BigInt(now),
    },
    nft_policy: hostPolicy,
    deployer,
    control: {
      port_registry: new Map([
        [fromText("transfer"), {
          module_script_hash: spendTransferModule.scriptHash,
          port_token: portToken,
          module_token: moduleToken,
        }],
        [fromText("mock"), {
          module_script_hash: spendMockModule.scriptHash,
          port_token: mockPortToken,
          module_token: mockToken,
        }],
      ]),
      shutdown: {
        ShuttingDown: {
          initiated_at: BigInt(now - 86_400_000),
          grace_period_end: BigInt(now),
        },
      },
    },
  };
  const hostUtxo = seed(host.address, {
    lovelace: 5_000_000n,
    [hostPolicy + fromText("ibc_host_state")]: 1n,
  }, Data.to(hostDatum, HostStateDatum));
  const deployment = {
    validators: {
      recoverClient,
      spendClient,
      mintClientStt,
      spendConnection,
      mintConnectionStt,
      spendChannel,
      mintChannelStt,
      spendTransferModule,
      mintTransferEscrowShard,
      spendMockModule,
      spendTraceRegistry,
      mintPort,
      mintIdentifier,
      mintVoucher,
      voucherMetadata,
      hostStateStt: host,
    },
    hostStateNFT: { policyId: hostPolicy, name: fromText("ibc_host_state") },
    modules: {
      transfer: {
        identifier: moduleToken.policy_id + moduleToken.name,
        address: spendTransferModule.address,
      },
      mock: {
        identifier: mockToken.policy_id + mockToken.name,
        address: spendMockModule.address,
      },
    },
    traceRegistry: {
      address: spendTraceRegistry.address,
      shardPolicyId: mintIdentifier.scriptHash,
      directory: { policyId: directory.policy_id, name: directory.name },
    },
  } as unknown as DeploymentTemplate;

  const token = (policy: string, name: string) => record(policy, name);
  const stateValue = (policy: string, name: string) => ({
    lovelace: 5_000_000n,
    [policy + name]: 1n,
  });
  const channelState = record(
    record(
      new Constr(2, []),
      new Constr(1, []),
      record(fromText("transfer"), fromText("channel-0")),
      [fromText("connection-0")],
      fromText("ics20-1"),
    ),
    1n,
    1n,
    1n,
    new Map(),
    new Map(),
    new Map(),
    record(0n, 0n),
    record(0n, 0n),
  );
  const channel = seed(
    spendChannel.address,
    stateValue(mintChannelStt.scriptHash, "10"),
    encode(
      record(
        channelState,
        fromText("transfer"),
        token(mintChannelStt.scriptHash, "10"),
      ),
    ),
  );
  seed(
    spendClient.address,
    stateValue(mintClientStt.scriptHash, "11"),
    encode(record(record(), token(mintClientStt.scriptHash, "11"))),
  );
  seed(
    spendConnection.address,
    stateValue(mintConnectionStt.scriptHash, "12"),
    encode(record(record(), token(mintConnectionStt.scriptHash, "12"))),
  );
  seed(spendMockModule.address, {
    ...stateValue(mockToken.policy_id, mockToken.name),
    [mockPortToken.policy_id + mockPortToken.name]: 1n,
  }, Data.void());
  seed(
    spendTraceRegistry.address,
    stateValue(directory.policy_id, directory.name),
    encode(new Constr(1, [record([])])),
  );
  seed(
    voucherMetadata.address,
    stateValue(mintVoucher.scriptHash, "000643b0" + "11".repeat(28)),
    Data.void(),
  );

  const channelId = fromText("channel-0");
  const denom = fromText(fromText("lovelace"));
  const channelBytes = fromHex(channelId);
  const denomBytes = fromHex(denom);
  const length = (size: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(size);
    return b;
  };
  const name = Buffer.from(blake2b(
    Buffer.concat([
      Buffer.from("cardano-ibc/transfer-escrow-shard/v1"),
      Buffer.from([0]),
      length(channelBytes.length),
      channelBytes,
      length(denomBytes.length),
      denomBytes,
    ]),
    { dkLen: 28 },
  )).toString("hex");
  const shardUnit = mintTransferEscrowShard.scriptHash + name;
  const tree = new DeploymentIbcTree();
  tree.set(`escrowShards/${name}`, "01");
  const root = seed(spendTransferModule.address, {
    ...stateValue(moduleToken.policy_id, moduleToken.name),
    [portToken.policy_id + portToken.name]: 1n,
  }, encode(record(await tree.getRoot())));
  const shard = seed(spendTransferModule.address, {
    lovelace: 5_000_000n + escrowAmount,
    [shardUnit]: 1n,
  }, encode(record(channelId, denom, escrowAmount)));
  async function submit(tx: ReturnType<typeof lucid.newTx>) {
    const completed = await tx.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    await signed.submit();
    emulator.awaitBlock();
    return completed.toTransaction().body();
  }
  await submit(lucid.newTx().register.Stake(recoverClient.address));
  return {
    lucid,
    emulator,
    account,
    deployment,
    hostUtxo,
    hostDatum,
    now,
    seed,
    channel,
    root,
    shard,
    tree,
    shardUnit,
    channelId,
    denom,
    submit,
  };
}

Deno.test("shutdown reclaims every state family and its recovery staking deposit", async () => {
  const f = await fixture();
  let groups = await scanDeploymentState(f.lucid, f.deployment);
  assertThrows(() => assertNoDeploymentState(groups), Error, "before removing");
  const transfer = groups.find((group) => group.kind === "transfer")!;
  await f.submit(
    await buildReclaimEscrowTx(
      f.lucid,
      f.deployment,
      f.hostUtxo,
      transfer,
      f.shard,
      f.account.address,
      f.emulator.now(),
    ),
  ).catch((cause) => {
    throw new Error("Escrow cleanup failed", { cause });
  });
  for (
    const kind of [
      "channel",
      "connection",
      "client",
      "transfer",
      "module",
      "trace",
      "metadata",
    ] as const
  ) {
    groups = await scanDeploymentState(f.lucid, f.deployment);
    const group = groups.find((entry) => entry.kind === kind)!;
    assert(group.utxos.length > 0);
    const refund = group.utxos.reduce(
      (total, utxo) => total + utxo.assets.lovelace,
      0n,
    );
    const before = (await f.lucid.utxosAt(f.account.address)).reduce(
      (total, utxo) => total + utxo.assets.lovelace,
      0n,
    );
    await f.submit(
      buildReclaimStateTx(
        f.lucid,
        f.deployment,
        f.hostUtxo,
        group,
        f.account.address,
        f.emulator.now(),
      ),
    ).catch((cause) => {
      throw new Error(`${kind} cleanup failed`, { cause });
    });
    assertEquals((await f.lucid.utxosAt(group.validator.address)).length, 0);
    const after = (await f.lucid.utxosAt(f.account.address)).reduce(
      (total, utxo) => total + utxo.assets.lovelace,
      0n,
    );
    assert(after > before + refund - 2_000_000n);
  }
  assertNoDeploymentState(await scanDeploymentState(f.lucid, f.deployment));
  const credential = f.deployment.validators.recoverClient!;
  assert(f.emulator.chain[credential.address].registeredStake);
  const balance = async () =>
    (await f.lucid.utxosAt(f.account.address)).reduce(
      (total, utxo) => total + utxo.assets.lovelace,
      0n,
    );
  const before = await balance();
  const body = await f.submit(
    buildReclaimRecoveryStakeTx(
      f.lucid,
      f.deployment,
      f.hostUtxo,
      f.hostDatum.deployer,
      f.emulator.now(),
    ),
  );
  // The pinned emulator only updates its stake map for pre-Conway certificates.
  // Evaluate the actual Conway deregistration and check its deposit refund.
  const certificate = body.certs()!.get(0).as_unreg_cert()!;
  assertEquals(
    certificate.stake_credential().as_script()!.to_hex(),
    credential.scriptHash,
  );
  assertEquals(
    certificate.deposit(),
    f.lucid.config().protocolParameters!.keyDeposit,
  );
  assertEquals(await balance(), before + certificate.deposit() - body.fee());
});

Deno.test("shutdown blocks user deposits even when an escrow has enough ADA to pay a refund", async () => {
  const f = await fixture(1n);
  const groups = await scanDeploymentState(f.lucid, f.deployment);
  assertThrows(
    () => assertStateDrained(groups, f.deployment),
    Error,
    "user deposits",
  );
  const siblings = await f.tree.getSiblings(
    `escrowShards/${f.shardUnit.slice(56)}`,
  );
  const registration = f.hostDatum.control.port_registry.get(
    fromText("transfer"),
  )!;
  const recovery = f.deployment.validators.recoverClient!;
  const withdrawal = encode(
    new Constr(2, [
      registration.port_token.policy_id + registration.port_token.name,
      registration.module_token.policy_id + registration.module_token.name,
      f.deployment.validators.mintTransferEscrowShard.scriptHash,
    ]),
  );
  const tx = f.lucid.newTx().readFrom([
    f.hostUtxo,
    f.deployment.validators.spendTransferModule.refUtxo,
    f.deployment.validators.mintTransferEscrowShard.refUtxo,
    f.deployment.validators.recoverClient!.refUtxo,
  ])
    .collectFrom([f.root, f.shard], encode(new Constr(2, [])))
    .mintAssets(
      { [f.shardUnit]: -1n },
      encode(new Constr(1, [f.channelId, f.denom, siblings])),
    )
    .pay.ToContract(f.root.address, {
      kind: "inline",
      value: encode(record(EMPTY_ROOT)),
    }, f.root.assets)
    .pay.ToAddress(f.account.address, { lovelace: f.shard.assets.lovelace })
    .withdraw(recovery.address, 0n, withdrawal)
    .addSignerKey(f.hostDatum.deployer).validFrom(f.emulator.now());
  await assertRejects(() => tx.complete({ localUPLCEval: true }));
});

Deno.test("shutdown rejects outstanding channel packets before reclaiming dependencies", async () => {
  const f = await fixture();
  const raw = Data.from(f.channel.datum!);
  const state = datumFields(datumFields(raw, 3)[0], 9);
  state[4] = new Map([[1n, "00".repeat(32)]]);
  f.channel.datum = encode(raw);
  const groups = await scanDeploymentState(f.lucid, f.deployment);
  assertThrows(
    () => assertStateDrained(groups, f.deployment),
    Error,
    "unsettled packets",
  );
  const recovery = f.deployment.validators.recoverClient!;
  const policy = f.deployment.validators.mintChannelStt;
  const unit = Object.keys(f.channel.assets).find((unit) =>
    unit.startsWith(policy.scriptHash)
  )!;
  const tx = f.lucid.newTx()
    .readFrom([
      f.hostUtxo,
      f.deployment.validators.spendChannel.refUtxo,
      policy.refUtxo,
      recovery.refUtxo,
    ])
    .collectFrom([f.channel], encode(new Constr(10, [])))
    .mintAssets({ [unit]: -1n }, Data.void())
    .withdraw(recovery.address, 0n, encode(new Constr(1, [])))
    .pay.ToAddress(f.account.address, { lovelace: f.channel.assets.lovelace })
    .addSignerKey(f.hostDatum.deployer).validFrom(f.emulator.now());
  await assertRejects(() => tx.complete({ localUPLCEval: true }));
});
