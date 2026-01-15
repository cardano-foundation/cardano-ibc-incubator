import { ensureDir } from "@std/fs";
import {
  credentialToAddress,
  validatorToScriptHash,
  validatorToAddress,
  Data,
  fromText,
  type MintingPolicy,
  PolicyId,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
  LucidEvolution,
} from "@lucid-evolution/lucid";
import {
  formatTimestamp,
  generateIdentifierTokenName,
  generateTokenName,
  getNonceOutRef,
  readValidator,
  DeploymentTemplate,
  submitTx
} from "./utils.ts";
import {
  EMULATOR_ENV,
  HANDLER_TOKEN_NAME,
  PORT_PREFIX,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";
import { AuthToken, AuthTokenSchema, HandlerDatum, HandlerOperator, MintPortRedeemer, OutputReference, OutputReferenceSchema, HostStateDatum } from "../types/index.ts";

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};

const hexToBytes = (hex: string): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
};

const encodeInteger = (bytes: number[], n: number) => {
  if (n >= 0 && n <= 23) {
    bytes.push(n);
  } else if (n <= 0xff) {
    bytes.push(0x18, n);
  } else if (n <= 0xffff) {
    bytes.push(0x19, (n >> 8) & 0xff, n & 0xff);
  } else if (n <= 0xffffffff) {
    bytes.push(0x1a, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  } else {
    bytes.push(0x1b);
    const hi = Math.floor(n / 0x100000000);
    const lo = n & 0xffffffff;
    bytes.push(
      (hi >> 24) & 0xff,
      (hi >> 16) & 0xff,
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 24) & 0xff,
      (lo >> 16) & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    );
  }
};

const encodeBytes = (bytes: number[], hex: string) => {
  const payload = hexToBytes(hex);
  const len = payload.length;
  if (len <= 23) {
    bytes.push(0x40 + len);
  } else if (len <= 0xff) {
    bytes.push(0x58, len);
  } else if (len <= 0xffff) {
    bytes.push(0x59, (len >> 8) & 0xff, len & 0xff);
  } else {
    throw new Error(`Bytestring too long: ${len}`);
  }
  bytes.push(...payload);
};

const encodeArray = (bytes: number[], arr: Array<number | bigint>) => {
  if (arr.length > 23) {
    throw new Error(`Array length ${arr.length} not supported`);
  }
  bytes.push(0x80 + arr.length);
  for (const item of arr) {
    encodeInteger(bytes, Number(item));
  }
};

const encodeHandlerDatumDefinite = (datum: HandlerDatum): string => {
  const bytes: number[] = [];
  // Constr 0 [
  //   Constr 0 [next_client_seq, next_connection_seq, next_channel_seq, bound_port, ibc_state_root],
  //   Constr 0 [policy_id, name]
  // ]
  bytes.push(0xd8, 0x79, 0x82);
  bytes.push(0xd8, 0x79, 0x85);
  encodeInteger(bytes, Number(datum.state.next_client_sequence));
  encodeInteger(bytes, Number(datum.state.next_connection_sequence));
  encodeInteger(bytes, Number(datum.state.next_channel_sequence));
  encodeArray(bytes, datum.state.bound_port);
  encodeBytes(bytes, datum.state.ibc_state_root);
  bytes.push(0xd8, 0x79, 0x82);
  encodeBytes(bytes, datum.token.policy_id);
  encodeBytes(bytes, datum.token.name);
  return Buffer.from(bytes).toString("hex");
};

export const createDeployment = async (
  lucid: LucidEvolution,
  mode?: string
) => {
  console.log("Create deployment info");
  const referredValidators: Script[] = [];

  const [verifyProofValidator, verifyProofPolicyId] = await readValidator(
    "verifying_proof.verify_proof.mint",
    lucid
  );
  referredValidators.push(verifyProofValidator);

  // load mint port validator
  const [mintPortValidator, mintPortPolicyId] = await readValidator(
    "minting_port.mint_port.mint",
    lucid
  );
  referredValidators.push(mintPortValidator);

  // load spend client validator
  const [spendClientValidator, spendClientScriptHash, spendClientAddress] =
    await readValidator("spending_client.spend_client.spend", lucid);
  referredValidators.push(spendClientValidator);

  // load mint client validator
  const [mintClientValidator, mintClientPolicyId] = await readValidator(
    "minting_client.mint_client.mint",
    lucid,
    [spendClientScriptHash]
  );
  referredValidators.push(mintClientValidator);

  // load spend connection validator
  const [
    spendConnectionValidator,
    spendConnectionScriptHash,
    spendConnectionAddress,
  ] = await readValidator("spending_connection.spend_connection.spend", lucid, [
    mintClientPolicyId,
    verifyProofPolicyId,
  ]);
  referredValidators.push(spendConnectionValidator);

  // load mint connection validator
  const [mintConnectionValidator, mintConnectionPolicyId] = await readValidator(
    "minting_connection.mint_connection.mint",
    lucid,
    [mintClientPolicyId, verifyProofPolicyId, spendConnectionScriptHash]
  );
  referredValidators.push(mintConnectionValidator);

  // load spend channel validator
  const spendingChannel = await deploySpendChannel(
    lucid,
    mintClientPolicyId,
    mintConnectionPolicyId,
    mintPortPolicyId,
    verifyProofPolicyId
  );

  referredValidators.push(
    spendingChannel.base.script,
    ...Object.values(spendingChannel.referredScripts).map(
      (val) => val.script
    )
  );

  // load mint channel validator
  const [mintChannelValidator, mintChannelPolicyId] = await readValidator(
    "minting_channel.mint_channel.mint",
    lucid,
    [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintPortPolicyId,
      verifyProofPolicyId,
      spendingChannel.base.hash,
    ]
  );
  referredValidators.push(mintChannelValidator);

  // load spend handler validator
  const [spendHandlerValidator, spendHandlerScriptHash, spendHandlerAddress] =
    await readValidator("spending_handler.spend_handler.spend", lucid, [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintChannelPolicyId,
      mintPortPolicyId,
    ]);
  referredValidators.push(spendHandlerValidator);

  // deploy handler
  const [mintHandlerPolicyId, handlerTokenName] = await deployHandler(
    lucid,
    spendHandlerScriptHash
  );

  const handlerToken: AuthToken = {
    policy_id: mintHandlerPolicyId,
    name: handlerTokenName,
  };
  const handlerTokenUnit = mintHandlerPolicyId + handlerTokenName;

  // Deploy HostState (STT Architecture)
  const {
    mintHostStateNFT,
    hostStateStt,
    hostStateNFT,
  } = await deployHostState(lucid);
  referredValidators.push(mintHostStateNFT.validator, hostStateStt.validator);

  // Load STT minting validators (parameterized for STT architecture)
  console.log("Loading STT minting validators...");
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/c584c220-25f6-470a-8eff-fc08634f1f67',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deployment.ts:153',message:'Attempting to load STT validators',data:{spendClientScriptHash},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  // Load mint client STT validator (parameterized by spend_client_script_hash, host_state_nft_policy_id)
  const [mintClientSttValidator, mintClientSttPolicyId] = await readValidator(
    "minting_client_stt.mint_client_stt.mint",
    lucid,
    [spendClientScriptHash, mintHostStateNFT.policyId],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string]
  );
  referredValidators.push(mintClientSttValidator);

  // Load mint connection STT validator (parameterized by client_mint, verify_proof, spend_connection, host_state_nft hashes)
  const [mintConnectionSttValidator, mintConnectionSttPolicyId] = await readValidator(
    "minting_connection_stt.mint_connection_stt.mint",
    lucid,
    [mintClientSttPolicyId, verifyProofPolicyId, spendConnectionScriptHash, mintHostStateNFT.policyId],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [string, string, string, string]
  );
  referredValidators.push(mintConnectionSttValidator);

  // Load mint channel STT validator (parameterized by client_mint, connection_mint, port_mint, verify_proof, spend_channel, host_state_nft hashes)
  const [mintChannelSttValidator, mintChannelSttPolicyId] = await readValidator(
    "minting_channel_stt.mint_channel_stt.mint",
    lucid,
    [mintClientSttPolicyId, mintConnectionSttPolicyId, mintPortPolicyId, verifyProofPolicyId, spendingChannel.base.hash, mintHostStateNFT.policyId],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes(), Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [string, string, string, string, string, string]
  );
  referredValidators.push(mintChannelSttValidator);
  
  console.log("STT minting validators loaded");

  // load mint identifier validator
  const [mintIdentifierValidator, mintIdentifierPolicyId] = await readValidator(
    "minting_identifier.minting_identifier.mint",
    lucid
  );

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
    mintChannelPolicyId,
    TRANSFER_MODULE_PORT
  );
  referredValidators.push(mintVoucher.validator, spendTransferModule.validator);

  const refUtxosInfo = await createReferenceUtxos(
    lucid,
    referredValidators
  );

  const [mockTokenPolicyId, mockTokenName] = await mintMockToken(lucid);

  const spendChannelRefValidator = Object.entries(
    spendingChannel.referredScripts
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
      mintClient: {
        title: "minting_client.mint_client.mint",
        script: mintClientValidator.script,
        scriptHash: mintClientPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintClientPolicyId],
      },
      mintConnection: {
        title: "minting_connection.mint_connection.mint",
        script: mintConnectionValidator.script,
        scriptHash: mintConnectionPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintConnectionPolicyId],
      },
      spendConnection: {
        title: "spending_connection.spend_connection.spend",
        script: spendConnectionValidator.script,
        scriptHash: spendConnectionScriptHash,
        address: spendConnectionAddress,
        refUtxo: refUtxosInfo[spendConnectionScriptHash],
      },
      mintChannel: {
        title: "minting_channel.mint_channel.mint",
        script: mintChannelValidator.script,
        scriptHash: mintChannelPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintChannelPolicyId],
      },
      spendChannel: {
        title: "spending_channel.spend_channel.spend",
        script: spendingChannel.base.script.script,
        scriptHash: spendingChannel.base.hash,
        address: spendingChannel.base.address,
        refUtxo: refUtxosInfo[spendingChannel.base.hash],
        refValidator: spendChannelRefValidator,
      },
      mintPort: {
        title: "minting_port.mint_port.mint",
        script: mintPortValidator.script,
        scriptHash: mintPortPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintPortPolicyId],
      },
      mintIdentifier: {
        title: "minting_identifier.mint_identifier.mint",
        script: mintIdentifierValidator.script,
        scriptHash: mintIdentifierPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintIdentifierPolicyId],
      },
      spendTransferModule: {
        title: "spending_transfer_module.spend_transfer_module.spend",
        script: spendTransferModule.validator.script,
        scriptHash: spendTransferModule.scriptHash,
        address: spendTransferModule.address,
        refUtxo: refUtxosInfo[spendTransferModule.scriptHash],
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
      mintHostStateNFT: {
        title: "host_state_nft.host_state_nft.mint",
        script: mintHostStateNFT.validator.script,
        scriptHash: mintHostStateNFT.policyId,
        address: "",
        refUtxo: refUtxosInfo[mintHostStateNFT.policyId],
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
    modules: {
      handler: {
        identifier: handlerTokenUnit,
        address: spendHandlerAddress,
      },
      transfer: {
        identifier: transferModuleIdentifier,
        address: spendTransferModule.address,
      }
    },
    tokens: {
      mock: mockTokenPolicyId + mockTokenName,
    },
  };

  if (mode !== undefined && mode != EMULATOR_ENV) {
    const jsonConfig = JSON.stringify(deploymentInfo);

    const folder = "./deployments";
    await ensureDir(folder);

    const filePath =
      folder + "/handler_" + formatTimestamp(new Date().getTime()) + ".json";

    await Deno.writeTextFile(filePath, jsonConfig);
    await Deno.writeTextFile(folder + "/handler.json", jsonConfig);
    console.log("Deploy info saved to:", filePath);
  }

  return deploymentInfo;
};

async function mintMockToken(lucid: LucidEvolution) {
  // load mint mock token validator
  const [mintMockTokenValidator, mintMockTokenPolicyId] = await readValidator(
    "minting_mock_token.mint_mock_token.mint",
    lucid
  );

  const tokenName = fromText("mock");

  const tokenUnit = mintMockTokenPolicyId + tokenName;

  const tx = lucid
    .newTx()
    .attach.MintingPolicy(mintMockTokenValidator)
    .mintAssets(
      {
        [tokenUnit]: 9999999999n,
      },
      Data.void()
    )
    .pay.ToAddress(
      "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
      {
        [tokenUnit]: 999999999n,
      }
    );

  await submitTx(tx, lucid, "Mint mock token");

  return [mintMockTokenPolicyId, tokenName];
}

async function createReferenceUtxos(
  lucid: LucidEvolution,
  referredValidators: Script[]
) {
  try {
    console.log("Create reference utxos starting ...");

    const [, , referenceAddress] = await readValidator(
      "reference_validator.refer_only.else",
      lucid
    );

    console.log(
      "Submitting transactions for",
      referredValidators.length,
      "validators ..."
    );

    const result: { [x: string]: UTxO } = {};

    for (const validator of referredValidators) {
      const tx = lucid.newTx().pay.ToContract(
        referenceAddress,
        {
          kind: "inline",
          value: Data.void(),
        },
        { lovelace: 1_000_000n },
        validator
      );

      const [newWalletUTxOs, derivedOutputs, txSignBuilder] = await tx.chain();
      const signedTx = await txSignBuilder.sign.withWallet().complete();
      await signedTx.submit();

      lucid.overrideUTxOs(newWalletUTxOs);

      for (const output of derivedOutputs) {
        if (output.scriptRef) {
          const scriptHash = validatorToScriptHash(output.scriptRef);
          result[scriptHash] = output;
        }
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
  spendHandlerScriptHash: ScriptHash
) => {
  console.log("Create Handler");

  // load nonce UTXO
  const signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO found.");
  const NONCE_UTXO = signerUtxos[0];

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
      string
    ]
  );

  const handlerTokenUnit = mintHandlerPolicyId + HANDLER_TOKEN_NAME;

  // create handler datum
  // ibc_state_root initialized to empty tree root (32 bytes of 0x00)
  // This root will be updated with each IBC state change to reflect the current ICS-23 Merkle commitment
  const EMPTY_TREE_ROOT = "0000000000000000000000000000000000000000000000000000000000000000";
  
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

  const spendHandlerAddress = credentialToAddress(lucid.config().network || 'Custom', {
    type: "Script",
    hash: spendHandlerScriptHash,
  });

  // create and send tx create handler
  const mintHandlerTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO], Data.void())
    .attach.MintingPolicy(mintHandlerValidator)
    .mintAssets(
      {
        [handlerTokenUnit]: 1n,
      },
      Data.void()
    )
    .pay.ToContract(
      spendHandlerAddress,
      {
        kind: "inline",
        value: Data.to(initHandlerDatum, HandlerDatum, { canonical: true }),
      },
      {
        [handlerTokenUnit]: 1n,
      }
    );

  await submitTx(
    mintHandlerTx,
    lucid,
    "Mint Handler"
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
  portNumber: bigint
) => {
  console.log("Create Transfer Module");

  // generate identifier token
  const [nonceUtxo, outputReference] = await getNonceOutRef(lucid);
  const mintIdentifierPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const identifierTokenName = await generateIdentifierTokenName(outputReference);
  const identifierToken: AuthToken = {
    policy_id: mintIdentifierPolicyId,
    name: identifierTokenName,
  };
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;
  const [mintVoucherValidator, mintVoucherPolicyId] = await readValidator(
    "minting_voucher.mint_voucher.mint",
    lucid,
    [identifierToken],
    Data.Tuple([AuthTokenSchema]) as unknown as [AuthToken]
  );

  const portId = fromText("port-" + portNumber.toString());
  const mintPortPolicyId = validatorToScriptHash(mintPortValidator);
  const portTokenName = await generateTokenName(
    handlerToken,
    PORT_PREFIX,
    portNumber
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
    ],
    Data.Tuple([
      AuthTokenSchema,
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [AuthToken, AuthToken, AuthToken, string, string, string]
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
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator, { canonical: true }))
    .attach.SpendingValidator(spendHandlerValidator)
    .attach.MintingPolicy(mintPortValidator)
    .mintAssets(
      {
        [portTokenUnit]: 1n,
      },
      Data.to(mintPortRedeemer, MintPortRedeemer, { canonical: true })
    )
    .attach.MintingPolicy(mintIdentifierValidator)
    .mintAssets(
      {
        [identifierTokenUnit]: 1n,
      },
      Data.to(outputReference, OutputReference, { canonical: true })
    )
    .pay.ToContract(
      validatorToAddress(lucid.config().network || 'Custom', spendHandlerValidator),
      {
        kind: "inline",
        value: Data.to(updatedHandlerDatum, HandlerDatum, { canonical: true }),
      },
      {
        [handlerTokenUnit]: 1n,
      }
    )
    .pay.ToAddress(
      spendTransferModuleAddress,
      {
        [identifierTokenUnit]: 1n,
        [portTokenUnit]: 1n,
      }
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

const deployHostState = async (lucid: LucidEvolution) => {
  console.log("Deploy HostState (STT Architecture)");
  
  // Get nonce UTXO for one-time mint
  const signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO found.");
  const NONCE_UTXO = signerUtxos[0];
  
  const outputReference: OutputReference = {
    transaction_id: NONCE_UTXO.txHash,
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };
  
  // Load mint hostStateNFT validator (parameterized by UTXO ref)
  const [mintHostStateNFTValidator, mintHostStateNFTPolicyId] = await readValidator(
    "host_state_nft.host_state_nft.mint",
    lucid,
    [outputReference],
    Data.Tuple([OutputReferenceSchema]) as unknown as [OutputReference]
  );
  
  // Load hostStateStt spending validator (parameterized by nft_policy)
  // CRITICAL: This validator MUST be parameterized with the NFT policy ID to verify NFT continuity
  const [hostStateSttValidator, hostStateSttScriptHash, hostStateSttAddress] = await readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [mintHostStateNFTPolicyId],  // Pass the NFT policy ID as parameter
    Data.Tuple([Data.Bytes()]) as unknown as [string]  // Schema for the nft_policy parameter (must be Tuple for applyParamsToScript)
  );
  
  const HOST_STATE_TOKEN_NAME = fromText("ibc_host_state");
  const hostStateNFTUnit = mintHostStateNFTPolicyId + HOST_STATE_TOKEN_NAME;
  
  // Create initial HostState datum
  // ibc_state_root initialized to empty tree root (32 bytes of 0x00)
  const EMPTY_TREE_ROOT = "0000000000000000000000000000000000000000000000000000000000000000";
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
  
  const encodedDatum = Data.to(initHostStateDatum, HostStateDatum, { canonical: true });
  
  const mintHostStateTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO])
    .attach.MintingPolicy(mintHostStateNFTValidator)
    .mintAssets(
      {
        [hostStateNFTUnit]: 1n,
      },
      encodedRedeemer
    )
    .pay.ToContract(
      hostStateSttAddress,
      {
        kind: "inline",
        value: encodedDatum,
      },
      {
        [hostStateNFTUnit]: 1n,
      }
    );
  
  await submitTx(mintHostStateTx, lucid, "MintHostStateNFT");
  
  console.log("HostState NFT minted and HostState UTXO created");
  
  return {
    mintHostStateNFT: {
      validator: mintHostStateNFTValidator,
      policyId: mintHostStateNFTPolicyId,
    },
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
  verifyProofScriptHash: PolicyId
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

  const referredScripts: Record<string, { script: Script; hash: string }> =
    {};

  for (const [name, validator] of Object.entries(referredValidators)) {
    const args = [mintClientPolicyId, mintConnectionPolicyId, mintPortPolicyId];

    if (name !== "send_packet" && name !== "chan_close_init") {
      args.push(verifyProofScriptHash);
    }

    const [script, hash] = await readValidator(
      `spending_channel/${name}.${validator}`,
      lucid,
      args
    );

    referredScripts[name] = {
      script,
      hash,
    };
  }

  const [script, hash, address] = await readValidator(
    "spending_channel.spend_channel.spend",
    lucid,
    Object.keys(referredValidators).map((name) => referredScripts[name].hash)
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
