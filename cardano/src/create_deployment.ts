import {
  applyParamsToScript,
  Data,
  fromText,
  Lucid,
  type MintingPolicy,
  OutRef,
  Provider,
  type Script,
  ScriptHash,
  type SpendingValidator,
  UTxO,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  formatTimestamp,
  generateTokenName,
  readValidator,
  setUp,
} from "./utils.ts";
import {
  EMULATOR_ENV,
  HANDLER_TOKEN_NAME,
  MOCK_MODULE_PORT,
  PORT_PREFIX,
} from "./constants.ts";
import { DeploymentTemplate } from "./template.ts";
import { ensureDir } from "https://deno.land/std@0.212.0/fs/ensure_dir.ts";
import { submitTx } from "./utils.ts";
import {
  OutputReference,
  OutputReferenceSchema,
} from "./types/common/output_reference.ts";
import { HandlerDatum } from "./types/handler/handler.ts";
import { AuthToken, AuthTokenSchema } from "./types/auth_token.ts";
import { MockModuleDatum } from "./types/apps/mock/datum.ts";
import { MintPortRedeemer } from "./types/port/port_redeemer.ts";
import { generateIdentifierTokenName } from "./utils.ts";
import { HandlerOperator } from "./types/handler/handler_redeemer.ts";

// deno-lint-ignore no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  const int = Number.parseInt(this.toString());
  return int ?? this.toString();
};

export const createDeployment = async (
  lucid: Lucid,
  provider: Provider,
  mode?: string,
) => {
  console.log("Create deployment info");

  const referredValidators: Script[] = [];

  // load mint port validator
  const mintPortValidator: MintingPolicy = {
    type: "PlutusV2",
    script: readValidator("minting_port.mint_port"),
  };
  const mintPortPolicyId = lucid.utils.mintingPolicyToId(mintPortValidator);
  referredValidators.push(mintPortValidator);

  // load spend client validator
  const spendClientValidator: SpendingValidator = {
    type: "PlutusV2",
    script: readValidator("spending_client.spend_client"),
  };
  const spendClientScriptHash = lucid.utils.validatorToScriptHash(
    spendClientValidator,
  );
  const spendClientAddress = lucid.utils.validatorToAddress(
    spendClientValidator,
  );
  referredValidators.push(spendClientValidator);

  // load mint client validator
  const mintClientValidator: MintingPolicy = {
    type: "PlutusV2",
    script: applyParamsToScript(readValidator("minting_client.mint_client"), [
      spendClientScriptHash,
    ]),
  };
  const mintClientPolicyId = lucid.utils.mintingPolicyToId(mintClientValidator);
  referredValidators.push(mintClientValidator);
  referredValidators.push(mintClientValidator);

  // load spend connection validator
  const spendConnectionValidator: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(
      readValidator("spending_connection.spend_connection"),
      [mintClientPolicyId],
    ),
  };
  const spendConnectionScriptHash = lucid.utils.validatorToScriptHash(
    spendConnectionValidator,
  );
  const spendConnectionAddress = lucid.utils.validatorToAddress(
    spendConnectionValidator,
  );
  referredValidators.push(spendConnectionValidator);
  referredValidators.push(spendConnectionValidator);

  // load mint connection validator
  const mintConnectionValidator: MintingPolicy = {
    type: "PlutusV2",
    script: applyParamsToScript(
      readValidator("minting_connection.mint_connection"),
      [mintClientPolicyId, spendConnectionScriptHash],
    ),
  };
  const mintConnectionPolicyId = lucid.utils.mintingPolicyToId(
    mintConnectionValidator,
  );
  referredValidators.push(mintConnectionValidator);
  referredValidators.push(mintConnectionValidator);

  // load spend channel validator
  const spendChannelValidator: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(
      readValidator("spending_channel.spend_channel"),
      [mintClientPolicyId, mintConnectionPolicyId, mintPortPolicyId],
    ),
  };
  const spendChannelScriptHash = lucid.utils.validatorToScriptHash(
    spendChannelValidator,
  );
  const spendChannelAddress = lucid.utils.validatorToAddress(
    spendChannelValidator,
  );
  referredValidators.push(spendChannelValidator);

  referredValidators.push(spendChannelValidator);

  // load mint channel validator
  const mintChannelValidator: MintingPolicy = {
    type: "PlutusV2",
    script: applyParamsToScript(readValidator("minting_channel.mint_channel"), [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintPortPolicyId,
      spendChannelScriptHash,
    ]),
  };
  const mintChannelPolicyId = lucid.utils.mintingPolicyToId(
    mintChannelValidator,
  );
  referredValidators.push(mintChannelValidator);

  // load spend handler validator
  const spendHandlerValidator: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(
      readValidator("spending_handler.spend_handler"),
      [
        mintClientPolicyId,
        mintConnectionPolicyId,
        mintChannelPolicyId,
        mintPortPolicyId,
      ],
    ),
  };
  const spendHandlerScriptHash = lucid.utils.validatorToScriptHash(
    spendHandlerValidator,
  );
  const spendHandlerAddress = lucid.utils.validatorToAddress(
    spendHandlerValidator,
  );
  referredValidators.push(spendHandlerValidator);

  // deploy handler
  const [mintHandlerPolicyId, handlerTokenName] = await deployHandler(
    lucid,
    spendHandlerScriptHash,
  );

  const handlerToken: AuthToken = {
    policyId: mintHandlerPolicyId,
    name: handlerTokenName,
  };
  const handlerTokenUnit = mintHandlerPolicyId + handlerTokenName;

  // load mint identifier validator
  const mintIdentifierValidator: MintingPolicy = {
    type: "PlutusV2",
    script: readValidator("minting_identifier.mint_identifier"),
  };
  const mintIdentifierPolicyId = lucid.utils.validatorToScriptHash(
    mintIdentifierValidator,
  );
  referredValidators.push(mintIdentifierValidator);

  // load spend mock module validator
  const portId = fromText("port-" + MOCK_MODULE_PORT.toString());
  const spendMockModuleValidator: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(
      readValidator("spending_mock_module.spend_mock_module"),
      [handlerToken, portId, mintChannelPolicyId],
      Data.Tuple([AuthTokenSchema, Data.Bytes(), Data.Bytes()]) as unknown as [
        AuthToken,
        string,
        string,
      ],
    ),
  };
  const spendMockModuleScriptHash = lucid.utils.validatorToScriptHash(
    spendMockModuleValidator,
  );
  const spendMockModuleAddress = lucid.utils.validatorToAddress(
    spendMockModuleValidator,
  );
  referredValidators.push(spendMockModuleValidator);

  const mockModuleIdentifier = await deployMockModule(
    lucid,
    handlerToken,
    spendHandlerValidator,
    mintPortValidator,
    mintIdentifierValidator,
    spendMockModuleScriptHash,
  );

  const refUtxosInfo = await createReferenceUtxos(
    lucid,
    provider,
    referredValidators,
  );

  console.log("Deployment info created!");

  const deploymentInfo: DeploymentTemplate = {
    validators: {
      spendHandler: {
        title: "spending_handler.spend_handler",
        script: spendHandlerValidator.script,
        scriptHash: spendHandlerScriptHash,
        address: spendHandlerAddress,
        refUtxo: refUtxosInfo[spendHandlerScriptHash],
      },
      spendClient: {
        title: "spending_client.spend_client",
        script: spendClientValidator.script,
        scriptHash: spendClientScriptHash,
        address: spendClientAddress,
        refUtxo: refUtxosInfo[spendClientScriptHash],
      },
      mintClient: {
        title: "minting_client.mint_client",
        script: mintClientValidator.script,
        scriptHash: mintClientPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintClientPolicyId],
      },
      mintConnection: {
        title: "minting_connection.mint_connection",
        script: mintConnectionValidator.script,
        scriptHash: mintConnectionPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintConnectionPolicyId],
      },
      spendConnection: {
        title: "spending_connection.spend_connection",
        script: spendConnectionValidator.script,
        scriptHash: spendConnectionScriptHash,
        address: spendConnectionAddress,
        refUtxo: refUtxosInfo[spendConnectionScriptHash],
      },
      mintChannel: {
        title: "minting_channel.mint_channel",
        script: mintChannelValidator.script,
        scriptHash: mintChannelPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintChannelPolicyId],
      },
      spendChannel: {
        title: "spending_channel.spend_channel",
        script: spendChannelValidator.script,
        scriptHash: spendChannelScriptHash,
        address: spendChannelAddress,
        refUtxo: refUtxosInfo[spendChannelScriptHash],
      },
      mintPort: {
        title: "minting_port.mint_port",
        script: mintPortValidator.script,
        scriptHash: mintPortPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintPortPolicyId],
      },
      spendMockModule: {
        title: "spending_mock_module.spend_mock_module",
        script: spendMockModuleValidator.script,
        scriptHash: spendMockModuleScriptHash,
        address: spendMockModuleAddress,
        refUtxo: refUtxosInfo[spendMockModuleScriptHash],
      },
      mintIdentifier: {
        title: "minting_identifier.mint_identifier",
        script: mintIdentifierValidator.script,
        scriptHash: mintIdentifierPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintIdentifierPolicyId],
      },
    },
    handlerAuthToken: handlerToken,
    modules: {
      handler: {
        identifier: handlerTokenUnit,
        address: spendHandlerAddress,
      },
      mock: {
        identifier: mockModuleIdentifier,
        address: spendMockModuleAddress,
      },
    },
  };

  if (mode !== undefined && mode != EMULATOR_ENV) {
    const jsonConfig = JSON.stringify(deploymentInfo);

    const folder = "./deployments";
    await ensureDir(folder);

    const filePath = folder + "/handler.json";

    await Deno.writeTextFile(filePath, jsonConfig);
    console.log("Deploy info saved to:", filePath);
  }

  return deploymentInfo;
};

async function createReferenceUtxos(
  lucid: Lucid,
  provider: Provider,
  referredValidators: Script[],
) {
  const deployLucids: Lucid[] = await Promise.all(
    referredValidators.map(async (_) => {
      const newLucid = await Lucid.new(provider, "Preview");
      const sk = newLucid.utils.generatePrivateKey();
      newLucid.selectWalletFromPrivateKey(sk);
      return newLucid;
    }),
  );

  const fundDeployAccTx = lucid.newTx();
  await Promise.all(
    deployLucids.map(async (inst) => {
      const address = await inst.wallet.address();
      fundDeployAccTx.payToAddress(address, { lovelace: 100000000n });
    }),
  );
  await submitTx(fundDeployAccTx, lucid, "fundDeployAccTx", false);

  const referenceScript: Script = {
    type: "PlutusV2",
    script: readValidator("reference_validator.refer_only"),
  };
  const referenceAddress = lucid.utils.validatorToAddress(referenceScript);

  const createRefUtxoTxs = referredValidators.map((validator, index) => {
    const curLucid = deployLucids[index];
    const tx = curLucid.newTx().payToContract(
      referenceAddress,
      {
        inline: Data.void(),
        scriptRef: validator,
      },
      {},
    );

    return submitTx(tx, curLucid, undefined, false);
  });

  const txHash = await Promise.all(createRefUtxoTxs);
  const outRef: OutRef[] = txHash.map((hash) => ({
    txHash: hash,
    outputIndex: 0,
  }));
  const refUtxos = await lucid.utxosByOutRef(outRef);
  const result: { [x: string]: UTxO } = {};
  refUtxos.forEach((utxo) => {
    const scriptHash = lucid.utils.validatorToScriptHash(utxo.scriptRef!);
    result[scriptHash] = { ...utxo, datumHash: "" };
  });

  return result;
}

const deployHandler = async (
  lucid: Lucid,
  spendHandlerScriptHash: ScriptHash,
) => {
  console.log("Create Handler");

  // load nonce UTXO
  const signerUtxos = await lucid.wallet.getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];

  // load mint handler validator
  const outputReference: OutputReference = {
    transaction_id: {
      hash: NONCE_UTXO.txHash,
    },
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  const rawMintHandlerValidator: Script = {
    type: "PlutusV2",
    script: readValidator("minting_handler.mint_handler"),
  };
  const mintHandlerValidator: SpendingValidator = {
    type: "PlutusV2",
    script: applyParamsToScript(
      rawMintHandlerValidator.script,
      [outputReference, spendHandlerScriptHash],
      Data.Tuple([OutputReferenceSchema, Data.Bytes()]) as unknown as [
        OutputReference,
        string,
      ],
    ),
  };
  const mintHandlerPolicyId = lucid.utils.mintingPolicyToId(
    mintHandlerValidator,
  );

  const handlerTokenUnit = mintHandlerPolicyId + HANDLER_TOKEN_NAME;

  // create handler datum
  const initHandlerDatum: HandlerDatum = {
    state: {
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: new Map(),
    },
    token: { name: HANDLER_TOKEN_NAME, policyId: mintHandlerPolicyId },
  };

  const spendHandlerAddress = lucid.utils.credentialToAddress({
    type: "Script",
    hash: spendHandlerScriptHash,
  });

  // create and send tx create handler
  const mintHandlerTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO], Data.void())
    .attachMintingPolicy(mintHandlerValidator)
    .mintAssets(
      {
        [handlerTokenUnit]: 1n,
      },
      Data.void(),
    )
    .payToContract(
      spendHandlerAddress,
      {
        inline: Data.to(initHandlerDatum, HandlerDatum),
      },
      {
        [handlerTokenUnit]: 1n,
      },
    );

  const mintHandlerTxHash = await submitTx(mintHandlerTx);
  console.log("Tx submitted with hash:", mintHandlerTxHash);
  console.log("Waiting tx complete");
  await lucid.awaitTx(mintHandlerTxHash);
  console.log("Mint Handler tx succeeded");

  return [mintHandlerPolicyId, HANDLER_TOKEN_NAME];
};

const deployMockModule = async (
  lucid: Lucid,
  handlerToken: AuthToken,
  spendHandlerValidator: SpendingValidator,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  spendMockModuleScriptHash: string,
) => {
  console.log("Create Mock Module");

  const mintPortPolicyId = lucid.utils.validatorToScriptHash(mintPortValidator);
  const spendHandlerAddress = lucid.utils.validatorToAddress(
    spendHandlerValidator,
  );

  const handlerTokenUnit = handlerToken.policyId + handlerToken.name;
  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);
  const currentHandlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);

  const updatedHandlerDatum: HandlerDatum = {
    ...currentHandlerDatum,
    state: {
      ...currentHandlerDatum.state,
      bound_port: currentHandlerDatum.state.bound_port.set(
        MOCK_MODULE_PORT,
        true,
      ),
    },
  };
  const spendHandlerRedeemer: HandlerOperator = "HandlerBindPort";
  const portTokenName = generateTokenName(
    handlerToken,
    PORT_PREFIX,
    MOCK_MODULE_PORT,
  );
  const portTokenUnit = mintPortPolicyId + portTokenName;
  const mintPortRedeemer: MintPortRedeemer = {
    handler_token: handlerToken,
    spend_module_script_hash: spendMockModuleScriptHash,
    port_number: MOCK_MODULE_PORT,
  };

  // load nonce UTXO
  const signerUtxos = await lucid.wallet.getUtxos();
  if (signerUtxos.length < 1) throw new Error("No UTXO founded");
  const NONCE_UTXO = signerUtxos[0];

  const outputReference: OutputReference = {
    transaction_id: {
      hash: NONCE_UTXO.txHash,
    },
    output_index: BigInt(NONCE_UTXO.outputIndex),
  };

  const mintIdentifierPolicyId = lucid.utils.validatorToScriptHash(
    mintIdentifierValidator,
  );
  const identifierTokenName = generateIdentifierTokenName(outputReference);
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;

  const initModuleDatum: MockModuleDatum = {
    opened_channels: new Map(),
    received_packets: [],
  };

  const spendModuleAddress = lucid.utils.credentialToAddress({
    type: "Script",
    hash: spendMockModuleScriptHash,
  });

  console.log({ spendModuleAddress });

  const mintModuleTx = lucid
    .newTx()
    .collectFrom([NONCE_UTXO], Data.void())
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .attachSpendingValidator(spendHandlerValidator)
    .attachMintingPolicy(mintPortValidator)
    .mintAssets(
      {
        [portTokenUnit]: 1n,
      },
      Data.to(mintPortRedeemer, MintPortRedeemer),
    )
    .attachMintingPolicy(mintIdentifierValidator)
    .mintAssets(
      {
        [identifierTokenUnit]: 1n,
      },
      Data.to(outputReference, OutputReference),
    )
    .payToContract(
      spendHandlerAddress,
      {
        inline: Data.to(updatedHandlerDatum, HandlerDatum),
      },
      {
        [handlerTokenUnit]: 1n,
      },
    )
    .payToContract(
      spendModuleAddress,
      {
        inline: Data.to(initModuleDatum, MockModuleDatum),
      },
      {
        [identifierTokenUnit]: 1n,
        [portTokenUnit]: 1n,
      },
    );

  await submitTx(mintModuleTx, lucid, "Mint Mock Module");

  return identifierTokenUnit;
};

const main = async () => {
  if (Deno.args.length < 1) throw new Error("Missing script params");

  const MODE = "local";

  const { lucid, provider } = await setUp(MODE);

  console.log(await createDeployment(lucid, provider, MODE));
};

if (import.meta.main) {
  main();
}
