import { assertRejects } from "@std/assert";
import { createCardanoScalusEvaluator } from "../scalus-evaluator.ts";
import { scanDeploymentState } from "../shutdown.ts";
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
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { blake2b } from "@noble/hashes/blake2b";
import { Buffer } from "node:buffer";
import { buildChannelValidators, DeploymentIbcTree } from "../deployment.ts";
import {
  type DeploymentTemplate,
  generatePortTokenName,
  readValidator,
} from "../utils.ts";
import { AuthTokenSchema, HostStateDatum } from "../../types/index.ts";
import { clientStateWithHistory } from "./shutdown-model.ts";
import {
  ConsensusHistoryCommitment,
  recordFromConstr,
} from "../consensus_history_commitment.ts";
const record = (...fields: Data[]) => new Constr(0, fields);
const encode = (data: Data) => Data.to(data);
const hash = (byte: string) => byte.repeat(28);
const EMPTY_ROOT = "00".repeat(32);

/** Assumed shutdown snapshot for isolated cleanup-policy tests, not a deployment history. */
export async function shutdownFixture(
  escrowAmount = 0n,
  clientMode: "legacy" | "staged" = "staged",
  shape = { history: 1, settledPackets: 0, extraLovelace: 0n },
) {
  const seedPhrase = "abandon ".repeat(11) + "about";
  const account = {
    seedPhrase,
    privateKey: "",
    address: walletFromSeed(seedPhrase, { network: "Custom" }).address,
    assets: { lovelace: 10_000_000_000n },
  };
  const referenceAccount = {
    address: walletFromSeed(
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
      { network: "Custom" },
    ).address,
  };
  const emulator = new Emulator([account]);
  emulator.time = 1_700_000_000_000;
  const lucid = await Lucid(emulator, "Custom", {
    evaluator: createCardanoScalusEvaluator(),
  });
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
  const spendTendermintUpdateSession = validator(
    "spending_tendermint_update_session.spend_tendermint_update_session.spend",
    [hostPolicy],
  );
  const mintTendermintUpdateSession = validator(
    "minting_tendermint_update_session.mint_tendermint_update_session.mint",
    [spendTendermintUpdateSession.scriptHash],
  );
  const spendClient = clientMode === "staged"
    ? validator("spending_multitx_client.spend_multitx_client.spend", [
      hostPolicy,
      mintTendermintUpdateSession.scriptHash,
      { Script: [recoverClient.scriptHash] },
    ])
    : validator("spending_client.spend_client.spend", [hostPolicy, {
      Script: [recoverClient.scriptHash],
    }]);
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
      spendTendermintUpdateSession,
      mintTendermintUpdateSession,
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
    lovelace: 5_000_000n + shape.extraLovelace,
    [policy + name]: 1n,
  });
  const channelState = record(
    record(
      new Constr(3, []),
      new Constr(1, []),
      record(fromText("transfer"), fromText("channel-0")),
      [fromText("connection-0")],
      fromText("ics20-1"),
    ),
    BigInt(shape.settledPackets + 1),
    1n,
    1n,
    new Map(),
    new Map(
      Array.from(
        { length: shape.settledPackets },
        (_, i) => [BigInt(i + 1), ""],
      ),
    ),
    new Map(
      Array.from(
        { length: shape.settledPackets },
        (_, i) => [BigInt(i + 1), "aa".repeat(32)],
      ),
    ),
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
  const clientState = clientStateWithHistory(
    Array.from({ length: shape.history }, (_, i) => i + 1),
    now,
    "11".repeat(32),
  ).state;
  const consensusStates = clientState.fields[1] as Map<Data, Data>;
  const processedTimes = clientState.fields[2] as Map<Data, Data>;
  const processedHeights = clientState.fields[3] as Map<Data, Data>;
  const history = new ConsensusHistoryCommitment();
  // Keep only the live tip in the datum; older checkpoints are committed by root.
  for (const [height, consensus] of [...consensusStates].slice(0, -1)) {
    history.append(recordFromConstr(record(
      token(mintClientStt.scriptHash, "11"),
      height,
      consensus,
      processedTimes.get(height)!,
      processedHeights.get(height)!,
    )));
    consensusStates.delete(height);
    processedTimes.delete(height);
    processedHeights.delete(height);
  }
  seed(
    spendClient.address,
    stateValue(mintClientStt.scriptHash, "11"),
    encode(record(
      clientState,
      token(mintClientStt.scriptHash, "11"),
      await history.getRoot(),
    )),
  );
  seed(
    spendConnection.address,
    stateValue(mintConnectionStt.scriptHash, "12"),
    encode(record(
      record(
        fromText("07-tendermint-0"),
        [record(fromText("1"), [
          fromText("ORDER_ORDERED"),
          fromText("ORDER_UNORDERED"),
        ])],
        new Constr(3, []),
        record(
          fromText("07-tendermint-1"),
          fromText("connection-0"),
          record(fromText("ibc")),
        ),
        0n,
      ),
      token(mintConnectionStt.scriptHash, "12"),
    )),
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
  }, encode(record(await tree.getRoot(), 0n)));
  const shard = seed(spendTransferModule.address, {
    lovelace: 5_000_000n + shape.extraLovelace + escrowAmount,
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

export type ClientReclaimMutation =
  | "active"
  | "grace-period"
  | "missing-authority"
  | "missing-burn"
  | "legacy-redeemer"
  | "wrong-refund";
export async function rejectClientReclaimMutation(
  f: Awaited<ReturnType<typeof shutdownFixture>>,
  mutation: ClientReclaimMutation,
) {
  const originalDatum = f.hostUtxo.datum;
  try {
    const group = (await scanDeploymentState(f.lucid, f.deployment)).find((
      { kind },
    ) => kind === "client")!;
    const client = group.utxos[0];
    const policy = f.deployment.validators.mintClientStt;
    const unit = Object.keys(client.assets).find((unit) =>
      unit.startsWith(policy.scriptHash)
    )!;
    if (mutation === "active") {
      f.hostUtxo.datum = Data.to({
        ...f.hostDatum,
        control: { ...f.hostDatum.control, shutdown: "Active" },
      }, HostStateDatum);
    }
    if (mutation === "grace-period") {
      f.hostUtxo.datum = Data.to({
        ...f.hostDatum,
        control: {
          ...f.hostDatum.control,
          shutdown: {
            ShuttingDown: {
              initiated_at: BigInt(f.now),
              grace_period_end: BigInt(f.now + 86_400_000),
            },
          },
        },
      }, HostStateDatum);
    }
    const refundAddress = mutation === "wrong-refund"
      ? generateEmulatorAccount({}).address
      : f.account.address;
    const tx = f.lucid.newTx()
      .readFrom([f.hostUtxo, group.validator.refUtxo!, policy.refUtxo])
      .collectFrom(
        [client],
        encode(
          new Constr(
            mutation === "legacy-redeemer"
              ? 2
              : (f.deployment.validators.spendClient.title.includes("multitx")
                ? 4
                : 2),
            [],
          ),
        ),
      )
      .pay.ToAddress(refundAddress, { lovelace: client.assets.lovelace })
      .validFrom(f.now).validTo(f.now + 600_000);
    if (mutation !== "missing-burn") {
      tx.mintAssets({ [unit]: -1n }, Data.void());
    }
    if (mutation !== "missing-authority") tx.addSignerKey(f.hostDatum.deployer);
    await assertRejects(
      () => tx.complete({ localUPLCEval: true, changeAddress: refundAddress }),
      Error,
      "failed script execution",
    );
  } finally {
    f.hostUtxo.datum = originalDatum;
  }
}
