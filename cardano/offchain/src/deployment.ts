import { ensureDir } from "@std/fs";
import {
  credentialToAddress,
  Data,
  fromText,
  LucidEvolution,
  type MintingPolicy,
  PolicyId,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import {
  DeploymentTemplate,
  formatTimestamp,
  generateIdentifierTokenName,
  generateTokenName,
  getNonceOutRef,
  readValidator,
  submitTx,
} from "./utils.ts";
import {
  EMULATOR_ENV,
  HANDLER_TOKEN_NAME,
  PORT_PREFIX,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";
import {
  AuthToken,
  AuthTokenSchema,
  HandlerDatum,
  HandlerOperator,
  HostStateDatum,
  MintPortRedeemer,
  OutputReference,
  OutputReferenceSchema,
  TraceRegistryDatum,
  TraceRegistryDirectoryDatum,
  TraceRegistryShardDatum,
} from "../types/index.ts";

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};

export const createDeployment = async (
  lucid: LucidEvolution,
  mode?: string,
) => {
  console.log("Create deployment info");
  const referredValidators: Script[] = [];

  // ---------------------------------------------------------------------------
  // HostState NFT policy id is a required parameter for several validators.
  //
  // It depends on an `OutputReference`, so we must pick that upfront and use the
  // same reference later when minting the NFT (otherwise the policy id changes).
  //
  // Important: this output reference is not just "data baked into a script".
  // The corresponding UTxO must also be spent in the minting transaction.
  //
  // We also mint the Handler auth token using a separate "nonce UTxO" to ensure
  // uniqueness. Therefore we need *two distinct* wallet UTxOs available:
  // - one reserved for the HostState NFT mint (and for parameterizing the policy id),
  // - one reserved for the Handler token mint.
  //
  // If we accidentally reuse the same nonce UTxO for both mints, the first mint
  // will spend it and the second mint will fail with "unknown UTxO references".
  // ---------------------------------------------------------------------------
  let signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO found.");

  // Ensure we have at least 2 UTxOs to use as distinct nonces.
  //
  // On fresh devnets we may start with a single large UTxO. We split it into two
  // explicit outputs so later deployment transactions don't "accidentally" pull in
  // the other nonce as an extra input to fund fees/min-ADA.
  if (signerUtxos.length < 2) {
    const address = await lucid.wallet().address();
    const splitAmount = 50_000_000n; // 50 ADA, comfortably above any min-ADA + fees for these setup txs.
    const splitTx = lucid
      .newTx()
      .collectFrom([signerUtxos[0]])
      .pay.ToAddress(address, { lovelace: splitAmount })
      .pay.ToAddress(address, { lovelace: splitAmount });
    await submitTx(splitTx, lucid, "SplitNonceUtxos", false);
    signerUtxos = await lucid.wallet().getUtxos();
  }

  // Prefer large UTxOs for these nonce inputs so Lucid doesn't need to auto-select
  // additional wallet inputs, which could accidentally spend the other nonce.
  const sortedUtxos = [...signerUtxos].sort((a, b) => {
    const aLovelace = a.assets.lovelace ?? 0n;
    const bLovelace = b.assets.lovelace ?? 0n;
    if (aLovelace === bLovelace) return 0;
    return aLovelace < bLovelace ? 1 : -1;
  });

  const handlerNonceUtxo = sortedUtxos[0];
  const hostStateNonceUtxo = sortedUtxos.find(
    (u) =>
      u.txHash !== handlerNonceUtxo.txHash ||
      u.outputIndex !== handlerNonceUtxo.outputIndex,
  );
  if (!handlerNonceUtxo) {
    throw new Error(
      "Not enough distinct wallet UTxOs to deploy (need at least 2).",
    );
  }
  if (!hostStateNonceUtxo) {
    throw new Error(
      "Not enough distinct wallet UTxOs to deploy (need at least 2).",
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

  // ---------------------------------------------------------------------------
  // STT minting policies are the canonical source of client/connection/channel auth tokens.
  //
  // They derive token names from the HostState NFT (not the Handler auth token), which
  // lets on-chain validators deterministically derive related token names from any
  // other token name and prevents "short / human-readable" token-name mismatches.
  // ---------------------------------------------------------------------------

  // Load mint client STT validator (parameterized by spend_client_script_hash, host_state_nft_policy_id)
  const [mintClientSttValidator, mintClientSttPolicyId] = await readValidator(
    "minting_client_stt.mint_client_stt.mint",
    lucid,
    [spendClientScriptHash, mintHostStateNFTPolicyId],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  referredValidators.push(mintClientSttValidator);

  // load mint client validator
  const [, mintClientPolicyId] = await readValidator(
    "minting_client.mint_client.mint",
    lucid,
    [spendClientScriptHash],
  );

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

  // load mint connection validator
  const [, mintConnectionPolicyId] = await readValidator(
    "minting_connection.mint_connection.mint",
    lucid,
    [mintClientPolicyId, verifyProofPolicyId, spendConnectionScriptHash],
  );

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

  // load mint channel validator
  const [, mintChannelPolicyId] = await readValidator(
    "minting_channel.mint_channel.mint",
    lucid,
    [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintPortPolicyId,
      verifyProofPolicyId,
      spendingChannel.base.hash,
    ],
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

  // load spend handler validator
  const [spendHandlerValidator, spendHandlerScriptHash, spendHandlerAddress] =
    await readValidator("spending_handler.spend_handler.spend", lucid, [
      mintClientSttPolicyId,
      mintConnectionSttPolicyId,
      mintChannelSttPolicyId,
      mintPortPolicyId,
    ]);
  referredValidators.push(spendHandlerValidator);

  // deploy handler
  const [mintHandlerPolicyId, handlerTokenName] = await deployHandler(
    lucid,
    spendHandlerScriptHash,
    handlerNonceUtxo,
  );

  const handlerToken: AuthToken = {
    policy_id: mintHandlerPolicyId,
    name: handlerTokenName,
  };
  const handlerTokenUnit = mintHandlerPolicyId + handlerTokenName;

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

  // load mint identifier validator
  const [mintIdentifierValidator] = await readValidator(
    "minting_identifier.minting_identifier.mint",
    lucid,
  );
  referredValidators.push(mintIdentifierValidator);

  const {
    identifierTokenUnit: transferModuleIdentifier,
    mintVoucher,
    spendTransferModule,
  } = await deployTransferModule(
    lucid,
    handlerToken,
    spendHandlerValidator,
    mintPortValidator,
    mintIdentifierValidator,
    mintChannelSttPolicyId,
    TRANSFER_MODULE_PORT,
    hostStateNFT,
  );
  referredValidators.push(mintVoucher.validator, spendTransferModule.validator);

  const traceRegistry = await deployTraceRegistry(
    lucid,
    mintIdentifierValidator,
    mintVoucher.policyId,
  );
  // Bootstrap the registry with the bridge so voucher mints can rely on an
  // on-chain reverse mapping from the first deployment onward.
  referredValidators.push(traceRegistry.base.validator);

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

  const deploymentInfo: DeploymentTemplate = {
    validators: {
      spendHandler: {
        title: "spending_handler.spend_handler.spend",
        script: spendHandlerValidator.script,
        scriptHash: spendHandlerScriptHash,
        address: spendHandlerAddress,
        refUtxo: refUtxosInfo[spendHandlerScriptHash],
      },
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
    handlerAuthToken: {
      policyId: handlerToken.policy_id,
      name: handlerToken.name,
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
      handler: {
        identifier: handlerTokenUnit,
        address: spendHandlerAddress,
      },
      transfer: {
        identifier: transferModuleIdentifier,
        address: spendTransferModule.address,
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
      formatTimestamp(new Date().getTime()) + ".json";

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

async function mintMockToken(lucid: LucidEvolution) {
  // load mint mock token validator
  const [mintMockTokenValidator, mintMockTokenPolicyId] = await readValidator(
    "minting_mock_token.mint_mock_token.mint",
    lucid,
  );

  const tokenName = fromText("mock");

  const tokenUnit = mintMockTokenPolicyId + tokenName;

  const walletAddress = await lucid.wallet().address();

  const tx = lucid
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
    );

  await submitTx(tx, lucid, "Mint mock token");

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

      let newWalletUTxOs: UTxO[];
      let derivedOutputs: UTxO[];
      let signedTx;
      try {
        [newWalletUTxOs, derivedOutputs, signedTx] = await (async () => {
          const [walletUTxOs, outputs, txSignBuilder] = await tx.chain();
          return [
            walletUTxOs,
            outputs,
            await txSignBuilder.sign.withWallet().complete(),
          ] as const;
        })();
      } catch (error) {
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
          continue;
        }
        throw error;
      }

      let txHash: string | undefined;
      let lastSubmitError: unknown;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          txHash = await signedTx.submit();
          break;
        } catch (error) {
          lastSubmitError = error;
          if (attempt === 6) {
            throw error;
          }
          console.warn(
            `createReferenceUtxos submit retry ${attempt}/6 after error:`,
            error,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!txHash) {
        throw lastSubmitError ??
          new Error("Missing tx hash after submit retries");
      }

      console.log(
        "Submitted reference batch",
        `${batch.startIndex + 1}-${
          batch.startIndex + batch.validators.length
        }:`,
        txHash,
      );
      await lucid.awaitTx(txHash, 1000);
      lucid.overrideUTxOs(newWalletUTxOs);

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

const deployHandler = async (
  lucid: LucidEvolution,
  spendHandlerScriptHash: ScriptHash,
  nonceUtxo: UTxO,
) => {
  console.log("Create Handler");

  // load nonce UTXO
  const NONCE_UTXO = nonceUtxo;

  // load mint handler validator
  const outputReference: OutputReference = {
    transaction_id: NONCE_UTXO.txHash,
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  const [mintHandlerValidator, mintHandlerPolicyId] = await readValidator(
    "minting_handler.mint_handler.mint",
    lucid,
    [outputReference, spendHandlerScriptHash],
    Data.Tuple([OutputReferenceSchema, Data.Bytes()]) as unknown as [
      OutputReference,
      string,
    ],
  );

  const handlerTokenUnit = mintHandlerPolicyId + HANDLER_TOKEN_NAME;

  // create handler datum
  // ibc_state_root initialized to empty tree root (32 bytes of 0x00)
  // This root will be updated with each IBC state change to reflect the current ICS-23 Merkle commitment
  const EMPTY_TREE_ROOT =
    "0000000000000000000000000000000000000000000000000000000000000000";

  const initHandlerDatum: HandlerDatum = {
    state: {
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      ibc_state_root: EMPTY_TREE_ROOT,
    },
    token: { name: HANDLER_TOKEN_NAME, policy_id: mintHandlerPolicyId },
  };

  const spendHandlerAddress = credentialToAddress(
    lucid.config().network || "Custom",
    {
      type: "Script",
      hash: spendHandlerScriptHash,
    },
  );

  // create and send tx create handler
  const mintHandlerTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO], Data.void())
    .attach.MintingPolicy(mintHandlerValidator)
    .mintAssets(
      {
        [handlerTokenUnit]: 1n,
      },
      Data.void(),
    )
    .pay.ToContract(
      spendHandlerAddress,
      {
        kind: "inline",
        value: Data.to(initHandlerDatum, HandlerDatum, { canonical: true }),
      },
      {
        [handlerTokenUnit]: 1n,
      },
    );

  await submitTx(
    mintHandlerTx,
    lucid,
    "Mint Handler",
  );

  return [mintHandlerPolicyId, HANDLER_TOKEN_NAME];
};

const deployTransferModule = async (
  lucid: LucidEvolution,
  handlerToken: AuthToken,
  spendHandlerValidator: SpendingValidator,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  mintChannelPolicyId: string,
  portNumber: bigint,
  hostStateNFT: AuthToken,
) => {
  console.log("Create Transfer Module");

  // generate identifier token
  const [nonceUtxo, outputReference] = await getNonceOutRef(lucid);
  const mintIdentifierPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const identifierTokenName = await generateIdentifierTokenName(
    outputReference,
  );
  const identifierToken: AuthToken = {
    policy_id: mintIdentifierPolicyId,
    name: identifierTokenName,
  };
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;
  const [mintVoucherValidator, mintVoucherPolicyId] = await readValidator(
    "minting_voucher.mint_voucher.mint",
    lucid,
    [identifierToken],
    Data.Tuple([AuthTokenSchema]) as unknown as [AuthToken],
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
      handlerToken,
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
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [
      AuthToken,
      AuthToken,
      AuthToken,
      string,
      string,
      string,
      string,
    ],
  );

  const handlerTokenUnit = handlerToken.policy_id + handlerToken.name;
  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);

  const currentHandlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  const updatedHandlerDatum: HandlerDatum = {
    ...currentHandlerDatum,
    state: {
      ...currentHandlerDatum.state,
      bound_port: [
        ...currentHandlerDatum.state.bound_port,
        portNumber,
      ].toSorted(),
    },
  };
  const spendHandlerRedeemer: HandlerOperator = "HandlerBindPort";

  const mintPortRedeemer: MintPortRedeemer = {
    handler_token: handlerToken,
    spend_module_script_hash: spendTransferModuleScriptHash,
    port_number: portNumber,
  };

  const mintModuleTx = lucid
    .newTx()
    .collectFrom([nonceUtxo], Data.void())
    .collectFrom(
      [handlerUtxo],
      Data.to(spendHandlerRedeemer, HandlerOperator, { canonical: true }),
    )
    .attach.SpendingValidator(spendHandlerValidator)
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
      validatorToAddress(
        lucid.config().network || "Custom",
        spendHandlerValidator,
      ),
      {
        kind: "inline",
        value: Data.to(updatedHandlerDatum, HandlerDatum, { canonical: true }),
      },
      {
        [handlerTokenUnit]: 1n,
      },
    )
    .pay.ToAddress(
      spendTransferModuleAddress,
      {
        [identifierTokenUnit]: 1n,
        [portTokenUnit]: 1n,
      },
    );

  await submitTx(mintModuleTx, lucid, "Mint Transfer Module");

  return {
    identifierTokenUnit,
    mintVoucher: {
      validator: mintVoucherValidator,
      policyId: mintVoucherPolicyId,
    },
    spendTransferModule: {
      validator: spendTransferModuleValidator,
      scriptHash: spendTransferModuleScriptHash,
      address: spendTransferModuleAddress,
    },
  };
};

const TRACE_REGISTRY_SHARD_COUNT = 16;

const deployTraceRegistry = async (
  lucid: LucidEvolution,
  mintIdentifierValidator: MintingPolicy,
  mintVoucherPolicyId: string,
) => {
  console.log("Create Trace Registry");

  // Shards are keyed by the first four bits of the voucher hash. That keeps append
  // contention bounded instead of forcing every new voucher trace through one UTxO.
  // The registry is deployed alongside the bridge so voucher mint paths have the
  // canonical on-chain reverse-lookup state available immediately.
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const [validator, scriptHash, address] = await readValidator(
    "trace_registry.spend_trace_registry.spend",
    lucid,
    [shardPolicyId, mintVoucherPolicyId],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );

  const shards: Array<{ index: bigint; token: AuthToken }> = [];
  for (let shardIndex = 0; shardIndex < TRACE_REGISTRY_SHARD_COUNT; shardIndex++) {
    const token = await deployTraceRegistryShard(
      lucid,
      mintIdentifierValidator,
      address,
      BigInt(shardIndex),
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
): Promise<AuthToken> => {
  const [nonceUtxo, outputReference] = await getNonceOutRef(lucid);
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const shardTokenName = await generateIdentifierTokenName(outputReference);
  const shardTokenUnit = shardPolicyId + shardTokenName;

  const emptyShardDatum: TraceRegistryShardDatum = {
    bucket_index: shardIndex,
    entries: [],
  };
  const encodedShardDatum = Data.to(
    {
      Shard: emptyShardDatum,
    },
    TraceRegistryDatum,
    { canonical: true },
  );

  // Each shard starts as its own append-only thread UTxO with a unique shard NFT
  // and an empty entry list. Later mint transactions spend exactly one shard when
  // they need to record a first-seen voucher trace.
  const shardTx = lucid
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
    );

  await submitTx(
    shardTx,
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
): Promise<AuthToken> => {
  const [nonceUtxo, outputReference] = await getNonceOutRef(lucid);
  const shardPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const directoryTokenName = await generateIdentifierTokenName(outputReference);
  const directoryTokenUnit = shardPolicyId + directoryTokenName;

  const directoryDatum: TraceRegistryDirectoryDatum = {
    buckets: shards.map((shard) => ({
      bucket_index: shard.index,
      active_shard_name: shard.token.name,
      archived_shard_names: [],
    })),
  };

  const encodedDirectoryDatum = Data.to(
    {
      Directory: directoryDatum,
    },
    TraceRegistryDatum,
    { canonical: true },
  );

  const directoryTx = lucid
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
    );

  await submitTx(directoryTx, lucid, "Mint Trace Registry Directory");

  return {
    policy_id: shardPolicyId,
    name: directoryTokenName,
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

  const mintHostStateTx = lucid
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
    );

  await submitTx(mintHostStateTx, lucid, "MintHostStateNFT");

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
    timeout_packet: "timeout_packet.spend",
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
