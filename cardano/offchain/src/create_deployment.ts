import {
  credentialToAddress,
  validatorToScriptHash,
  validatorToAddress,
  mintingPolicyToId,
  generateSeedPhrase,
  Data,
  fromText,
  Lucid,
  type MintingPolicy,
  OutRef,
  PolicyId,
  Provider,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
} from "npm:@lucid-evolution/lucid@0.4.18";
import {
  formatTimestamp,
  generateIdentifierTokenName,
  generateTokenName,
  getNonceOutRef,
  readValidator,
  setUp,
} from "./utils.ts";
import {
  EMULATOR_ENV,
  HANDLER_TOKEN_NAME,
  MOCK_MODULE_PORT,
  PORT_PREFIX,
  TRANSFER_MODULE_PORT,
} from "./constants.ts";
import { DeploymentTemplate } from "./template.ts";
import { ensureDir } from "@std/fs";
import { submitTx } from "./utils.ts";
import {
  AuthToken,
  AuthTokenSchema,
} from "../../lucid-types/ibc/auth/AuthToken.ts";
import { HandlerDatum } from "../../lucid-types/ibc/core/ics_025_handler_interface/handler_datum/HandlerDatum.ts";
import { HandlerOperator } from "../../lucid-types/ibc/core/ics_025_handler_interface/handler_redeemer/HandlerOperator.ts";
import {
  OutputReference,
  OutputReferenceSchema,
} from "../../lucid-types/cardano/transaction/OutputReference.ts";
import { MintPortRedeemer } from "../../lucid-types/ibc/core/ics_005/port_redeemer/MintPortRedeemer.ts";

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};

export const createDeployment = async (
  lucid: Lucid,
  provider: Provider,
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
    ...Object.values(spendingChannel.referredValidators).map(
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

  // load mint identifier validator
  const [mintIdentifierValidator, mintIdentifierPolicyId] = await readValidator(
    "minting_identifier.minting_identifier.mint",
    lucid
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
    mintChannelPolicyId,
    TRANSFER_MODULE_PORT
  );
  referredValidators.push(mintVoucher.validator, spendTransferModule.validator);

  // const { identifierTokenUnit: mockModuleIdentifier, spendMockModule } =
  //   await deployMockModule(
  //     lucid,
  //     handlerToken,
  //     spendHandlerValidator,
  //     mintPortValidator,
  //     mintIdentifierValidator,
  //     MOCK_MODULE_PORT
  //   );
  // referredValidators.push(spendMockModule.validator);

  const refUtxosInfo = await createReferenceUtxos(
    lucid,
    provider,
    referredValidators
  );

  const [mockTokenPolicyId, mockTokenName] = await mintMockToken(lucid);

  const spendChannelRefValidator = Object.entries(
    spendingChannel.referredValidators
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

  console.log('refUtxos', refUtxosInfo)
  console.log('spendHandlerScriptHash', spendHandlerScriptHash)


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
    },
    handlerAuthToken: {
      policyId: handlerToken.policy_id,
      name: handlerToken.name,
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

async function mintMockToken(lucid: Lucid) {
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
  lucid: Lucid,
  provider: Provider,
  referredValidators: Script[]
) {
  try {
    console.log("Create reference utxos starting ...");
    const deployLucids: Lucid[] = [];
    for (const _ of referredValidators) {
      const newLucid = await Lucid(provider, "Preview");
      newLucid.selectWallet.fromSeed(generateSeedPhrase());
      deployLucids.push(newLucid);
    }

    const fundDeployAccTx = lucid.newTx();
    await Promise.all(
      deployLucids.map(async (inst) => {
        const address = await inst.wallet().address();
        fundDeployAccTx.pay.ToAddress(address, { lovelace: 100_000_000n });
      })
    );
    await submitTx(fundDeployAccTx, lucid, "Fund Deploy Account", false);

    const [, , referenceAddress] = await readValidator(
      "reference_validator.refer_only.else",
      lucid
    );

    console.log(
      "Submitting transactions for",
      referredValidators.length,
      "validators. This might take a while."
    );

    const createRefUtxoTxs: string[] = [];
    let index = 0;
    for (const validator of referredValidators) {
      const curLucid = deployLucids[index];
      const tx = curLucid.newTx().pay.ToContract(
        referenceAddress,
        {
          kind: "inline",
          value: Data.void(),
        },
        {},
        validator
      );

      const txHash = await submitTx(
        tx,
        curLucid,
        validatorToScriptHash(validator),
        true
      );
      createRefUtxoTxs.push(txHash);
      index++;
    }

    const txHash = createRefUtxoTxs;
    const outRef: OutRef[] = txHash.map((hash) => ({
      txHash: hash,
      outputIndex: 0,
    }));
    const refUtxos = await lucid.utxosByOutRef(outRef);
    const result: { [x: string]: UTxO } = {};
    refUtxos.forEach((utxo) => {
      const scriptHash = validatorToScriptHash(utxo.scriptRef!);
      result[scriptHash] = { ...utxo, datumHash: "" };
    });

    return result;
  } catch (error) {
    console.error("createReferenceUtxos ERR: ", error);
    throw error;
  }
}

const deployHandler = async (
  lucid: Lucid,
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
  const initHandlerDatum: HandlerDatum = {
    state: {
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
    },
    token: { name: HANDLER_TOKEN_NAME, policy_id: mintHandlerPolicyId },
  };

  const spendHandlerAddress = credentialToAddress(lucid.config().network, {
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
        value: Data.to(initHandlerDatum, HandlerDatum),
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
  lucid: Lucid,
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
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .attach.SpendingValidator(spendHandlerValidator)
    .attach.MintingPolicy(mintPortValidator)
    .mintAssets(
      {
        [portTokenUnit]: 1n,
      },
      Data.to(mintPortRedeemer, MintPortRedeemer)
    )
    .attach.MintingPolicy(mintIdentifierValidator)
    .mintAssets(
      {
        [identifierTokenUnit]: 1n,
      },
      Data.to(outputReference, OutputReference)
    )
    .pay.ToContract(
      validatorToAddress(lucid.config().network, spendHandlerValidator),
      {
        kind: "inline",
        value: Data.to(updatedHandlerDatum, HandlerDatum),
      },
      {
        [handlerTokenUnit]: 1n,
      }
    )
    .pay.ToContract(
      spendTransferModuleAddress,
      undefined,
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

const deploySpendChannel = async (
  lucid: Lucid,
  mintClientPolicyId: PolicyId,
  mintConnectionPolicyId: PolicyId,
  mintPortPolicyId: PolicyId,
  verifyProofScriptHash: PolicyId
) => {
  const knownReferredValidatorsName = [
    "chan_open_ack.mint",
    "chan_open_confirm.spend",
    "chan_close_init.spend",
    "chan_close_confirm.spend",
    "recv_packet.mint",
    "send_packet.spend",
    "timeout_packet.spend",
    "acknowledge_packet.spend",
  ] as const;

  const moduleNamesToIgnore = [
    "spending_channel_fixture.ak",
  ];

  const referredValidatorsName = (
    await Array.fromAsync(Deno.readDir("../onchain/validators/spending_channel"))
  )
    .filter((val) => val.isFile)
    // Filtering out test modules
    .filter((val) => !val.name.endsWith(".test.ak"))
    // Filter out modules to ignore
    .filter((val) => moduleNamesToIgnore.indexOf(val.name) == -1)
    .map((val) => {
      const name = val.name.split(".").slice(0, -1).join(".");
      // deno-lint-ignore no-explicit-any
      if (!knownReferredValidatorsName.map(name => name.split(".")[0]).includes(name as any)) {
        throw new Error(
          `Unknown referred validator of spending_channel, expected ${knownReferredValidatorsName}, found: ${name}`
        );
      }
      return name;
    });

  const referredValidators: Record<string, { script: Script; hash: string }> =
    {};

  for (const name of referredValidatorsName) {
    const args = [mintClientPolicyId, mintConnectionPolicyId, mintPortPolicyId];

    if (name !== "send_packet" && name !== "chan_close_init") {
      args.push(verifyProofScriptHash);
    }

    const validator_name = knownReferredValidatorsName.find(fullName => fullName.split(".")[0] === name);

    const [script, hash] = await readValidator(
      `spending_channel/${name}.${validator_name}`,
      lucid,
      args
    );

    referredValidators[name] = {
      script,
      hash,
    };
  }

  const [script, hash, address] = await readValidator(
    "spending_channel.spend_channel.spend",
    lucid,
    knownReferredValidatorsName.map((name) => referredValidators[name.split(".")[0]].hash)
  );

  return {
    base: {
      script,
      hash,
      address,
    },
    referredValidators,
  };
};

const deployMockModule = async (
  lucid: Lucid,
  handlerToken: AuthToken,
  spendHandlerValidator: SpendingValidator,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  mockModulePort: bigint
) => {
  console.log("Create Mock Module");

  const [
    spendMockModuleValidator,
    spendMockModuleScriptHash,
    spendMockModuleAddress,
  ] = await readValidator("spending_mock_module.spend_mock_module.else", lucid);

  const mintPortPolicyId = mintingPolicyToId(mintPortValidator);
  const spendHandlerAddress = validatorToAddress(
    lucid.config().network,
    spendHandlerValidator
  );

  const handlerTokenUnit = handlerToken.policy_id + handlerToken.name;
  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);
  const currentHandlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  const updatedHandlerPorts = [
    ...currentHandlerDatum.state.bound_port,
    mockModulePort,
  ].sort((a, b) => Number(a - b));
  const updatedHandlerDatum: HandlerDatum = {
    ...currentHandlerDatum,
    state: {
      ...currentHandlerDatum.state,
      bound_port: updatedHandlerPorts,
    },
  };
  const spendHandlerRedeemer: HandlerOperator = "HandlerBindPort";

  const portTokenName = await generateTokenName(
    handlerToken,
    PORT_PREFIX,
    mockModulePort
  );
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const mintPortRedeemer: MintPortRedeemer = {
    handler_token: handlerToken,
    spend_module_script_hash: spendMockModuleScriptHash,
    port_number: mockModulePort,
  };

  // load nonce UTXO
  const signerUtxos = await lucid.wallet().getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];

  const outputReference: OutputReference = {
    transaction_id: NONCE_UTXO.txHash,
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  const mintIdentifierPolicyId = validatorToScriptHash(mintIdentifierValidator);
  const identifierTokenName = await generateIdentifierTokenName(outputReference);
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;

  const mintModuleTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO], Data.void())
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .attach.SpendingValidator(spendHandlerValidator)
    .attach.MintingPolicy(mintPortValidator)
    .mintAssets(
      {
        [portTokenUnit]: 1n,
      },
      Data.to(mintPortRedeemer, MintPortRedeemer)
    )
    .attach.MintingPolicy(mintIdentifierValidator)
    .mintAssets(
      {
        [identifierTokenUnit]: 1n,
      },
      Data.to(outputReference, OutputReference)
    )
    .pay.ToContract(
      spendHandlerAddress,
      {
        kind: "inline",
        value: Data.to(updatedHandlerDatum, HandlerDatum),
      },
      {
        [handlerTokenUnit]: 1n,
      }
    );

  await submitTx(mintModuleTx, lucid, "Mint Mock Module");

  return {
    identifierTokenUnit,
    spendMockModule: {
      validator: spendMockModuleValidator,
      scriptHash: spendMockModuleScriptHash,
      address: spendHandlerAddress,
    },
  };
};

const main = async () => {
  if (Deno.args.length < 1) throw new Error("Missing script params");

  const MODE = Deno.args[0];

  const { lucid, provider } = await setUp(MODE);

  const deploymentInfo = await createDeployment(lucid, provider, MODE);

  console.log(deploymentInfo);
};

if (import.meta.main) {
  main();
}
