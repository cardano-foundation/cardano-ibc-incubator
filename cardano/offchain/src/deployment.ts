import {
  type DeploymentPlan,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  loadDeploymentPlan,
  type PlannedValidator,
} from "./deployment-plan.ts";
export {
  buildChannelValidators,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
  loadStagedTendermintValidators,
} from "./deployment-plan.ts";
import {
  buildHostStateBootstrapTx,
  buildMockTokenMintTx,
  buildReferenceBatchTx,
  completeReferenceBatchTx,
} from "./deployment-transactions.ts";
import { ensureDir } from "@std/fs";
import {
  CML,
  Constr,
  coreToUtxo,
  Data,
  fromText,
  getAddressDetails,
  LucidEvolution,
  type MintingPolicy,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
  validatorToRewardAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  awaitWalletTx,
  DeploymentTemplate,
  formatTimestamp,
  generateIdentifierTokenName,
  generatePortTokenName,
  getLiveWalletUtxos,
  isRetryableOgmiosTransportError,
  recordDeploymentTx,
  resetDeploymentCostReport,
  submitTx,
} from "./utils.ts";
import {
  DEPLOYMENT_NONCE_SPLIT_AMOUNT,
  EMULATOR_ENV,
  ICQ_MODULE_PORT,
  MOCK_MODULE_PORT,
  RESERVED_DEPLOYMENT_NONCE_COUNT,
  TRACE_REGISTRY_DIRECTORY_NONCE_COUNT,
  TRACE_REGISTRY_SHARD_COUNT,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";
import {
  AuthToken,
  HostStateDatum,
  HostStateNftRedeemer,
  HostStateRedeemer,
  MintPortRedeemer,
  ModuleRegistration,
  OutputReference,
  type TraceRegistryDirectoryDatum,
  type TraceRegistryShardDatum,
  TransferModuleDatum,
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

const utxoRefKey = (utxo: UTxO): string => `${utxo.txHash}#${utxo.outputIndex}`;

const utxoLovelace = (utxo: UTxO): bigint => utxo.assets.lovelace ?? 0n;

const getPaymentCredentialHash = (address: string): string => {
  const paymentCredential = getAddressDetails(address).paymentCredential;
  if (!paymentCredential || paymentCredential.type !== "Key") {
    throw new Error(
      `Deployment wallet address does not have a key payment credential: ${address}`,
    );
  }
  return paymentCredential.hash;
};

const isAdaOnlyUtxo = (utxo: UTxO): boolean =>
  Object.keys(utxo.assets).every((unit) => unit === "lovelace");

const sortUtxosByLovelaceDesc = (utxos: UTxO[]): UTxO[] =>
  [...utxos].sort((a, b) => {
    const aLovelace = utxoLovelace(a);
    const bLovelace = utxoLovelace(b);
    if (aLovelace === bLovelace) return 0;
    return aLovelace < bLovelace ? 1 : -1;
  });

const sortUtxosByLovelaceAsc = (utxos: UTxO[]): UTxO[] =>
  [...utxos].sort((a, b) => {
    const aLovelace = utxoLovelace(a);
    const bLovelace = utxoLovelace(b);
    if (aLovelace === bLovelace) return 0;
    return aLovelace < bLovelace ? -1 : 1;
  });

const sortNonceCandidateUtxos = (utxos: UTxO[]): UTxO[] =>
  [...utxos].sort((a, b) => {
    const aAdaOnly = isAdaOnlyUtxo(a);
    const bAdaOnly = isAdaOnlyUtxo(b);
    if (aAdaOnly !== bAdaOnly) return aAdaOnly ? -1 : 1;
    const aLovelace = utxoLovelace(a);
    const bLovelace = utxoLovelace(b);
    if (aLovelace === bLovelace) return 0;
    return aLovelace < bLovelace ? -1 : 1;
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

const leafHash = async (keyHash: string, valueHex: string): Promise<string> => {
  if (valueHex.length === 0) return EMPTY_HASH;
  const valueHash = await sha256Hex(hexToBytes(valueHex));
  return sha256Hex(
    concatBytes(
      new Uint8Array([0]),
      hexToBytes(keyHash),
      hexToBytes(valueHash),
    ),
  );
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

export class DeploymentIbcTree {
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
      const keyHash = await sha256Hex(new TextEncoder().encode(key));
      nodesByHeight[0].set(
        BigInt(`0x${keyHash.slice(0, 16)}`),
        await leafHash(keyHash, value),
      );
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

const portCommitmentKey = (portId: string): string => `ports/${portId}`;

const buildBindPortHostStateUpdate = async (
  currentDatum: HostStateDatum,
  portIdText: string,
  registration: ModuleRegistration,
  tree: DeploymentIbcTree,
): Promise<{
  redeemer: HostStateRedeemer;
  datum: HostStateDatum;
  commit: () => void;
}> => {
  const portId = fromText(portIdText);
  const portKey = portCommitmentKey(portIdText);
  const portSiblings = await tree.getSiblings(portKey);
  const portValue = Data.to(registration, ModuleRegistration);
  tree.set(portKey, portValue);
  const newRoot = await tree.getRoot();
  const updatedDatum: HostStateDatum = {
    ...currentDatum,
    state: {
      ...currentDatum.state,
      version: currentDatum.state.version + 1n,
      ibc_state_root: newRoot,
      last_update_time: BigInt(Date.now()),
    },
    control: {
      ...currentDatum.control,
      port_registry: sortPortRegistrations(
        new Map(currentDatum.control.port_registry).set(portId, registration),
      ),
    },
  };

  return {
    redeemer: {
      BindPort: { port_id: portId, registration, port_siblings: portSiblings },
    },
    datum: updatedDatum,
    commit: () => {},
  };
};

export const createDeployment = async (
  lucid: LucidEvolution,
  mode?: string,
) => {
  console.log("Create deployment info");
  const walletAddress = await lucid.wallet().address();
  const deployerPaymentKeyHash = getPaymentCredentialHash(walletAddress);
  const deploymentReportEnabled = mode !== undefined && mode != EMULATOR_ENV;
  const deploymentWalletAddress = deploymentReportEnabled
    ? walletAddress
    : undefined;
  if (deploymentWalletAddress) {
    await resetDeploymentCostReport(
      deploymentWalletAddress,
      mode,
      Deno.env.get("CARDANO_NETWORK_MAGIC")?.trim(),
    );
  }

  // The HostState NFT policy id depends on this nonce output reference, so the
  // same UTxO must later be spent by the mint transaction.
  let signerUtxos = await getLiveWalletUtxos(lucid);
  if (signerUtxos.length < 1) throw new Error("No UTXO found.");

  let deploymentPlan: DeploymentPlan | undefined;
  let plannedNonceUtxos: UTxO[] | undefined;
  const prepareDeploymentPlan = async (walletUtxos: UTxO[]) => {
    const collateral = selectDeploymentCollateralHoldback(walletUtxos);
    if (collateral.length === 0) {
      throw new Error(
        "Wallet does not have enough live ADA-only collateral to deploy.",
      );
    }
    const nonces = selectDeploymentNonceUtxos(
      walletUtxos,
      RESERVED_DEPLOYMENT_NONCE_COUNT,
      new Set(collateral.map(utxoRefKey)),
    );
    if (nonces.length < RESERVED_DEPLOYMENT_NONCE_COUNT) {
      throw new Error(
        `Not enough distinct wallet UTxOs to deploy (need at least ${RESERVED_DEPLOYMENT_NONCE_COUNT}).`,
      );
    }
    const plan = await loadDeploymentPlan(lucid, {
      hostStateNonce: buildOutputReference(nonces[0]),
      transferModuleNonce: buildOutputReference(nonces[1]),
      traceDirectoryNonce: buildOutputReference(
        nonces[2 + TRACE_REGISTRY_SHARD_COUNT],
      ),
      deployerPaymentKeyHash,
      benchmarkVoucherEnabled: Deno.env.get("CARDANO_NETWORK_MAGIC") === "42",
    });
    assertDeploymentReferenceValidatorsFit(
      lucid,
      plan.referenceValidators.map(({ script }) => script),
      "complete deployment validator preflight",
    );
    const inventoryPath = Deno.env.get("DEPLOYMENT_PLAN_OUTPUT");
    if (inventoryPath) {
      await Deno.writeTextFile(
        inventoryPath,
        JSON.stringify(
          {
            inputs: plan.inputs,
            referenceValidators: plan.referenceValidators,
            inlineValidators: plan.inlineValidators,
          },
          (_key, value) => typeof value === "bigint" ? value.toString() : value,
          2,
        ) + "\n",
      );
    }
    deploymentPlan = plan;
    plannedNonceUtxos = nonces;
  };

  // Reserve enough wallet UTxOs up front for every deployment-only mint that
  // needs a unique OutputReference nonce. Re-querying "the first wallet UTxO"
  // between sequential mints is fragile on local devnets because the indexer can
  // momentarily lag behind the just-submitted transaction set.
  const deploymentSplitOutputCount = RESERVED_DEPLOYMENT_NONCE_COUNT + 16;
  if (signerUtxos.length < deploymentSplitOutputCount) {
    const address = await lucid.wallet().address();
    await submitTx(
      () => {
        const splitTx = lucid.newTx().collectFrom(signerUtxos);
        for (let index = 0; index < deploymentSplitOutputCount; index++) {
          splitTx.pay.ToAddress(address, {
            lovelace: DEPLOYMENT_NONCE_SPLIT_AMOUNT,
          });
        }
        return splitTx;
      },
      lucid,
      "SplitNonceUtxos",
      false,
      false,
      async (signedTx) => {
        // A nonce policy depends on the split body hash. Read the exact signed
        // outputs and preflight their applied scripts before submitting that body.
        const outputs = signedTx.toTransaction().body().outputs();
        const hash = CML.TransactionHash.from_hex(signedTx.toHash());
        const futureWalletUtxos: UTxO[] = [];
        for (let index = 0; index < outputs.len(); index++) {
          const output = outputs.get(index);
          const utxo = coreToUtxo(
            CML.TransactionUnspentOutput.new(
              CML.TransactionInput.new(hash, BigInt(index)),
              output,
            ),
          );
          if (utxo.address === walletAddress) futureWalletUtxos.push(utxo);
        }
        await prepareDeploymentPlan(futureWalletUtxos);
      },
    );
    signerUtxos = await getLiveWalletUtxos(
      lucid,
      deploymentSplitOutputCount,
    );
  }

  if (!deploymentPlan) await prepareDeploymentPlan(signerUtxos);
  // The plan is bound to exact nonce references, including a split body's hash.
  // An indexer may return additional wallet outputs after adoption; never reselect.
  const liveByRef = new Map(
    signerUtxos.map((utxo) => [utxoRefKey(utxo), utxo]),
  );
  const reservedNonceUtxos = plannedNonceUtxos!.map((utxo) => {
    const live = liveByRef.get(utxoRefKey(utxo));
    if (!live) {
      throw new Error(
        `Preflighted nonce ${
          utxoRefKey(utxo)
        } is not live after nonce preparation.`,
      );
    }
    return live;
  });

  // Keep collateral-sized UTxOs available for Lucid's Plutus collateral
  // selection. Nonce inputs only need unique output references, so prefer
  // smaller ADA-only UTxOs and let fee coin selection use non-reserved inputs.
  const initialCollateralHoldbackUtxos = selectDeploymentCollateralHoldback(
    signerUtxos,
  );
  if (initialCollateralHoldbackUtxos.length === 0) {
    throw new Error(
      `Wallet does not have enough live ADA-only collateral to deploy (need ${DEPLOYMENT_COLLATERAL_LOVELACE.toString()} lovelace).`,
    );
  }
  const [
    hostStateNonceUtxo,
    transferModuleNonceUtxo,
    ...remainingNonceUtxos
  ] = reservedNonceUtxos;
  const reservedNonceRefs = new Set(reservedNonceUtxos.map(utxoRefKey));
  let reservedDeploymentRefs = new Set<string>(reservedNonceRefs);
  const setSpendableWalletUtxos = async (
    minCount = 1,
  ): Promise<Set<string>> => {
    const liveUtxos = await getLiveWalletUtxos(lucid);
    const spendableUtxos = liveUtxos.filter((utxo) =>
      !reservedNonceRefs.has(utxoRefKey(utxo))
    );
    const currentCollateralHoldbackUtxos = selectDeploymentCollateralHoldback(
      spendableUtxos,
    );
    if (currentCollateralHoldbackUtxos.length === 0) {
      throw new Error(
        `Wallet does not have enough live non-nonce collateral to deploy (need ${DEPLOYMENT_COLLATERAL_LOVELACE.toString()} lovelace).`,
      );
    }
    const currentCollateralHoldbackRefs = new Set(
      currentCollateralHoldbackUtxos.map(utxoRefKey),
    );
    const nonCollateralSpendableCount =
      spendableUtxos.filter((utxo) =>
        !currentCollateralHoldbackRefs.has(utxoRefKey(utxo))
      ).length;
    if (nonCollateralSpendableCount < minCount) {
      throw new Error(
        `Wallet only has ${nonCollateralSpendableCount} non-reserved, non-collateral live UTxO(s); need ${minCount}.`,
      );
    }
    lucid.overrideUTxOs(spendableUtxos);
    return new Set([...reservedNonceRefs, ...currentCollateralHoldbackRefs]);
  };
  reservedDeploymentRefs = await setSpendableWalletUtxos();
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

  const plan = deploymentPlan!;
  const referredValidators = plan.referenceValidators.map(({ script }) =>
    script
  );
  const mintHostStateNFTValidator = plan.hostNft.script;
  const mintHostStateNFTPolicyId = plan.hostNft.hash;
  const verifyProofValidator = plan.verifyProof.script;
  const verifyProofPolicyId = plan.verifyProof.hash;
  const mintPortValidator = plan.mintPort.script;
  const mintPortPolicyId = plan.mintPort.hash;
  // Preserve the legacy recovery authority in the manifest. The staged client
  // does not accept a recovery redeemer; registration alone does not enable it.
  const recoverClientValidator = plan.recoverClient.script;
  const recoverClientScriptHash = plan.recoverClient.hash;
  const recoverClientAddress = validatorToRewardAddress(
    lucid.config().network || "Custom",
    recoverClientValidator,
  );
  const spendTendermintUpdateSessionValidator = plan.sessionSpend.script;
  const spendTendermintUpdateSessionScriptHash = plan.sessionSpend.hash;
  const spendTendermintUpdateSessionAddress = plan.sessionSpend.address;
  const mintTendermintUpdateSessionValidator = plan.sessionMint.script;
  const mintTendermintUpdateSessionPolicyId = plan.sessionMint.hash;
  const spendClientValidator = plan.spendClient.script;
  const spendClientScriptHash = plan.spendClient.hash;
  const spendClientAddress = plan.spendClient.address;
  const mintClientSttValidator = plan.mintClient.script;
  const mintClientSttPolicyId = plan.mintClient.hash;
  const spendConnectionValidator = plan.spendConnection.script;
  const spendConnectionScriptHash = plan.spendConnection.hash;
  const spendConnectionAddress = plan.spendConnection.address;
  const mintConnectionSttValidator = plan.mintConnection.script;
  const mintConnectionSttPolicyId = plan.mintConnection.hash;
  const spendingChannel = plan.spendingChannel;
  const mintChannelSttValidator = plan.mintChannel.script;
  const mintChannelSttPolicyId = plan.mintChannel.hash;

  await submitTx(
    () => lucid.newTx().register.Stake(recoverClientAddress),
    lucid,
    "RegisterRecoverClient",
    false,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos();

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
    plan.hostState,
    deployerPaymentKeyHash,
  );
  const hostStateTree = new DeploymentIbcTree();

  // load mint identifier validator
  const mintIdentifierValidator = plan.mintIdentifier.script;

  const bootstrapRefUtxosInfo = await createReferenceUtxos(
    lucid,
    plan.referenceHolder.address,
    plan.referenceValidators.filter(({ publication }) =>
      publication === "bootstrap"
    ).map(({ script }) => script),
    reservedDeploymentRefs,
    deploymentWalletAddress,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos(0);
  const bootstrapReferenceScripts: BootstrapReferenceScripts = {
    hostStateStt: requireReferenceUtxo(
      bootstrapRefUtxosInfo,
      hostStateStt.scriptHash,
      "HostState STT",
    ),
    mintPort: requireReferenceUtxo(
      bootstrapRefUtxosInfo,
      mintPortPolicyId,
      "mint-port",
    ),
    mintIdentifier: requireReferenceUtxo(
      bootstrapRefUtxosInfo,
      validatorToScriptHash(mintIdentifierValidator),
      "mint-identifier",
    ),
  };

  const traceRegistryDirectoryNonce =
    traceRegistryNonceUtxos[TRACE_REGISTRY_SHARD_COUNT];
  if (!traceRegistryDirectoryNonce) {
    throw new Error(
      "Missing reserved nonce UTxO for trace registry directory.",
    );
  }
  const traceRegistryDirectoryAuthToken = plan.directoryAuthToken;

  const {
    identifierTokenUnit: transferModuleIdentifier,
    mintTransferEscrowShard,
    mintVoucher,
    voucherMetadata,
    spendTransferModule,
  } = await deployTransferModule(
    lucid,
    hostStateStt,
    hostStateTree,
    mintPortValidator,
    mintIdentifierValidator,
    TRANSFER_MODULE_PORT,
    hostStateNFT,
    transferModuleNonceUtxo,
    bootstrapReferenceScripts,
    plan,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos(0);
  const traceRegistryBenchmarkVoucher = plan.benchmarkVoucher && {
    validator: plan.benchmarkVoucher.script,
    policyId: plan.benchmarkVoucher.hash,
  };

  const traceRegistry = await deployTraceRegistry(
    lucid,
    mintIdentifierValidator,
    traceRegistryDirectoryAuthToken,
    traceRegistryNonceUtxos,
    plan.traceRegistry,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos(0);
  // Bootstrap the registry with the bridge so voucher mints can rely on an
  // on-chain reverse mapping from the first deployment onward.

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
    hostStateNFT,
    mockModuleNonceUtxo,
    bootstrapReferenceScripts,
    plan.genericModule,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos(0);

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
    hostStateNFT,
    icqModuleNonceUtxo,
    bootstrapReferenceScripts,
    plan.genericModule,
  );
  reservedDeploymentRefs = await setSpendableWalletUtxos(0);

  // Only publish the runtime/bootstrap reference surface eagerly.
  // Deployment-only mint scripts still participate in bootstrap transactions,
  // but they do not need standalone public reference UTxOs once the bridge is live.
  const bootstrapRefHashes = new Set(Object.keys(bootstrapRefUtxosInfo));
  const remainingReferredValidators = referredValidators.filter((validator) =>
    !bootstrapRefHashes.has(validatorToScriptHash(validator))
  );
  const refUtxosInfo = {
    ...bootstrapRefUtxosInfo,
    ...await createReferenceUtxos(
      lucid,
      plan.referenceHolder.address,
      remainingReferredValidators,
      reservedDeploymentRefs,
      deploymentWalletAddress,
    ),
  };
  await setSpendableWalletUtxos(0);

  const [mockTokenPolicyId, mockTokenName] = await mintMockToken(
    lucid,
    plan.mockToken,
  );

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
    ics20PacketCodec: "ics20-classic-json-v1",
    validators: {
      recoverClient: {
        title: "recover_client.recover_client.withdraw",
        script: recoverClientValidator.script,
        scriptHash: recoverClientScriptHash,
        address: recoverClientAddress,
        refUtxo: refUtxosInfo[recoverClientScriptHash],
      },
      spendClient: {
        title: plan.spendClient.title,
        script: spendClientValidator.script,
        scriptHash: spendClientScriptHash,
        address: spendClientAddress,
        refUtxo: refUtxosInfo[spendClientScriptHash],
      },
      spendTendermintUpdateSession: {
        title:
          "spending_tendermint_update_session.spend_tendermint_update_session.spend",
        script: spendTendermintUpdateSessionValidator.script,
        scriptHash: spendTendermintUpdateSessionScriptHash,
        address: spendTendermintUpdateSessionAddress,
        refUtxo: refUtxosInfo[spendTendermintUpdateSessionScriptHash],
      },
      mintTendermintUpdateSession: {
        title:
          "minting_tendermint_update_session.mint_tendermint_update_session.mint",
        script: mintTendermintUpdateSessionValidator.script,
        scriptHash: mintTendermintUpdateSessionPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintTendermintUpdateSessionPolicyId],
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
        title: GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
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
      mintTransferEscrowShard: {
        title: "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
        script: mintTransferEscrowShard.validator.script,
        scriptHash: mintTransferEscrowShard.policyId,
        address: "",
        refUtxo: refUtxosInfo[mintTransferEscrowShard.policyId],
      },
      mintPort: {
        title: "minting_port.mint_port.mint",
        script: mintPortValidator.script,
        scriptHash: mintPortPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintPortPolicyId],
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
      script: hostStateNFT.script,
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
const REFERENCE_UTXO_SAFE_TX_HEADROOM_BYTES = 1_000;
const REFERENCE_UTXO_SINGLE_TX_HEADROOM_BYTES = 750;
const REFERENCE_UTXO_DEDICATED_FUNDING_MARGIN_BYTES = 1_500;
export const REFERENCE_UTXO_DEDICATED_FUNDING_FEE_BUFFER_LOVELACE = 1_500_000n;
const REFERENCE_UTXO_ADOPTION_ATTEMPTS = 6;
const REFERENCE_UTXO_ADOPTION_TIMEOUT_MS = 60_000;
const REFERENCE_UTXO_ADOPTION_RETRY_DELAY_MS = 5_000;
const DEPLOYMENT_COLLATERAL_LOVELACE = 5_000_000n;
const DEPLOYMENT_MAX_COLLATERAL_INPUTS = 3;

type ReferenceValidatorBatch = {
  validators: Script[];
  startIndex: number;
};

type ReferenceUtxoMap = Record<string, UTxO>;

type BootstrapReferenceScripts = {
  hostStateStt: UTxO;
  mintIdentifier: UTxO;
  mintPort: UTxO;
};

const filterReservedWalletUtxos = (
  utxos: UTxO[],
  reservedRefs: Set<string>,
): UTxO[] =>
  reservedRefs.size === 0
    ? utxos
    : utxos.filter((utxo) => !reservedRefs.has(utxoRefKey(utxo)));

const mergeWalletUtxos = (utxos: UTxO[]): UTxO[] => {
  const byRef = new Map<string, UTxO>();
  for (const utxo of utxos) {
    byRef.set(utxoRefKey(utxo), utxo);
  }
  return [...byRef.values()];
};

export const selectDeploymentCollateralHoldback = (utxos: UTxO[]): UTxO[] => {
  const candidateGroups = [
    sortUtxosByLovelaceDesc(utxos.filter(isAdaOnlyUtxo)),
    sortUtxosByLovelaceDesc(utxos),
  ];

  for (const candidates of candidateGroups) {
    // Holding the largest output can strand nearly the entire deployment
    // balance after the nonce split. Reserve the smallest sufficient output;
    // keep the descending order below for the bounded multi-input fallback.
    const singleCollateral = sortUtxosByLovelaceAsc(candidates).find((utxo) =>
      utxoLovelace(utxo) >= DEPLOYMENT_COLLATERAL_LOVELACE
    );
    if (singleCollateral) {
      return [singleCollateral];
    }

    const selected: UTxO[] = [];
    let selectedLovelace = 0n;
    for (const utxo of candidates) {
      selected.push(utxo);
      selectedLovelace += utxoLovelace(utxo);
      if (selectedLovelace >= DEPLOYMENT_COLLATERAL_LOVELACE) {
        return selected;
      }
      if (selected.length >= DEPLOYMENT_MAX_COLLATERAL_INPUTS) {
        break;
      }
    }
  }

  return [];
};

const selectDeploymentNonceUtxos = (
  utxos: UTxO[],
  count: number,
  collateralHoldbackRefs = new Set<string>(),
): UTxO[] => {
  const nonceCandidates = sortNonceCandidateUtxos(
    utxos.filter((utxo) => !collateralHoldbackRefs.has(utxoRefKey(utxo))),
  );

  return nonceCandidates.slice(0, count);
};

const requireReferenceUtxo = (
  refUtxos: ReferenceUtxoMap,
  scriptHash: string,
  label: string,
): UTxO => {
  const refUtxo = refUtxos[scriptHash];
  if (!refUtxo) {
    throw new Error(`Missing ${label} reference UTxO for ${scriptHash}`);
  }
  return refUtxo;
};

const estimateReferenceValidatorSize = (validator: Script): number =>
  validator.script.length / 2 + REFERENCE_UTXO_OUTPUT_OVERHEAD_BYTES;

const validatorReportHash = (validator: Script): string => {
  try {
    return validatorToScriptHash(validator);
  } catch {
    return "<unavailable>";
  }
};

const referenceTxSafeMaxSize = (maxTxSize: number): number =>
  Math.max(1, maxTxSize - REFERENCE_UTXO_SAFE_TX_HEADROOM_BYTES);

const referenceTxPayloadBudget = (maxTxSize: number): number =>
  Math.max(
    1,
    referenceTxSafeMaxSize(maxTxSize) - REFERENCE_UTXO_TX_OVERHEAD_BYTES,
  );

const referenceSingleValidatorBudget = (maxTxSize: number): number =>
  Math.max(1, maxTxSize - REFERENCE_UTXO_SINGLE_TX_HEADROOM_BYTES);

const isReferenceUtxoAdoptionTimeout = (error: unknown): boolean => {
  const errorText = error instanceof Error
    ? `${error.message}\n${error.stack ?? ""}`
    : String(error);

  return errorText.includes("Timed out waiting for wallet visibility of tx");
};

const isRetryableReferenceUtxoAdoptionError = (error: unknown): boolean =>
  isRetryableOgmiosTransportError(error) ||
  isReferenceUtxoAdoptionTimeout(error);

export const shouldUseDedicatedReferenceFunding = (
  validators: Script[],
  maxTxSize: number,
): boolean =>
  validators.length === 1 &&
  estimateReferenceValidatorSize(validators[0]) >
    maxTxSize - REFERENCE_UTXO_DEDICATED_FUNDING_MARGIN_BYTES;

export const buildReferenceValidatorBatches = (
  validators: Script[],
  maxTxSize: number,
): ReferenceValidatorBatch[] => {
  const batches: ReferenceValidatorBatch[] = [];
  // Keep a small fixed overhead aside so we batch optimistically up front
  // without relying on the full Lucid builder for every split decision.
  const payloadBudget = referenceTxPayloadBudget(maxTxSize);

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

export type ReferenceValidatorSizeReportEntry = {
  index: number;
  scriptHash: string;
  scriptBytes: number;
  estimatedReferenceOutputBytes: number;
  oversized: boolean;
};

export const buildReferenceValidatorSizeReport = (
  validators: Script[],
  maxTxSize: number,
): ReferenceValidatorSizeReportEntry[] => {
  const singleValidatorBudget = referenceSingleValidatorBudget(maxTxSize);
  return validators
    .map((validator, index) => {
      const scriptBytes = validator.script.length / 2;
      const estimatedReferenceOutputBytes = estimateReferenceValidatorSize(
        validator,
      );
      return {
        index,
        scriptHash: validatorReportHash(validator),
        scriptBytes,
        estimatedReferenceOutputBytes,
        oversized: estimatedReferenceOutputBytes > singleValidatorBudget,
      };
    })
    .sort((left, right) =>
      right.estimatedReferenceOutputBytes - left.estimatedReferenceOutputBytes
    );
};

const logReferenceValidatorSizeReport = (
  validators: Script[],
  maxTxSize: number,
) => {
  const report = buildReferenceValidatorSizeReport(validators, maxTxSize);
  const safeMaxTxSize = referenceTxSafeMaxSize(maxTxSize);
  const payloadBudget = referenceTxPayloadBudget(maxTxSize);
  const singleValidatorBudget = referenceSingleValidatorBudget(maxTxSize);

  console.log(
    "Reference validator size preflight:",
    `${validators.length} validators,`,
    `maxTxSize=${maxTxSize},`,
    `safeTxBudget=${safeMaxTxSize},`,
    `estimatedBatchPayloadBudget=${payloadBudget},`,
    `estimatedSingleValidatorBudget=${singleValidatorBudget}`,
  );
  for (const entry of report) {
    console.log(
      `  #${entry.index + 1}`,
      entry.scriptHash,
      `script=${entry.scriptBytes}`,
      `estimatedRefOutput=${entry.estimatedReferenceOutputBytes}`,
      entry.oversized ? "OVERSIZED" : "",
    );
  }
};

const assertReferenceValidatorsFit = (
  validators: Script[],
  maxTxSize: number,
) => {
  const oversized = buildReferenceValidatorSizeReport(validators, maxTxSize)
    .filter((entry) => entry.oversized);
  if (oversized.length === 0) {
    return;
  }

  const singleValidatorBudget = referenceSingleValidatorBudget(maxTxSize);
  const details = oversized
    .map((entry) =>
      `#${
        entry.index + 1
      } ${entry.scriptHash}: script=${entry.scriptBytes} bytes, estimated reference output=${entry.estimatedReferenceOutputBytes} bytes`
    )
    .join("\n");
  throw new Error(
    `Reference script deployment preflight failed: ${oversized.length} validator(s) exceed the safe single-reference-transaction budget (${singleValidatorBudget} bytes after signing headroom).\n${details}\nBuild production validators with silent traces or split/refactor the oversized validator before deployment.`,
  );
};

const assertDeploymentReferenceValidatorsFit = (
  lucid: LucidEvolution,
  validators: Script[],
  label: string,
) => {
  const maxTxSize = lucid.config().protocolParameters?.maxTxSize ?? 16_384;
  try {
    assertReferenceValidatorsFit(validators, maxTxSize);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${detail}`);
  }
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

// Mirror Aiken's canonical CBOR byte-key order so HostState maps serialize identically off-chain.
const compareCanonicalBytes = (leftHex: string, rightHex: string): number => {
  const left = hexToBytes(leftHex);
  const right = hexToBytes(rightHex);
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
};

export const sortPortRegistrations = (
  registrations: Map<string, ModuleRegistration>,
) =>
  new Map(
    [...registrations.entries()].sort(([left], [right]) =>
      compareCanonicalBytes(left, right)
    ),
  );

async function mintMockToken(lucid: LucidEvolution, planned: PlannedValidator) {
  // load mint mock token validator
  const mintMockTokenValidator = planned.script;
  const mintMockTokenPolicyId = planned.hash;

  const tokenName = fromText("mock");

  const tokenUnit = mintMockTokenPolicyId + tokenName;

  const walletAddress = await lucid.wallet().address();

  await submitTx(
    () =>
      buildMockTokenMintTx(
        lucid,
        mintMockTokenValidator,
        tokenUnit,
        walletAddress,
      ),
    lucid,
    "Mint mock token",
  );

  return [mintMockTokenPolicyId, tokenName];
}

async function createReferenceUtxos(
  lucid: LucidEvolution,
  referenceAddress: string,
  referredValidators: Script[],
  reservedWalletRefs = new Set<string>(),
  deploymentWalletAddress?: string,
) {
  try {
    console.log("Create reference utxos starting ...");

    const walletAddress = await lucid.wallet().address();

    const maxTxSize = lucid.config().protocolParameters?.maxTxSize ?? 16_384;
    logReferenceValidatorSizeReport(referredValidators, maxTxSize);
    assertReferenceValidatorsFit(referredValidators, maxTxSize);

    const initialBatches = buildReferenceValidatorBatches(
      referredValidators,
      maxTxSize,
    );
    const safeMaxTxSize = referenceTxSafeMaxSize(maxTxSize);

    console.log(
      "Submitting",
      initialBatches.length,
      "reference transactions for",
      referredValidators.length,
      "validators ...",
    );

    const result: { [x: string]: UTxO } = {};

    const pendingBatches = [...initialBatches];
    const spentReferenceBatchRefs = new Set<string>();
    const refreshReferenceWalletState = async (
      localWalletUtxos: UTxO[] = [],
    ) => {
      // Clear Lucid's override before querying the provider, then merge provider
      // state with locally chained change outputs. This preserves unselected wallet
      // UTxOs without allowing stale Kupo responses to reuse known-spent inputs.
      lucid.overrideUTxOs([]);
      let liveWalletUtxos: UTxO[] = [];
      try {
        liveWalletUtxos = await getLiveWalletUtxos(lucid);
      } catch (error) {
        console.warn(
          "createReferenceUtxos could not refresh provider wallet UTxOs; using local chained wallet state:",
          error,
        );
      }
      const safeLiveWalletUtxos = liveWalletUtxos.filter((utxo) =>
        !spentReferenceBatchRefs.has(utxoRefKey(utxo))
      );
      lucid.overrideUTxOs(
        filterReservedWalletUtxos(
          mergeWalletUtxos([...safeLiveWalletUtxos, ...localWalletUtxos]),
          reservedWalletRefs,
        ),
      );
    };
    await refreshReferenceWalletState();

    const selectDedicatedFundingUtxo = (
      walletUtxos: UTxO[],
      fundingLovelace: bigint,
    ): UTxO | undefined =>
      sortUtxosByLovelaceAsc(
        walletUtxos.filter((utxo) =>
          isAdaOnlyUtxo(utxo) &&
          !utxo.scriptRef &&
          utxoLovelace(utxo) === fundingLovelace
        ),
      )[0];

    const createDedicatedFundingUtxo = async (
      fundingLovelace: bigint,
      batchLabel: string,
    ): Promise<UTxO> => {
      await refreshReferenceWalletState();
      const txHash = await submitTx(
        () =>
          lucid
            .newTx()
            .pay.ToAddress(walletAddress, { lovelace: fundingLovelace }),
        lucid,
        `Prepare reference funding ${batchLabel}`,
        false,
      );
      await refreshReferenceWalletState();
      const [fundingUtxo] = (await getLiveWalletUtxos(lucid)).filter((utxo) =>
        utxo.txHash === txHash &&
        isAdaOnlyUtxo(utxo) &&
        utxoLovelace(utxo) === fundingLovelace
      );
      if (!fundingUtxo) {
        throw new Error(
          `Unable to find prepared reference funding UTxO ${txHash} with ${fundingLovelace} lovelace`,
        );
      }
      return fundingUtxo;
    };

    const prepareDedicatedFundingUtxo = async (
      outputLovelace: bigint,
      batchLabel: string,
    ): Promise<UTxO> => {
      const fundingLovelace = outputLovelace +
        REFERENCE_UTXO_DEDICATED_FUNDING_FEE_BUFFER_LOVELACE;
      const spendableWalletUtxos = filterReservedWalletUtxos(
        mergeWalletUtxos(await getLiveWalletUtxos(lucid)),
        reservedWalletRefs,
      ).filter((utxo) => !spentReferenceBatchRefs.has(utxoRefKey(utxo)));
      const existingFundingUtxo = selectDedicatedFundingUtxo(
        spendableWalletUtxos,
        fundingLovelace,
      );
      if (existingFundingUtxo) {
        return existingFundingUtxo;
      }

      console.log(
        "Preparing dedicated reference funding UTxO",
        batchLabel,
        `with ${fundingLovelace} lovelace ...`,
      );
      return await createDedicatedFundingUtxo(fundingLovelace, batchLabel);
    };

    while (pendingBatches.length > 0) {
      // We still submit sequentially because each successful batch updates the
      // wallet UTxO set used to build the next one.
      const batch = pendingBatches.shift()!;
      const batchLabel = `${batch.startIndex + 1}-${
        batch.startIndex + batch.validators.length
      }`;
      console.log(
        "Preparing reference batch for validators",
        batchLabel,
        `(${batch.validators.length} validators) ...`,
      );

      const buildBatchTx = () =>
        buildReferenceBatchTx(lucid, referenceAddress, batch.validators);

      const dedicatedFunding = shouldUseDedicatedReferenceFunding(
          batch.validators,
          maxTxSize,
        )
        ? await prepareDedicatedFundingUtxo(
          (await buildBatchTx().config()).totalOutputAssets.lovelace ??
            0n,
          batchLabel,
        )
        : undefined;

      let newWalletUTxOs: UTxO[] | undefined;
      let derivedOutputs: UTxO[] | undefined;
      let signedTx;
      let consumedWalletInputs: UTxO[] = [];
      let splitBatch = false;
      let lastBuildError: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          const completed = await completeReferenceBatchTx(
            lucid,
            referenceAddress,
            batch.validators,
            dedicatedFunding,
          );
          newWalletUTxOs = completed.walletUTxOs;
          derivedOutputs = completed.outputs;
          signedTx = completed.signedTx;
          consumedWalletInputs = completed.consumedWalletInputs;
          const signedBytes = signedTx.toCBOR().length / 2;
          if (
            batch.validators.length > 1 &&
            signedBytes > safeMaxTxSize
          ) {
            const midpoint = Math.ceil(batch.validators.length / 2);
            console.warn(
              `Reference batch ${batch.startIndex + 1}-${
                batch.startIndex + batch.validators.length
              } completed at ${signedBytes} bytes, above safe budget ${safeMaxTxSize}; splitting into batches of ${midpoint} and ${
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
          if (signedBytes > maxTxSize) {
            const hashes = batch.validators
              .map((validator) => validatorToScriptHash(validator))
              .join(", ");
            throw new Error(
              `Reference batch ${batch.startIndex + 1}-${
                batch.startIndex + batch.validators.length
              } completed at ${signedBytes} bytes, above maxTxSize ${maxTxSize}. Validators: ${hashes}`,
            );
          }
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
      for (
        let attempt = 1;
        attempt <= REFERENCE_UTXO_ADOPTION_ATTEMPTS;
        attempt++
      ) {
        try {
          const submittedHash = await signedTx.submit();
          if (submittedHash !== txHash) {
            throw new Error(
              `Provider returned tx hash ${submittedHash}, but signed body hash is ${txHash}`,
            );
          }
        } catch (error) {
          console.warn(
            `createReferenceUtxos submit retry ${attempt}/${REFERENCE_UTXO_ADOPTION_ATTEMPTS} after error:`,
            error,
          );
        }

        try {
          await awaitWalletTx(
            lucid,
            txHash,
            1000,
            REFERENCE_UTXO_ADOPTION_TIMEOUT_MS,
          );
          for (const consumedInput of consumedWalletInputs) {
            spentReferenceBatchRefs.add(utxoRefKey(consumedInput));
          }
          await refreshReferenceWalletState(newWalletUTxOs);
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
          if (
            !isRetryableReferenceUtxoAdoptionError(error) ||
            attempt === REFERENCE_UTXO_ADOPTION_ATTEMPTS
          ) {
            throw error;
          }
          console.warn(
            `createReferenceUtxos adoption retry ${attempt}/${REFERENCE_UTXO_ADOPTION_ATTEMPTS} after error:`,
            error,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, REFERENCE_UTXO_ADOPTION_RETRY_DELAY_MS)
          );
        }
      }
      if (splitBatch) {
        continue;
      }
      if (!newWalletUTxOs || !derivedOutputs || !signedTx) {
        throw lastBuildError ??
          new Error("Failed to build reference batch transaction");
      }

      if (deploymentWalletAddress) {
        await recordDeploymentTx(
          `Reference validators ${batch.startIndex + 1}-${
            batch.startIndex + batch.validators.length
          }`,
          txHash,
          signedTx,
          deploymentWalletAddress,
          signedTx.toCBOR().length / 2,
        );
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

export const loadTransferModuleValidator = (
  lucid: LucidEvolution,
  portToken: AuthToken,
  identifierToken: AuthToken,
  portId: string,
  mintTransferEscrowShardPolicyId: string,
  mintChannelPolicyId: string,
  mintVoucherPolicyId: string,
  hostStateNftPolicyId: string,
) =>
  readValidator(
    "spending_transfer_module.spend_transfer_module.spend",
    lucid,
    [
      portToken,
      identifierToken,
      portId,
      mintTransferEscrowShardPolicyId,
      mintChannelPolicyId,
      mintVoucherPolicyId,
      hostStateNftPolicyId,
    ],
    Data.Tuple([
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
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
      string,
    ],
  );

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
  portIdText: string,
  hostStateNFT: AuthToken,
  nonceUtxo: UTxO,
  bootstrapReferenceScripts: BootstrapReferenceScripts,
  plan: DeploymentPlan,
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
  const voucherMetadataAddress = plan.voucherMetadata.address;
  const mintVoucherValidator = plan.mintVoucher.script;
  const mintVoucherPolicyId = plan.mintVoucher.hash;

  // NOTE: IBC port identifiers are part of on-chain commitment paths and are exchanged
  // over IBC. For the transfer module we use the canonical Cosmos port ID so Hermes can
  // operate without any Cardano-specific port mapping.
  const portId = fromText(portIdText);
  const mintPortPolicyId = validatorToScriptHash(mintPortValidator);
  const portTokenName = generatePortTokenName(portId);
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const portToken: AuthToken = {
    policy_id: mintPortPolicyId,
    name: portTokenName,
  };

  const mintTransferEscrowShardValidator = plan.mintTransferEscrowShard.script;
  const mintTransferEscrowShardPolicyId = plan.mintTransferEscrowShard.hash;
  const spendTransferModuleValidator = plan.spendTransferModule.script;
  const spendTransferModuleScriptHash = plan.spendTransferModule.hash;
  const spendTransferModuleAddress = plan.spendTransferModule.address;

  const hostStateUnit = hostStateNFT.policy_id + hostStateNFT.name;
  const hostStateUtxo = await lucid.utxoByUnit(hostStateUnit);
  const currentHostStateDatum = Data.from(hostStateUtxo.datum!, HostStateDatum);
  const registration: ModuleRegistration = {
    module_script_hash: spendTransferModuleScriptHash,
    port_token: portToken,
    module_token: identifierToken,
  };
  const hostStateUpdate = await buildBindPortHostStateUpdate(
    currentHostStateDatum,
    portIdText,
    registration,
    hostStateTree,
  );

  const mintPortRedeemer: MintPortRedeemer = {
    spend_module_script_hash: spendTransferModuleScriptHash,
    port_id: portId,
  };
  assertDeploymentReferenceValidatorsFit(
    lucid,
    [
      mintVoucherValidator,
      mintTransferEscrowShardValidator,
      spendTransferModuleValidator,
    ],
    "transfer module validator preflight",
  );

  const buildMintTransferModuleTx = () =>
    lucid
      .newTx()
      .readFrom([
        bootstrapReferenceScripts.hostStateStt,
        bootstrapReferenceScripts.mintPort,
        bootstrapReferenceScripts.mintIdentifier,
      ])
      .collectFrom([nonceUtxo], Data.void())
      .collectFrom(
        [hostStateUtxo],
        Data.to(hostStateUpdate.redeemer, HostStateRedeemer, {
          canonical: true,
        }),
      )
      .mintAssets(
        {
          [portTokenUnit]: 1n,
        },
        Data.to(mintPortRedeemer, MintPortRedeemer, { canonical: true }),
      )
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
      .pay.ToContract(
        spendTransferModuleAddress,
        {
          kind: "inline",
          value: Data.to(
            { escrow_shard_registry_root: "00".repeat(32) },
            TransferModuleDatum,
            { canonical: true },
          ),
        },
        {
          [identifierTokenUnit]: 1n,
          [portTokenUnit]: 1n,
        },
      )
      .addSignerKey(currentHostStateDatum.deployer);

  await submitTx(buildMintTransferModuleTx, lucid, "Mint Transfer Module");
  hostStateUpdate.commit();

  return {
    identifierTokenUnit,
    mintVoucher: {
      validator: mintVoucherValidator,
      policyId: mintVoucherPolicyId,
    },
    mintTransferEscrowShard: {
      validator: mintTransferEscrowShardValidator,
      policyId: mintTransferEscrowShardPolicyId,
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
  portIdText: string,
  hostStateNFT: AuthToken,
  nonceUtxo: UTxO,
  bootstrapReferenceScripts: BootstrapReferenceScripts,
  planned: PlannedValidator,
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
  const portTokenName = generatePortTokenName(portId);
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const portToken: AuthToken = {
    policy_id: mintPortPolicyId,
    name: portTokenName,
  };

  const spendModuleValidator = planned.script;
  const spendModuleScriptHash = planned.hash;
  const spendModuleAddress = planned.address;

  const hostStateUnit = hostStateNFT.policy_id + hostStateNFT.name;
  const hostStateUtxo = await lucid.utxoByUnit(hostStateUnit);
  const currentHostStateDatum = Data.from(hostStateUtxo.datum!, HostStateDatum);
  const registration: ModuleRegistration = {
    module_script_hash: spendModuleScriptHash,
    port_token: portToken,
    module_token: identifierToken,
  };
  const hostStateUpdate = await buildBindPortHostStateUpdate(
    currentHostStateDatum,
    portIdText,
    registration,
    hostStateTree,
  );

  const mintPortRedeemer: MintPortRedeemer = {
    spend_module_script_hash: spendModuleScriptHash,
    port_id: portId,
  };
  assertDeploymentReferenceValidatorsFit(
    lucid,
    [spendModuleValidator],
    `${portIdText} module validator preflight`,
  );

  const buildMintGenericModuleTx = () =>
    lucid
      .newTx()
      .readFrom([
        bootstrapReferenceScripts.hostStateStt,
        bootstrapReferenceScripts.mintPort,
        bootstrapReferenceScripts.mintIdentifier,
      ])
      .collectFrom([nonceUtxo], Data.void())
      .collectFrom(
        [hostStateUtxo],
        Data.to(hostStateUpdate.redeemer, HostStateRedeemer, {
          canonical: true,
        }),
      )
      .mintAssets(
        {
          [portTokenUnit]: 1n,
        },
        Data.to(mintPortRedeemer, MintPortRedeemer, { canonical: true }),
      )
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
      )
      .addSignerKey(currentHostStateDatum.deployer);

  await submitTx(buildMintGenericModuleTx, lucid, `Mint ${portIdText} Module`);
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
  nonceUtxos: UTxO[],
  planned: PlannedValidator,
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
  const validator = planned.script;
  const scriptHash = planned.hash;
  const address = planned.address;
  assertDeploymentReferenceValidatorsFit(
    lucid,
    [validator],
    "trace registry validator preflight",
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

export const loadHostStateValidator = (
  lucid: LucidEvolution,
  hostPolicy: string,
  clientHash: string,
  connectionHash: string,
  channelHash: string,
  clientPolicy: string,
  connectionPolicy: string,
  channelPolicy: string,
) =>
  readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [
      hostPolicy,
      clientHash,
      connectionHash,
      channelHash,
      clientPolicy,
      connectionPolicy,
      channelPolicy,
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [string, string, string, string, string, string, string],
  );

const deployHostState = async (
  lucid: LucidEvolution,
  nonceUtxo: UTxO,
  outputReference: OutputReference,
  mintHostStateNFTValidator: MintingPolicy,
  mintHostStateNFTPolicyId: string,
  planned: PlannedValidator,
  deployerPaymentKeyHash: string,
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

  const hostStateSttValidator = planned.script;
  const hostStateSttScriptHash = planned.hash;
  const hostStateSttAddress = planned.address;

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
    deployer: deployerPaymentKeyHash,
    control: {
      port_registry: new Map(),
      shutdown: "Active",
    },
  };

  // Create and send tx to mint NFT and create HostState UTXO
  const encodedRedeemer = Data.to("MintInitial", HostStateNftRedeemer, {
    canonical: true,
  });

  const encodedDatum = Data.to(initHostStateDatum, HostStateDatum, {
    canonical: true,
  });
  assertDeploymentReferenceValidatorsFit(
    lucid,
    [hostStateSttValidator],
    "host state validator preflight",
  );

  await submitTx(
    () =>
      buildHostStateBootstrapTx(lucid, {
        nonceUtxo,
        mintingPolicy: mintHostStateNFTValidator,
        hostStateNftUnit: hostStateNFTUnit,
        hostStateAddress: hostStateSttAddress,
        encodedDatum,
        encodedRedeemer,
      }),
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
      script: mintHostStateNFTValidator.script,
    },
  };
};
