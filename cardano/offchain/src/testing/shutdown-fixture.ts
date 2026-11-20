import { CHANNEL_OPERATION_NAMES } from "../migration-plan.ts";
import { plutusAddress, Registry } from "../../types/plutus/Migration.ts";
import { assertRejects } from "@std/assert";
import { loadCachedTendermintValidators } from "../tendermint-cache-validators.ts";
import { cacheRecord, cacheRecordData } from "../tendermint-cache.ts";
import { serialisePlutusData } from "../plutus_serialise.ts";
import { createHash } from "node:crypto";
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
  clientMode: "staged" | "cached" = "staged",
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
  const registryPolicy = hash("f0");
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
      typeof parameter === "bigint"
        ? Data.Integer()
        : Array.isArray(parameter)
        ? Data.Array(Data.Bytes())
        : typeof parameter === "string"
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
  const recoverClient = validator(
    "governance_recover_client.governance_recover_client.withdraw",
    [
      hostPolicy,
      "00".repeat(28),
      registryPolicy,
    ],
  );
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
  const updateClient = validator(
    "update_staged_client.update_staged_client.withdraw",
    [
      hostPolicy,
      mintTendermintUpdateSession.scriptHash,
      recoverClient.scriptHash,
    ],
  );
  updateClient.address = validatorToRewardAddress("Custom", {
    type: "PlutusV3",
    script: updateClient.script,
  });
  const cachedScripts = clientMode === "cached"
    ? loadCachedTendermintValidators(
      lucid,
      hostPolicy,
      recoverClient.scriptHash,
      registryPolicy,
    )
    : undefined;
  const described = (tuple: [Script, string, string], title: string) => ({
    title,
    script: tuple[0].script,
    scriptHash: tuple[1],
    address: tuple[2],
    refUtxo: reference(tuple[0]),
  });
  const cached = cachedScripts
    ? {
      cacheSpend: described(
        cachedScripts.cacheSpend,
        "upgradeable/validator_cache.validator_cache.spend",
      ),
      cacheMint: described(
        cachedScripts.cacheMint,
        "minting_validator_cache.mint_validator_cache.mint",
      ),
    }
    : undefined;
  const cachedWithdrawalValidators = cachedScripts
    ? Object.fromEntries(
      cachedScripts.withdrawalScripts.map((entry, index) => [
        ["update", "updateCore", "generalUpdateCore", "stagedUpdate"][index],
        entry.scriptHash === updateClient.scriptHash ? updateClient : {
          title: entry.title,
          script: entry.validator.script,
          scriptHash: entry.scriptHash,
          address: entry.address,
          refUtxo: reference(entry.validator),
        },
      ]),
    )
    : undefined;
  const spendClient = cachedScripts
    ? described(
      cachedScripts.clientSpend,
      "upgradeable/cached_client.cached_client.spend",
    )
    : validator("upgradeable/client.client.spend", [
      registryPolicy,
      1n,
      hostPolicy,
      updateClient.scriptHash,
      { Script: [recoverClient.scriptHash] },
    ]);
  const mintClientStt = cachedScripts
    ? described(
      cachedScripts.clientMint,
      "upgradeable/mint_cached_client.mint_cached_client.mint",
    )
    : validator("upgradeable/mint_client.mint_client.mint", [registryPolicy]);
  const spendConnection = validator("upgradeable/connection.connection.spend", [
    registryPolicy,
    1n,
    hostPolicy,
    mintClientStt.scriptHash,
    hash("55"),
  ]);
  const mintConnectionStt = validator(
    "upgradeable/mint_connection.mint_connection.mint",
    [registryPolicy, hash("55")],
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
    hash("ba"),
  );
  const spendChannel = validator("upgradeable/channel.channel.spend", [
    registryPolicy,
    1n,
    hostPolicy,
    CHANNEL_OPERATION_NAMES.map((name) => channels.referredScripts[name].hash),
    hash("ba"),
  ]);
  const mintChannelStt = validator(
    "upgradeable/mint_channel.mint_channel.mint",
    [registryPolicy, mintPort.scriptHash, hash("55"), recoverClient.scriptHash],
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
    { policy_id: hostPolicy, name: fromText("ibc_packet_config") },
  ]);
  const mintTransferEscrowShard = validator(
    "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
    [portToken, hostPolicy],
  );
  const spendTransferModule = validator("upgradeable/transfer.transfer.spend", [
    registryPolicy,
    1n,
    hostPolicy,
    mintChannelStt.scriptHash,
    mintTransferEscrowShard.scriptHash,
    portToken,
    moduleToken,
    mintVoucher.scriptHash,
    recoverClient.scriptHash,
  ]);
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
  const governanceAuthority = validator(
    "governance_authority.governance_authority.withdraw",
    [registryPolicy],
  );
  governanceAuthority.address = validatorToRewardAddress("Custom", {
    type: "PlutusV3",
    script: governanceAuthority.script,
  });
  const [hostScript, hostHash, hostAddress] = readValidator(
    "upgradeable/host_state.host_state.spend",
    lucid,
    [
      registryPolicy,
      1n,
      record(0n, 86_400_000n),
      governanceAuthority.scriptHash,
      hostPolicy,
    ],
  );
  const host = {
    title: "upgradeable/host_state.host_state.spend",
    script: hostScript.script,
    scriptHash: hostHash,
    address: hostAddress,
    refUtxo: reference(hostScript),
  };
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
      live_clients: 1n,
      live_connections: 1n,
      live_channels: 1n,
      last_heartbeat_time: 0n,
    },
  };
  const hostUtxo = seed(host.address, {
    lovelace: 5_000_000n,
    [hostPolicy + fromText("ibc_host_state")]: 1n,
  }, Data.to(hostDatum, HostStateDatum));
  const deployment = {
    ...(cached && cachedWithdrawalValidators
      ? {
        cachedTendermint: {
          format: "authenticated-validator-cache-v1",
          validators: {
            ...cachedWithdrawalValidators,
            cacheSpend: cached.cacheSpend,
            cacheMint: cached.cacheMint,
          },
        },
      }
      : {}),
    validators: {
      updateClient,
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

  const registryToken = {
    policy_id: registryPolicy,
    name: fromText("ibc_implementation_registry"),
  };
  const addresses = [
    host.address,
    spendClient.address,
    spendConnection.address,
    spendChannel.address,
    spendTransferModule.address,
  ];
  const registry: Registry = {
    token: registryToken,
    host_policy: hostPolicy,
    identity: {
      client_policy: mintClientStt.scriptHash,
      connection_policy: mintConnectionStt.scriptHash,
      channel_policy: mintChannelStt.scriptHash,
      escrow_policy: mintTransferEscrowShard.scriptHash,
      reference_holder: plutusAddress(referenceAccount.address),
    },
    governance: { signers: [deployer], quorum: 1n, delay_ms: 86_400_000n },
    nonce: 0n,
    current: {
      generation: 1n,
      addresses: addresses.map(plutusAddress),
      compatibility: "00".repeat(32),
    },
    phase: "Ready",
    emergency: {
      authority: { signers: [hash("ee")], quorum: 1n },
      epoch: 0n,
      mask: 0n,
      restoration: null,
    },
    approval_authority: governanceAuthority.scriptHash,
  };
  const registryUnit = registryToken.policy_id + registryToken.name;
  const registryUtxo = seed(referenceAccount.address, {
    lovelace: 10_000_000n,
    [registryUnit]: 1n,
  }, Data.to(registry, Registry));
  deployment.migration = {
    profile: "cardano-ibc-compatible-v6",
    registryUnit,
    registryAddress: registryUtxo.address,
    registryReference: registryUtxo,
    registryDatum: registryUtxo.datum!,
    generation: "1",
    compatibility: registry.current.compatibility,
    originalAddresses: addresses,
    governanceAuthority,
    baseline: {},
    lineage: [],
  };
  emulator.chain[governanceAuthority.address] = {
    registeredStake: true,
    delegation: { poolId: null, rewards: 0n },
  };

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
      0n,
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
    new Constr(0, [new Constr(1, []), new Constr(1, []), 0n]),
  );
  const channel = seed(
    spendChannel.address,
    stateValue(mintChannelStt.scriptHash, "10".repeat(24) + "30"),
    encode(
      record(
        channelState,
        fromText("transfer"),
        token(mintChannelStt.scriptHash, "10".repeat(24) + "30"),
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
  const client = seed(
    spendClient.address,
    stateValue(mintClientStt.scriptHash, "11"),
    encode(record(
      clientState,
      token(mintClientStt.scriptHash, "11"),
      await history.getRoot(),
    )),
  );
  const clientToken = token(mintClientStt.scriptHash, "11");
  const cacheName = createHash("sha3-256").update(
    Buffer.from(serialisePlutusData(encode(clientToken)), "hex"),
  ).digest("hex");
  const cacheUnit = cached
    ? cached.cacheMint.scriptHash + cacheName
    : undefined;
  const cache = cached
    ? seed(
      cached.cacheSpend.address,
      { lovelace: 5_000_000n, [cacheUnit!]: 1n },
      encode(record(
        token(cached.cacheMint.scriptHash, cacheName),
        clientToken,
        record(new Constr(1, [spendClient.scriptHash]), new Constr(1, [])),
        [cacheRecordData(
          cacheRecord([{ index: 0, pubkey: "ab".repeat(32), power: 1n }]),
        )],
      )),
    )
    : undefined;
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
  let registration = lucid.newTx();
  const stakingAddresses = new Set([
    recoverClient.address,
    updateClient.address,
    ...Object.values(cachedWithdrawalValidators ?? {}).map((entry) =>
      entry.address
    ),
  ]);
  for (const address of stakingAddresses) {
    registration = registration.register.Stake(address);
  }
  await submit(registration);
  const packetReferences = [
    seed(
      referenceAccount.address,
      {
        lovelace: 5_000_000n,
        [hash("ba") + fromText("ibc_packet_config")]: 1n,
      },
      encode(
        record(hash("bb"), hash("bc"), hash("bd"), 16n, hash("be"), hostPolicy),
      ),
    ),
    seed(referenceAccount.address, {
      lovelace: 5_000_000n,
      [hash("bb") + fromText("ibc_packet_registry")]: 1n,
    }, encode(record(0n))),
  ];
  return {
    cached,
    cache,
    cacheUnit,
    client,
    clientToken,
    packetReferences,
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
              : (f.deployment.validators.spendClient.title.includes(
                  "client.client",
                )
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
