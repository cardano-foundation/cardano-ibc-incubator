import { ensureDir } from "@std/fs";
import {
  Constr,
  Data,
  fromText,
  LucidEvolution,
  type MintingPolicy,
  PolicyId,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  awaitWalletTx,
  DeploymentTemplate,
  formatTimestamp,
  generateIdentifierTokenName,
  generateTokenName,
  getLiveWalletUtxos,
  isRetryableOgmiosTransportError,
  readValidator,
  submitTx,
} from "./utils.ts";
import {
  DEPLOYMENT_NONCE_SPLIT_AMOUNT,
  EMULATOR_ENV,
  ICQ_MODULE_PORT,
  MOCK_MODULE_PORT,
  PORT_PREFIX,
  RESERVED_DEPLOYMENT_NONCE_COUNT,
  TRACE_REGISTRY_DIRECTORY_NONCE_COUNT,
  TRACE_REGISTRY_SHARD_COUNT,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";
import {
  AuthToken,
  AuthTokenSchema,
  HostStateDatum,
  HostStateRedeemer,
  MintPortRedeemer,
  OutputReference,
  OutputReferenceSchema,
  type TraceRegistryDirectoryDatum,
  type TraceRegistryShardDatum,
} from "../types/index.ts";

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};

const buildOutputReference = (utxo: UTxO): OutputReference => ({
  transaction_id: utxo.txHash,
  output_index: BigInt(utxo.outputIndex),
});

const encodeRawDatum = (value: unknown): string =>
  // Lucid's generic `Data.to` typings are schema-oriented, so manually
  // constructed nested `Constr` values need a small cast even though the
  // runtime encoding is correct and validated by the on-chain tests.
  Data.to(value as never, undefined as never, { canonical: true });

const MERKLE_DEPTH_BITS = 64;
const EMPTY_HASH = "00".repeat(32);

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex length ${hex.length}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
};

const leafHash = async (valueHex: string): Promise<string> => {
  if (valueHex.length === 0) return EMPTY_HASH;
  const valueHash = await sha256Hex(hexToBytes(valueHex));
  return sha256Hex(concatBytes(new Uint8Array([0]), hexToBytes(valueHash)));
};

const innerHash = (left: string, right: string): Promise<string> => {
  if (left === EMPTY_HASH && right === EMPTY_HASH) {
    return Promise.resolve(EMPTY_HASH);
  }
  return sha256Hex(
    concatBytes(new Uint8Array([1]), hexToBytes(left), hexToBytes(right)),
  );
};

const keyIndex64 = async (key: string): Promise<bigint> => {
  const hash = await sha256Hex(new TextEncoder().encode(key));
  return BigInt(`0x${hash.slice(0, 16)}`);
};

class DeploymentIbcTree {
  private leaves = new Map<string, string>();
  private root = EMPTY_HASH;
  private dirty = true;
  private nodesByHeight: Array<Map<bigint, string>> = [];

  set(key: string, valueHex: string): void {
    if (valueHex.length === 0) {
      this.leaves.delete(key);
    } else {
      this.leaves.set(key, valueHex);
    }
    this.dirty = true;
  }

  async getRoot(): Promise<string> {
    await this.rebuildIfNeeded();
    return this.root;
  }

  async getSiblings(key: string): Promise<string[]> {
    await this.rebuildIfNeeded();
    const siblings: string[] = [];
    let index = await keyIndex64(key);

    for (let height = 0; height < MERKLE_DEPTH_BITS; height++) {
      const siblingIndex = index ^ 1n;
      siblings.push(this.nodesByHeight[height].get(siblingIndex) ?? EMPTY_HASH);
      index >>= 1n;
    }

    return siblings;
  }

  private async rebuildIfNeeded(): Promise<void> {
    if (!this.dirty) return;

    const nodesByHeight = Array.from(
      { length: MERKLE_DEPTH_BITS + 1 },
      () => new Map<bigint, string>(),
    );

    for (const [key, value] of this.leaves.entries()) {
      nodesByHeight[0].set(await keyIndex64(key), await leafHash(value));
    }

    for (let height = 0; height < MERKLE_DEPTH_BITS; height++) {
      const currentLevel = nodesByHeight[height];
      const parentLevel = nodesByHeight[height + 1];
      const parentIndexes = new Set<bigint>();

      for (const index of currentLevel.keys()) {
        parentIndexes.add(index >> 1n);
      }

      for (const parentIndex of parentIndexes) {
        const left = currentLevel.get(parentIndex << 1n) ?? EMPTY_HASH;
        const right = currentLevel.get((parentIndex << 1n) | 1n) ?? EMPTY_HASH;
        const parentHash = await innerHash(left, right);
        if (parentHash !== EMPTY_HASH) parentLevel.set(parentIndex, parentHash);
      }
    }

    this.nodesByHeight = nodesByHeight;
    this.root = nodesByHeight[MERKLE_DEPTH_BITS].get(0n) ?? EMPTY_HASH;
    this.dirty = false;
  }
}

const portCommitmentKey = (portNumber: bigint): string =>
  `ports/port-${portNumber.toString()}`;

const buildBindPortHostStateUpdate = async (
  currentDatum: HostStateDatum,
  portNumber: bigint,
  tree: DeploymentIbcTree,
): Promise<{
  redeemer: HostStateRedeemer;
  datum: HostStateDatum;
  commit: () => void;
}> => {
  const portKey = portCommitmentKey(portNumber);
  const portSiblings = await tree.getSiblings(portKey);
  const portValue = Data.to(portNumber as never, Data.Integer() as never, {
    canonical: true,
  });
  tree.set(portKey, portValue);
  const newRoot = await tree.getRoot();
  const updatedDatum: HostStateDatum = {
    ...currentDatum,
    state: {
      ...currentDatum.state,
      version: currentDatum.state.version + 1n,
      ibc_state_root: newRoot,
      bound_port: sortPortNumbers([
        ...currentDatum.state.bound_port,
        portNumber,
      ]),
      last_update_time: BigInt(Date.now()),
    },
  };

  return {
    redeemer: { BindPort: { port: portNumber, port_siblings: portSiblings } },
    datum: updatedDatum,
    commit: () => {},
  };
};

export const createDeployment = async (
  lucid: LucidEvolution,
  mode?: string,
) => {
  console.log("Create deployment info");
  const referredValidators: Script[] = [];

  // The HostState NFT policy id depends on this nonce output reference, so the
  // same UTxO must later be spent by the mint transaction.
  let signerUtxos = await getLiveWalletUtxos(lucid);
  if (signerUtxos.length < 1) throw new Error("No UTXO found.");

  // Reserve enough wallet UTxOs up front for every deployment-only mint that
  // needs a unique OutputReference nonce. Re-querying "the first wallet UTxO"
  // between sequential mints is fragile on local devnets because the indexer can
  // momentarily lag behind the just-submitted transaction set.
  if (signerUtxos.length < RESERVED_DEPLOYMENT_NONCE_COUNT) {
    const address = await lucid.wallet().address();
    await submitTx(
      () => {
        const splitTx = lucid.newTx().collectFrom(signerUtxos);
        for (let index = 0; index < RESERVED_DEPLOYMENT_NONCE_COUNT; index++) {
          splitTx.pay.ToAddress(address, {
            lovelace: DEPLOYMENT_NONCE_SPLIT_AMOUNT,
          });
        }
        return splitTx;
      },
      lucid,
      "SplitNonceUtxos",
      false,
    );
    signerUtxos = await getLiveWalletUtxos(
      lucid,
      RESERVED_DEPLOYMENT_NONCE_COUNT,
    );
  }

  // Prefer large UTxOs for these nonce inputs so Lucid doesn't need to auto-select
  // additional wallet inputs, which could accidentally spend the other nonce.
  const sortedUtxos = [...signerUtxos].sort((a, b) => {
    const aLovelace = a.assets.lovelace ?? 0n;
    const bLovelace = b.assets.lovelace ?? 0n;
    if (aLovelace === bLovelace) return 0;
    return aLovelace < bLovelace ? 1 : -1;
  });

  const reservedNonceUtxos = sortedUtxos.slice(
    0,
    RESERVED_DEPLOYMENT_NONCE_COUNT,
  );
  if (reservedNonceUtxos.length < RESERVED_DEPLOYMENT_NONCE_COUNT) {
    throw new Error(
      `Not enough distinct wallet UTxOs to deploy (need at least ${RESERVED_DEPLOYMENT_NONCE_COUNT.toString()}).`,
    );
  }
  const [
    hostStateNonceUtxo,
    transferModuleNonceUtxo,
    ...remainingNonceUtxos
  ] = reservedNonceUtxos;
  const traceRegistryNonceUtxos = remainingNonceUtxos.slice(
    0,
    TRACE_REGISTRY_SHARD_COUNT + TRACE_REGISTRY_DIRECTORY_NONCE_COUNT,
  );
  const mockModuleNonceUtxo = remainingNonceUtxos.at(
    TRACE_REGISTRY_SHARD_COUNT + TRACE_REGISTRY_DIRECTORY_NONCE_COUNT,
  );
  const icqModuleNonceUtxo = remainingNonceUtxos.at(
    TRACE_REGISTRY_SHARD_COUNT + TRACE_REGISTRY_DIRECTORY_NONCE_COUNT + 1,
  );
  if (!mockModuleNonceUtxo || !icqModuleNonceUtxo) {
    throw new Error(
      "Missing reserved nonce UTxOs for generic module deployment.",
    );
  }

  const hostStateOutputReference: OutputReference = {
    transaction_id: hostStateNonceUtxo.txHash,
    output_index: BigInt(hostStateNonceUtxo.outputIndex),
  };

  const [mintHostStateNFTValidator, mintHostStateNFTPolicyId] =
    await readValidator(
      "host_state_nft.host_state_nft.mint",
      lucid,
      [hostStateOutputReference],
      Data.Tuple([OutputReferenceSchema]) as unknown as [OutputReference],
    );

  const [verifyProofValidator, verifyProofPolicyId] = await readValidator(
    "verifying_proof.verify_proof.mint",
    lucid,
  );
  referredValidators.push(verifyProofValidator);

  // load mint port validator
  const [mintPortValidator, mintPortPolicyId] = await readValidator(
    "minting_port.mint_port.mint",
    lucid,
    [mintHostStateNFTPolicyId],
    Data.Tuple([Data.Bytes()]) as unknown as [string],
  );

  // load spend client validator
  const [spendClientValidator, spendClientScriptHash, spendClientAddress] =
    await readValidator("spending_client.spend_client.spend", lucid, [
      mintHostStateNFTPolicyId,
    ]);
  referredValidators.push(spendClientValidator);

  // STT minting policies derive client/connection/channel token names from the
  // HostState NFT, keeping object-token authorization tied to the canonical mutex.

  // Load mint client STT validator (parameterized by spend_client_script_hash, host_state_nft_policy_id)
  const [mintClientSttValidator, mintClientSttPolicyId] = await readValidator(
    "minting_client_stt.mint_client_stt.mint",
    lucid,
    [spendClientScriptHash, mintHostStateNFTPolicyId],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  referredValidators.push(mintClientSttValidator);

  // load spend connection validator
  const [
    spendConnectionValidator,
    spendConnectionScriptHash,
    spendConnectionAddress,
  ] = await readValidator(
    "spending_connection.spend_connection.spend",
    lucid,
    [
      mintClientSttPolicyId,
      verifyProofPolicyId,
      mintHostStateNFTPolicyId,
    ],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [
      string,
      string,
      string,
    ],
  );
  referredValidators.push(spendConnectionValidator);

  // Load mint connection STT validator (parameterized by client_mint, verify_proof, spend_connection, host_state_nft hashes)
  const [mintConnectionSttValidator, mintConnectionSttPolicyId] =
    await readValidator(
      "minting_connection_stt.mint_connection_stt.mint",
      lucid,
      [
        mintClientSttPolicyId,
        verifyProofPolicyId,
        spendConnectionScriptHash,
        mintHostStateNFTPolicyId,
      ],
      Data.Tuple([
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
      ]) as unknown as [string, string, string, string],
    );
  referredValidators.push(mintConnectionSttValidator);

  // load spend channel validator
  const spendingChannel = await deploySpendChannel(
    lucid,
    mintClientSttPolicyId,
    mintConnectionSttPolicyId,
    mintPortPolicyId,
    verifyProofPolicyId,
    mintHostStateNFTPolicyId,
  );

  referredValidators.push(
    spendingChannel.base.script,
    ...Object.values(spendingChannel.referredScripts).map(
      (val) => val.script,
    ),
  );

  // Load mint channel STT validator (parameterized by client_mint, connection_mint, port_mint, verify_proof, spend_channel, host_state_nft hashes)
  const [mintChannelSttValidator, mintChannelSttPolicyId] = await readValidator(
    "minting_channel_stt.mint_channel_stt.mint",
    lucid,
    [
      mintClientSttPolicyId,
      mintConnectionSttPolicyId,
      mintPortPolicyId,
      verifyProofPolicyId,
      spendingChannel.base.hash,
      mintHostStateNFTPolicyId,
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ],
  );
  referredValidators.push(mintChannelSttValidator);

  // Deploy HostState (STT Architecture)
  const {
    hostStateStt,
    hostStateNFT,
  } = await deployHostState(
    lucid,
    hostStateNonceUtxo,
    hostStateOutputReference,
    mintHostStateNFTValidator,
    mintHostStateNFTPolicyId,
    spendClientScriptHash,
    spendConnectionScriptHash,
    spendingChannel.base.hash,
  );
  referredValidators.push(hostStateStt.validator);
  const hostStateTree = new DeploymentIbcTree();

  // load mint identifier validator
  const [mintIdentifierValidator] = await readValidator(
    "minting_identifier.minting_identifier.mint",
    lucid,
  );
  referredValidators.push(mintIdentifierValidator);
  const traceRegistryDirectoryNonce =
    traceRegistryNonceUtxos[TRACE_REGISTRY_SHARD_COUNT];
  if (!traceRegistryDirectoryNonce) {
    throw new Error(
      "Missing reserved nonce UTxO for trace registry directory.",
    );
  }
  const traceRegistryDirectoryAuthToken: AuthToken = {
    policy_id: validatorToScriptHash(mintIdentifierValidator),
    name: await generateIdentifierTokenName(
      buildOutputReference(traceRegistryDirectoryNonce),
    ),
  };

  const {
    identifierTokenUnit: transferModuleIdentifier,
    mintVoucher,
    voucherMetadata,
    spendTransferModule,
  } = await deployTransferModule(
    lucid,
    hostStateStt,
    hostStateTree,
    mintPortValidator,
    mintIdentifierValidator,
    mintChannelSttPolicyId,
    TRANSFER_MODULE_PORT,
    hostStateNFT,
    traceRegistryDirectoryAuthToken,
    transferModuleNonceUtxo,
  );
  referredValidators.push(
    mintVoucher.validator,
    spendTransferModule.validator,
  );
  const traceRegistryBenchmarkVoucher = await loadTraceRegistryBenchmarkVoucher(
    lucid,
  );
  if (traceRegistryBenchmarkVoucher) {
    referredValidators.push(traceRegistryBenchmarkVoucher.validator);
  }

  const traceRegistry = await deployTraceRegistry(
    lucid,
    mintIdentifierValidator,
    traceRegistryDirectoryAuthToken,
    mintVoucher.policyId,
    traceRegistryBenchmarkVoucher?.policyId ?? "",
    traceRegistryNonceUtxos,
  );
  // Bootstrap the registry with the bridge so voucher mints can rely on an
  // on-chain reverse mapping from the first deployment onward.
  referredValidators.push(traceRegistry.base.validator);

  const {
    identifierTokenUnit: mockModuleIdentifier,
    spendModule: spendMockModule,
  } = await deployGenericModule(
    lucid,
    hostStateStt,
    hostStateTree,
    mintPortValidator,
    mintIdentifierValidator,
    MOCK_MODULE_PORT,
    "mock",
    hostStateNFT,
    mockModuleNonceUtxo,
  );
  referredValidators.push(spendMockModule.validator);

  const {
    identifierTokenUnit: icqModuleIdentifier,
    spendModule: spendIcqModule,
  } = await deployGenericModule(
    lucid,
    hostStateStt,
    hostStateTree,
    mintPortValidator,
    mintIdentifierValidator,
    ICQ_MODULE_PORT,
    "icqhost",
    hostStateNFT,
    icqModuleNonceUtxo,
  );
  referredValidators.push(spendIcqModule.validator);

  // Only publish the runtime/bootstrap reference surface eagerly.
  // Deployment-only mint scripts still participate in bootstrap transactions,
  // but they do not need standalone public reference UTxOs once the bridge is live.
  const refUtxosInfo = await createReferenceUtxos(
    lucid,
    referredValidators,
  );

  const [mockTokenPolicyId, mockTokenName] = await mintMockToken(lucid);

  const spendChannelRefValidator = Object.entries(
    spendingChannel.referredScripts,
  ).reduce<
    Record<string, { script: string; scriptHash: string; refUtxo: UTxO }>
  >((acc, [name, val]) => {
    acc[name] = {
      script: val.script.script,
      scriptHash: val.hash,
      refUtxo: refUtxosInfo[val.hash],
    };

    return acc;
  }, {});

  console.log("Deployment info created!");

  const deployedAt = new Date().toISOString();

  const deploymentInfo: DeploymentTemplate = {
    deployedAt,
    validators: {
      spendClient: {
        title: "spending_client.spend_client.spend",
        script: spendClientValidator.script,
        scriptHash: spendClientScriptHash,
        address: spendClientAddress,
        refUtxo: refUtxosInfo[spendClientScriptHash],
      },
      spendConnection: {
        title: "spending_connection.spend_connection.spend",
        script: spendConnectionValidator.script,
        scriptHash: spendConnectionScriptHash,
        address: spendConnectionAddress,
        refUtxo: refUtxosInfo[spendConnectionScriptHash],
      },
      spendChannel: {
        title: "spending_channel.spend_channel.spend",
        script: spendingChannel.base.script.script,
        scriptHash: spendingChannel.base.hash,
        address: spendingChannel.base.address,
        refUtxo: refUtxosInfo[spendingChannel.base.hash],
        refValidator: spendChannelRefValidator,
      },
      spendTransferModule: {
        title: "spending_transfer_module.spend_transfer_module.spend",
        script: spendTransferModule.validator.script,
        scriptHash: spendTransferModule.scriptHash,
        address: spendTransferModule.address,
        refUtxo: refUtxosInfo[spendTransferModule.scriptHash],
      },
      spendMockModule: {
        title: "spending_mock_module.spend_mock_module.else",
        script: spendMockModule.validator.script,
        scriptHash: spendMockModule.scriptHash,
        address: spendMockModule.address,
        refUtxo: refUtxosInfo[spendMockModule.scriptHash],
      },
      mintIdentifier: {
        title: "minting_identifier.minting_identifier.mint",
        script: mintIdentifierValidator.script,
        scriptHash: validatorToScriptHash(mintIdentifierValidator),
        address: "",
        refUtxo: refUtxosInfo[validatorToScriptHash(mintIdentifierValidator)],
      },
      spendTraceRegistry: {
        title: "trace_registry.spend_trace_registry.spend",
        script: traceRegistry.base.validator.script,
        scriptHash: traceRegistry.base.scriptHash,
        address: traceRegistry.base.address,
        refUtxo: refUtxosInfo[traceRegistry.base.scriptHash],
      },
      mintVoucher: {
        title: "minting_voucher.mint_voucher.mint",
        script: mintVoucher.validator.script,
        scriptHash: mintVoucher.policyId,
        address: "",
        refUtxo: refUtxosInfo[mintVoucher.policyId],
      },
      voucherMetadata: {
        address: voucherMetadata.address,
      },
      ...(traceRegistryBenchmarkVoucher
        ? {
          mintTraceRegistryBenchmarkVoucher: {
            title:
              "minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint",
            script: traceRegistryBenchmarkVoucher.validator.script,
            scriptHash: traceRegistryBenchmarkVoucher.policyId,
            address: "",
            refUtxo: refUtxosInfo[traceRegistryBenchmarkVoucher.policyId],
          },
        }
        : {}),
      verifyProof: {
        title: "verifying_proof.verify_proof.mint",
        script: verifyProofValidator.script,
        scriptHash: verifyProofPolicyId,
        address: "",
        refUtxo: refUtxosInfo[verifyProofPolicyId],
      },
      hostStateStt: {
        title: "host_state_stt.host_state_stt.spend",
        script: hostStateStt.validator.script,
        scriptHash: hostStateStt.scriptHash,
        address: hostStateStt.address,
        refUtxo: refUtxosInfo[hostStateStt.scriptHash],
      },
      mintClientStt: {
        title: "minting_client_stt.mint_client_stt.mint",
        script: mintClientSttValidator.script,
        scriptHash: mintClientSttPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintClientSttPolicyId],
      },
      mintConnectionStt: {
        title: "minting_connection_stt.mint_connection_stt.mint",
        script: mintConnectionSttValidator.script,
        scriptHash: mintConnectionSttPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintConnectionSttPolicyId],
      },
      mintChannelStt: {
        title: "minting_channel_stt.mint_channel_stt.mint",
        script: mintChannelSttValidator.script,
        scriptHash: mintChannelSttPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintChannelSttPolicyId],
      },
    },
    hostStateNFT: {
      policyId: hostStateNFT.policy_id,
      name: hostStateNFT.name,
    },
    traceRegistry: {
      address: traceRegistry.base.address,
      shardPolicyId: traceRegistry.shardPolicyId,
      directory: {
        policyId: traceRegistry.directory.policy_id,
        name: traceRegistry.directory.name,
      },
    },
    modules: {
      transfer: {
        identifier: transferModuleIdentifier,
        address: spendTransferModule.address,
      },
      mock: {
        identifier: mockModuleIdentifier,
        address: spendMockModule.address,
      },
      icq: {
        identifier: icqModuleIdentifier,
        address: spendIcqModule.address,
      },
    },
    tokens: {
      mock: mockTokenPolicyId + mockTokenName,
    },
  };

  if (mode !== undefined && mode != EMULATOR_ENV) {
    const jsonConfig = JSON.stringify(deploymentInfo);

    const folder = "./deployments";
    await ensureDir(folder);

    const filePath = folder + "/handler_" +
      formatTimestamp(Date.parse(deployedAt)) + ".json";

    await Deno.writeTextFile(filePath, jsonConfig);
    await Deno.writeTextFile(folder + "/handler.json", jsonConfig);
    console.log("Deploy info saved to:", filePath);
  }

  return deploymentInfo;
};

const REFERENCE_UTXO_TX_OVERHEAD_BYTES = 4_000;
const REFERENCE_UTXO_OUTPUT_OVERHEAD_BYTES = 200;

type ReferenceValidatorBatch = {
  validators: Script[];
  startIndex: number;
};

const estimateReferenceValidatorSize = (validator: Script): number =>
  validator.script.length / 2 + REFERENCE_UTXO_OUTPUT_OVERHEAD_BYTES;

export const buildReferenceValidatorBatches = (
  validators: Script[],
  maxTxSize: number,
): ReferenceValidatorBatch[] => {
  const batches: ReferenceValidatorBatch[] = [];
  // Keep a small fixed overhead aside so we batch optimistically up front
  // without relying on the full Lucid builder for every split decision.
  const payloadBudget = Math.max(
    1,
    maxTxSize - REFERENCE_UTXO_TX_OVERHEAD_BYTES,
  );

  let currentBatch: Script[] = [];
  let currentBatchBytes = 0;
  let currentStartIndex = 0;

  validators.forEach((validator, index) => {
    const estimatedValidatorBytes = estimateReferenceValidatorSize(validator);
    const wouldOverflow = currentBatch.length > 0 &&
      currentBatchBytes + estimatedValidatorBytes > payloadBudget;

    if (wouldOverflow) {
      batches.push({
        validators: currentBatch,
        startIndex: currentStartIndex,
      });
      currentBatch = [validator];
      currentBatchBytes = estimatedValidatorBytes;
      currentStartIndex = index;
      return;
    }

    if (currentBatch.length === 0) {
      currentStartIndex = index;
    }

    currentBatch.push(validator);
    currentBatchBytes += estimatedValidatorBytes;
  });

  if (currentBatch.length > 0) {
    batches.push({
      validators: currentBatch,
      startIndex: currentStartIndex,
    });
  }

  return batches;
};

const isLikelyReferenceBatchTooLarge = (error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = errorMessage.toLowerCase();

  return [
    "max transaction size",
    "maximum transaction size",
    "transaction too large",
    "max tx size",
    "tx too large",
    "maximum value size exceeded",
    "maximum transaction size exceeded",
  ].some((pattern) => normalizedMessage.includes(pattern));
};

const sortPortNumbers = (ports: bigint[]) =>
  [...ports].sort((left, right) => {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  });

async function mintMockToken(lucid: LucidEvolution) {
  // load mint mock token validator
  const [mintMockTokenValidator, mintMockTokenPolicyId] = await readValidator(
    "minting_mock_token.mint_mock_token.mint",
    lucid,
  );

  const tokenName = fromText("mock");

  const tokenUnit = mintMockTokenPolicyId + tokenName;

  const walletAddress = await lucid.wallet().address();

  await submitTx(
    () =>
      lucid
        .newTx()
        .attach.MintingPolicy(mintMockTokenValidator)
        .mintAssets(
          {
            [tokenUnit]: 9999999999n,
          },
          Data.void(),
        )
        .pay.ToAddress(
          walletAddress,
          {
            [tokenUnit]: 999999999n,
          },
        ),
    lucid,
    "Mint mock token",
  );

  return [mintMockTokenPolicyId, tokenName];
}

async function createReferenceUtxos(
  lucid: LucidEvolution,
  referredValidators: Script[],
) {
  try {
    console.log("Create reference utxos starting ...");

    const [, , referenceAddress] = await readValidator(
      "reference_validator.refer_only.else",
      lucid,
    );

    const maxTxSize = lucid.config().protocolParameters?.maxTxSize ?? 16_384;
    const initialBatches = buildReferenceValidatorBatches(
      referredValidators,
      maxTxSize,
    );

    console.log(
      "Submitting",
      initialBatches.length,
      "reference transactions for",
      referredValidators.length,
      "validators ...",
    );

    const result: { [x: string]: UTxO } = {};

    const pendingBatches = [...initialBatches];

    while (pendingBatches.length > 0) {
      // We still submit sequentially because each successful batch updates the
      // wallet UTxO set used to build the next one.
      const batch = pendingBatches.shift()!;
      console.log(
        "Preparing reference batch for validators",
        `${batch.startIndex + 1}-${batch.startIndex + batch.validators.length}`,
        `(${batch.validators.length} validators) ...`,
      );

      const buildReferenceBatchTx = () => {
        let tx = lucid.newTx();
        for (const validator of batch.validators) {
          tx = tx.pay.ToContract(
            referenceAddress,
            {
              kind: "inline",
              value: Data.void(),
            },
            { lovelace: 1_000_000n },
            validator,
          );
        }
        return tx;
      };

      let newWalletUTxOs: UTxO[] | undefined;
      let derivedOutputs: UTxO[] | undefined;
      let signedTx;
      let splitBatch = false;
      let lastBuildError: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          [newWalletUTxOs, derivedOutputs, signedTx] = await (async () => {
            const [walletUTxOs, outputs, txSignBuilder] =
              await buildReferenceBatchTx().chain();
            return [
              walletUTxOs,
              outputs,
              await txSignBuilder.sign.withWallet().complete(),
            ] as const;
          })();
          lastBuildError = null;
          break;
        } catch (error) {
          lastBuildError = error;
          if (
            batch.validators.length > 1 &&
            isLikelyReferenceBatchTooLarge(error)
          ) {
            // The coarse size estimate can still under-shoot once fees/change are
            // fully materialized, so split and retry instead of failing the whole deploy.
            const midpoint = Math.ceil(batch.validators.length / 2);
            console.warn(
              `Reference batch ${batch.startIndex + 1}-${
                batch.startIndex + batch.validators.length
              } exceeded the transaction size budget; splitting into batches of ${midpoint} and ${
                batch.validators.length - midpoint
              }.`,
            );
            pendingBatches.unshift(
              {
                validators: batch.validators.slice(midpoint),
                startIndex: batch.startIndex + midpoint,
              },
              {
                validators: batch.validators.slice(0, midpoint),
                startIndex: batch.startIndex,
              },
            );
            splitBatch = true;
            break;
          }
          if (!isRetryableOgmiosTransportError(error) || attempt === 5) {
            throw error;
          }
          console.warn(
            `createReferenceUtxos build retry ${attempt}/5 after transient Ogmios transport error:`,
            error,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (splitBatch) {
        continue;
      }
      if (!newWalletUTxOs || !derivedOutputs || !signedTx) {
        throw lastBuildError ??
          new Error("Failed to build reference batch transaction");
      }

      const txHash = signedTx.toHash();
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const submittedHash = await signedTx.submit();
          if (submittedHash !== txHash) {
            throw new Error(
              `Provider returned tx hash ${submittedHash}, but signed body hash is ${txHash}`,
            );
          }
        } catch (error) {
          console.warn(
            `createReferenceUtxos submit retry ${attempt}/6 after error:`,
            error,
          );
        }

        try {
          await awaitWalletTx(lucid, txHash, 1000, 30000);
          lucid.overrideUTxOs(newWalletUTxOs);
          break;
        } catch (error) {
          lastBuildError = error;
          if (
            batch.validators.length > 1 &&
            isLikelyReferenceBatchTooLarge(error)
          ) {
            // The coarse size estimate can still under-shoot once fees/change are
            // fully materialized, so split and retry instead of failing the whole deploy.
            const midpoint = Math.ceil(batch.validators.length / 2);
            console.warn(
              `Reference batch ${batch.startIndex + 1}-${
                batch.startIndex + batch.validators.length
              } exceeded the transaction size budget; splitting into batches of ${midpoint} and ${
                batch.validators.length - midpoint
              }.`,
            );
            pendingBatches.unshift(
              {
                validators: batch.validators.slice(midpoint),
                startIndex: batch.startIndex + midpoint,
              },
              {
                validators: batch.validators.slice(0, midpoint),
                startIndex: batch.startIndex,
              },
            );
            splitBatch = true;
            break;
          }
          if (!isRetryableOgmiosTransportError(error) || attempt === 5) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (splitBatch) {
        continue;
      }
      if (!newWalletUTxOs || !derivedOutputs || !signedTx) {
        throw lastBuildError ??
          new Error("Failed to build reference batch transaction");
      }

      console.log(
        "Submitted reference batch",
        `${batch.startIndex + 1}-${
          batch.startIndex + batch.validators.length
        }:`,
        txHash,
      );

      for (const output of derivedOutputs) {
        if (!output.scriptRef) {
          continue;
        }
        const scriptHash = validatorToScriptHash(output.scriptRef);
        result[scriptHash] = output;
      }
    }

    return result;
  } catch (error) {
    console.error("createReferenceUtxos ERR: ", error);
    throw error;
  }
}

const deployTransferModule = async (
  lucid: LucidEvolution,
  hostStateStt: {
    validator: SpendingValidator;
    scriptHash: ScriptHash;
    address: string;
  },
  hostStateTree: DeploymentIbcTree,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  mintChannelPolicyId: string,
  portNumber: bigint,
  hostStateNFT: AuthToken,
  traceRegistryDirectoryAuthToken: AuthToken,
  nonceUtxo: UTxO,
) => {
  console.log("Create Transfer Module");

  // generate identifier token
  const outputReference = buildOutputReference(nonceUtxo);
  const mintIdentifierPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const identifierTokenName = await generateIdentifierTokenName(
    outputReference,
  );
  const identifierToken: AuthToken = {
    policy_id: mintIdentifierPolicyId,
    name: identifierTokenName,
  };
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;
  const [, voucherMetadataScriptHash, voucherMetadataAddress] =
    await readValidator(
      "voucher_metadata.voucher_metadata.else",
      lucid,
    );
  const [mintVoucherValidator, mintVoucherPolicyId] = await readValidator(
    "minting_voucher.mint_voucher.mint",
    lucid,
    [
      identifierToken,
      traceRegistryDirectoryAuthToken,
      voucherMetadataScriptHash,
    ],
    Data.Tuple([AuthTokenSchema, AuthTokenSchema, Data.Bytes()]) as unknown as [
      AuthToken,
      AuthToken,
      string,
    ],
  );

  // NOTE: IBC port identifiers are part of on-chain commitment paths and are exchanged
  // over IBC. For the transfer module we use the canonical Cosmos port ID so Hermes can
  // operate without any Cardano-specific port mapping.
  const portId = fromText("transfer");
  const mintPortPolicyId = validatorToScriptHash(mintPortValidator);
  const portTokenName = await generateTokenName(
    hostStateNFT,
    PORT_PREFIX,
    portNumber,
  );
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const portToken: AuthToken = {
    policy_id: mintPortPolicyId,
    name: portTokenName,
  };

  const [
    spendTransferModuleValidator,
    spendTransferModuleScriptHash,
    spendTransferModuleAddress,
  ] = await readValidator(
    "spending_transfer_module.spend_transfer_module.spend",
    lucid,
    [
      portToken,
      identifierToken,
      portId,
      mintChannelPolicyId,
      mintVoucherPolicyId,
      hostStateNFT.policy_id,
    ],
    Data.Tuple([
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [
      AuthToken,
      AuthToken,
      string,
      string,
      string,
      string,
    ],
  );

  const hostStateUnit = hostStateNFT.policy_id + hostStateNFT.name;
  const hostStateUtxo = await lucid.utxoByUnit(hostStateUnit);
  const currentHostStateDatum = Data.from(hostStateUtxo.datum!, HostStateDatum);
  const hostStateUpdate = await buildBindPortHostStateUpdate(
    currentHostStateDatum,
    portNumber,
    hostStateTree,
  );

  const mintPortRedeemer: MintPortRedeemer = {
    spend_module_script_hash: spendTransferModuleScriptHash,
    port_number: portNumber,
  };

  await submitTx(
    () =>
      lucid
        .newTx()
        .collectFrom([nonceUtxo], Data.void())
        .collectFrom(
          [hostStateUtxo],
          Data.to(hostStateUpdate.redeemer, HostStateRedeemer, {
            canonical: true,
          }),
        )
        .attach.SpendingValidator(hostStateStt.validator)
        .attach.MintingPolicy(mintPortValidator)
        .mintAssets(
          {
            [portTokenUnit]: 1n,
          },
          Data.to(mintPortRedeemer, MintPortRedeemer, { canonical: true }),
        )
        .attach.MintingPolicy(mintIdentifierValidator)
        .mintAssets(
          {
            [identifierTokenUnit]: 1n,
          },
          Data.to(outputReference, OutputReference, { canonical: true }),
        )
        .pay.ToContract(
          hostStateStt.address,
          {
            kind: "inline",
            value: Data.to(hostStateUpdate.datum, HostStateDatum, {
              canonical: true,
            }),
          },
          {
            [hostStateUnit]: 1n,
          },
        )
        .pay.ToAddress(
          spendTransferModuleAddress,
          {
            [identifierTokenUnit]: 1n,
            [portTokenUnit]: 1n,
          },
        ),
    lucid,
    "Mint Transfer Module",
  );
  hostStateUpdate.commit();

  return {
    identifierTokenUnit,
    mintVoucher: {
      validator: mintVoucherValidator,
      policyId: mintVoucherPolicyId,
    },
    voucherMetadata: {
      address: voucherMetadataAddress,
    },
    spendTransferModule: {
      validator: spendTransferModuleValidator,
      scriptHash: spendTransferModuleScriptHash,
      address: spendTransferModuleAddress,
    },
  };
};

const deployGenericModule = async (
  lucid: LucidEvolution,
  hostStateStt: {
    validator: SpendingValidator;
    scriptHash: ScriptHash;
    address: string;
  },
  hostStateTree: DeploymentIbcTree,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  portNumber: bigint,
  portIdText: string,
  hostStateNFT: AuthToken,
  nonceUtxo: UTxO,
) => {
  console.log("Create Generic Module", portIdText);

  const outputReference = buildOutputReference(nonceUtxo);
  const mintIdentifierPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const identifierTokenName = await generateIdentifierTokenName(
    outputReference,
  );
  const identifierToken: AuthToken = {
    policy_id: mintIdentifierPolicyId,
    name: identifierTokenName,
  };
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;

  const portId = fromText(portIdText);
  const mintPortPolicyId = validatorToScriptHash(mintPortValidator);
  const portTokenName = await generateTokenName(
    hostStateNFT,
    PORT_PREFIX,
    portNumber,
  );
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const portToken: AuthToken = {
    policy_id: mintPortPolicyId,
    name: portTokenName,
  };

  const [
    spendModuleValidator,
    spendModuleScriptHash,
    spendModuleAddress,
  ] = await readValidator(
    "spending_mock_module.spend_mock_module.else",
    lucid,
  );

  const hostStateUnit = hostStateNFT.policy_id + hostStateNFT.name;
  const hostStateUtxo = await lucid.utxoByUnit(hostStateUnit);
  const currentHostStateDatum = Data.from(hostStateUtxo.datum!, HostStateDatum);
  const hostStateUpdate = await buildBindPortHostStateUpdate(
    currentHostStateDatum,
    portNumber,
    hostStateTree,
  );

  const mintPortRedeemer: MintPortRedeemer = {
    spend_module_script_hash: spendModuleScriptHash,
    port_number: portNumber,
  };

  await submitTx(
    () =>
      lucid
        .newTx()
        .collectFrom([nonceUtxo], Data.void())
        .collectFrom(
          [hostStateUtxo],
          Data.to(hostStateUpdate.redeemer, HostStateRedeemer, {
            canonical: true,
          }),
        )
        .attach.SpendingValidator(hostStateStt.validator)
        .attach.MintingPolicy(mintPortValidator)
        .mintAssets(
          {
            [portTokenUnit]: 1n,
          },
          Data.to(mintPortRedeemer, MintPortRedeemer, { canonical: true }),
        )
        .attach.MintingPolicy(mintIdentifierValidator)
        .mintAssets(
          {
            [identifierTokenUnit]: 1n,
          },
          Data.to(outputReference, OutputReference, { canonical: true }),
        )
        .pay.ToContract(
          hostStateStt.address,
          {
            kind: "inline",
            value: Data.to(hostStateUpdate.datum, HostStateDatum, {
              canonical: true,
            }),
          },
          {
            [hostStateUnit]: 1n,
          },
        )
        .pay.ToAddress(
          spendModuleAddress,
          {
            [identifierTokenUnit]: 1n,
            [portTokenUnit]: 1n,
          },
        ),
    lucid,
    `Mint ${portIdText} Module`,
  );
  hostStateUpdate.commit();

  return {
    identifierTokenUnit,
    spendModule: {
      validator: spendModuleValidator,
      scriptHash: spendModuleScriptHash,
      address: spendModuleAddress,
      portId,
      portToken,
      identifierToken,
    },
  };
};

const deployTraceRegistry = async (
  lucid: LucidEvolution,
  mintIdentifierValidator: MintingPolicy,
  directoryAuthToken: AuthToken,
  mintVoucherPolicyId: string,
  benchmarkVoucherPolicyId: string,
  nonceUtxos: UTxO[],
) => {
  console.log("Create Trace Registry");

  // Shards are keyed by the first four bits of the voucher hash. That keeps append
  // contention bounded instead of forcing every new voucher trace through one UTxO.
  // The registry is deployed alongside the bridge so voucher mint paths have the
  // canonical on-chain reverse-lookup state available immediately.
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  if (directoryAuthToken.policy_id !== shardPolicyId) {
    throw new Error(
      "Trace registry directory auth token policy does not match the shard policy.",
    );
  }
  const directoryNonce = nonceUtxos[TRACE_REGISTRY_SHARD_COUNT];
  if (!directoryNonce) {
    throw new Error(
      "Missing reserved nonce UTxO for trace registry directory.",
    );
  }
  const [validator, scriptHash, address] = await readValidator(
    "trace_registry.spend_trace_registry.spend",
    lucid,
    [
      shardPolicyId,
      directoryAuthToken,
      mintVoucherPolicyId,
      benchmarkVoucherPolicyId,
    ],
    Data.Tuple([
      Data.Bytes(),
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [
      string,
      AuthToken,
      string,
      string,
    ],
  );

  const shards: Array<{ index: bigint; token: AuthToken }> = [];
  for (
    let shardIndex = 0;
    shardIndex < TRACE_REGISTRY_SHARD_COUNT;
    shardIndex++
  ) {
    const shardNonce = nonceUtxos[shardIndex];
    if (!shardNonce) {
      throw new Error(
        `Missing reserved nonce UTxO for trace registry shard ${shardIndex.toString()}.`,
      );
    }
    const token = await deployTraceRegistryShard(
      lucid,
      mintIdentifierValidator,
      address,
      BigInt(shardIndex),
      shardNonce,
    );
    shards.push({
      index: BigInt(shardIndex),
      token,
    });
  }
  const directory = await deployTraceRegistryDirectory(
    lucid,
    mintIdentifierValidator,
    address,
    shards,
    directoryNonce,
    directoryAuthToken,
  );

  return {
    shardPolicyId,
    base: {
      validator,
      scriptHash,
      address,
    },
    shards,
    directory,
  };
};

const loadTraceRegistryBenchmarkVoucher = async (
  lucid: LucidEvolution,
): Promise<{ validator: Script; policyId: string } | null> => {
  const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

  // The fast denom-registry benchmark is intentionally local-only. We keep the
  // production registry semantics unchanged on non-local networks by disabling
  // the benchmark mint policy parameter there.
  if (cardanoNetworkMagic !== "42") {
    return null;
  }

  const [benchmarkVoucherValidator, benchmarkVoucherPolicyId] =
    await readValidator(
      "minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint",
      lucid,
    );
  return {
    validator: benchmarkVoucherValidator,
    policyId: benchmarkVoucherPolicyId,
  };
};

const deployTraceRegistryShard = async (
  lucid: LucidEvolution,
  mintIdentifierValidator: MintingPolicy,
  traceRegistryAddress: string,
  shardIndex: bigint,
  nonceUtxo: UTxO,
): Promise<AuthToken> => {
  const outputReference = buildOutputReference(nonceUtxo);
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const shardTokenName = await generateIdentifierTokenName(outputReference);
  const shardTokenUnit = shardPolicyId + shardTokenName;

  const emptyShardDatum: TraceRegistryShardDatum = {
    bucket_index: shardIndex,
    entries: [],
  };
  const encodedShardDatum = encodeRawDatum(
    new Constr(0, [
      new Constr(0, [
        emptyShardDatum.bucket_index,
        [],
      ]),
    ]),
  );

  // Each shard starts as its own append-only thread UTxO with a unique shard NFT
  // and an empty entry list. Later mint transactions spend exactly one shard when
  // they need to record a first-seen voucher trace.
  await submitTx(
    () =>
      lucid
        .newTx()
        .collectFrom([nonceUtxo], Data.void())
        .attach.MintingPolicy(mintIdentifierValidator)
        .mintAssets(
          {
            [shardTokenUnit]: 1n,
          },
          Data.to(outputReference, OutputReference, { canonical: true }),
        )
        .pay.ToContract(
          traceRegistryAddress,
          {
            kind: "inline",
            value: encodedShardDatum,
          },
          {
            [shardTokenUnit]: 1n,
          },
        ),
    lucid,
    `Mint Trace Registry Shard ${shardIndex.toString()}`,
  );

  return {
    policy_id: shardPolicyId,
    name: shardTokenName,
  };
};

const deployTraceRegistryDirectory = async (
  lucid: LucidEvolution,
  mintIdentifierValidator: MintingPolicy,
  traceRegistryAddress: string,
  shards: Array<{ index: bigint; token: AuthToken }>,
  nonceUtxo: UTxO,
  directoryAuthToken: AuthToken,
): Promise<AuthToken> => {
  const outputReference = buildOutputReference(nonceUtxo);
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const expectedDirectoryTokenName = await generateIdentifierTokenName(
    outputReference,
  );
  if (expectedDirectoryTokenName !== directoryAuthToken.name) {
    throw new Error(
      "Trace registry directory auth token does not match the reserved nonce UTxO.",
    );
  }
  const directoryTokenUnit = shardPolicyId + directoryAuthToken.name;

  const directoryDatum: TraceRegistryDirectoryDatum = {
    buckets: shards.map((shard) => ({
      bucket_index: shard.index,
      active_shard_name: shard.token.name,
      archived_shard_names: [],
    })),
  };

  const encodedDirectoryDatum = encodeRawDatum(
    new Constr(1, [
      new Constr(0, [
        directoryDatum.buckets.map((bucket) =>
          new Constr(0, [
            bucket.bucket_index,
            bucket.active_shard_name,
            bucket.archived_shard_names,
          ])
        ),
      ]),
    ]),
  );

  await submitTx(
    () =>
      lucid
        .newTx()
        .collectFrom([nonceUtxo], Data.void())
        .attach.MintingPolicy(mintIdentifierValidator)
        .mintAssets(
          {
            [directoryTokenUnit]: 1n,
          },
          Data.to(outputReference, OutputReference, { canonical: true }),
        )
        .pay.ToContract(
          traceRegistryAddress,
          {
            kind: "inline",
            value: encodedDirectoryDatum,
          },
          {
            [directoryTokenUnit]: 1n,
          },
        ),
    lucid,
    "Mint Trace Registry Directory",
  );

  return {
    policy_id: shardPolicyId,
    name: directoryAuthToken.name,
  };
};

const deployHostState = async (
  lucid: LucidEvolution,
  nonceUtxo: UTxO,
  outputReference: OutputReference,
  mintHostStateNFTValidator: MintingPolicy,
  mintHostStateNFTPolicyId: string,
  spendClientScriptHash: string,
  spendConnectionScriptHash: string,
  spendChannelScriptHash: string,
) => {
  console.log("Deploy HostState (STT Architecture)");

  // Ensure we mint with the same UTxO reference used to parameterize the policy id.
  const expectedOutRef: OutputReference = {
    transaction_id: nonceUtxo.txHash,
    output_index: BigInt(nonceUtxo.outputIndex),
  };
  if (
    expectedOutRef.transaction_id !== outputReference.transaction_id ||
    expectedOutRef.output_index !== outputReference.output_index
  ) {
    throw new Error(
      "HostState nonce UTxO does not match policy parameter outref.",
    );
  }

  // Load hostStateStt spending validator.
  //
  // Parameters (in order):
  // 1) `nft_policy` (HostState NFT policy id)
  // 2) `spend_client_script_hash` (used to locate the created client output when enforcing root correctness)
  // 3) `spend_connection_script_hash` (used to locate the created connection output when enforcing root correctness)
  // 4) `spend_channel_script_hash` (used to locate the created channel output when enforcing root correctness)
  const [hostStateSttValidator, hostStateSttScriptHash, hostStateSttAddress] =
    await readValidator(
      "host_state_stt.host_state_stt.spend",
      lucid,
      [
        mintHostStateNFTPolicyId,
        spendClientScriptHash,
        spendConnectionScriptHash,
        spendChannelScriptHash,
      ],
      Data.Tuple([
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
      ]) as unknown as [
        string,
        string,
        string,
        string,
      ],
    );

  const HOST_STATE_TOKEN_NAME = fromText("ibc_host_state");
  const hostStateNFTUnit = mintHostStateNFTPolicyId + HOST_STATE_TOKEN_NAME;

  // Create initial HostState datum
  // ibc_state_root initialized to empty tree root (32 bytes of 0x00)
  const EMPTY_TREE_ROOT =
    "0000000000000000000000000000000000000000000000000000000000000000";
  const currentTime = Date.now();

  const initHostStateDatum: HostStateDatum = {
    state: {
      version: 0n,
      ibc_state_root: EMPTY_TREE_ROOT,
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: BigInt(currentTime),
    },
    nft_policy: mintHostStateNFTPolicyId,
  };

  // Create and send tx to mint NFT and create HostState UTXO
  // NFTRedeemer has only one variant (MintInitial) with no fields
  // Use Data.void() as the redeemer (same as other simple mints)
  const encodedRedeemer = Data.void();

  const encodedDatum = Data.to(initHostStateDatum, HostStateDatum, {
    canonical: true,
  });

  await submitTx(
    () =>
      lucid
        .newTx()
        .collectFrom([nonceUtxo])
        .attach.MintingPolicy(mintHostStateNFTValidator)
        .mintAssets(
          {
            [hostStateNFTUnit]: 1n,
          },
          encodedRedeemer,
        )
        .pay.ToContract(
          hostStateSttAddress,
          {
            kind: "inline",
            value: encodedDatum,
          },
          {
            [hostStateNFTUnit]: 1n,
          },
        ),
    lucid,
    "MintHostStateNFT",
  );

  console.log("HostState NFT minted and HostState UTXO created");

  return {
    hostStateStt: {
      validator: hostStateSttValidator,
      scriptHash: hostStateSttScriptHash,
      address: hostStateSttAddress,
    },
    hostStateNFT: {
      policy_id: mintHostStateNFTPolicyId,
      name: HOST_STATE_TOKEN_NAME,
    },
  };
};

const deploySpendChannel = async (
  lucid: LucidEvolution,
  mintClientPolicyId: PolicyId,
  mintConnectionPolicyId: PolicyId,
  mintPortPolicyId: PolicyId,
  verifyProofScriptHash: PolicyId,
  hostStateNftPolicyId: PolicyId,
) => {
  const referredValidators = {
    chan_open_ack: "chan_open_ack.mint",
    chan_open_confirm: "chan_open_confirm.spend",
    chan_close_init: "chan_close_init.spend",
    chan_close_confirm: "chan_close_confirm.spend",
    recv_packet: "recv_packet.mint",
    send_packet: "send_packet.spend",
    timeout_packet: "timeout_packet.mint",
    acknowledge_packet: "acknowledge_packet.mint",
  };

  const referredScripts: Record<string, { script: Script; hash: string }> = {};

  for (const [name, validator] of Object.entries(referredValidators)) {
    const args = [mintClientPolicyId, mintConnectionPolicyId, mintPortPolicyId];

    if (name !== "send_packet" && name !== "chan_close_init") {
      args.push(verifyProofScriptHash);
    }

    const [script, hash] = await readValidator(
      `spending_channel/${name}.${validator}`,
      lucid,
      args,
    );

    referredScripts[name] = {
      script,
      hash,
    };
  }

  const [script, hash, address] = await readValidator(
    "spending_channel.spend_channel.spend",
    lucid,
    [
      ...Object.keys(referredValidators).map((name) =>
        referredScripts[name].hash
      ),
      hostStateNftPolicyId,
    ],
  );

  return {
    base: {
      script,
      hash,
      address,
    },
    referredScripts,
  };
};
