import {
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
} from "npm:@dinhbx/lucid-custom";
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
import { ensureDir } from "https://deno.land/std@0.212.0/fs/ensure_dir.ts";
import { submitTx } from "./utils.ts";
import {
  AuthToken,
  AuthTokenSchema,
} from "../lucid-types/ibc/auth/AuthToken.ts";
import { HandlerDatum } from "../lucid-types/ibc/core/ics_025_handler_interface/handler_datum/HandlerDatum.ts";
import { HandlerOperator } from "../lucid-types/ibc/core/ics_025_handler_interface/handler_redeemer/HandlerOperator.ts";
import {
  OutputReference,
  OutputReferenceSchema,
} from "../lucid-types/aiken/transaction/OutputReference.ts";
import { MintPortRedeemer } from "../lucid-types/ibc/core/ics_005/port_redeemer/MintPortRedeemer.ts";
import { insertSortMap } from "./utils.ts";

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
  const [mintPortValidator, mintPortPolicyId] = readValidator(
    "minting_port.mint_port",
    lucid,
  );
  referredValidators.push(mintPortValidator);

  // load spend client validator
  const [spendClientValidator, spendClientScriptHash, spendClientAddress] =
    readValidator("spending_client.spend_client", lucid);
  referredValidators.push(spendClientValidator);

  // load mint client validator
  const [mintClientValidator, mintClientPolicyId] = readValidator(
    "minting_client.mint_client",
    lucid,
    [
      spendClientScriptHash,
    ],
  );
  referredValidators.push(mintClientValidator);

  // load spend connection validator
  const [
    spendConnectionValidator,
    spendConnectionScriptHash,
    spendConnectionAddress,
  ] = readValidator("spending_connection.spend_connection", lucid, [
    mintClientPolicyId,
  ]);
  referredValidators.push(spendConnectionValidator);

  // load mint connection validator
  const [mintConnectionValidator, mintConnectionPolicyId] = readValidator(
    "minting_connection.mint_connection",
    lucid,
    [mintClientPolicyId, spendConnectionScriptHash],
  );
  referredValidators.push(mintConnectionValidator);

  // load spend channel validator
  const [spendChannelValidator, spendChannelScriptHash, spendChannelAddress] =
    readValidator("spending_channel.spend_channel", lucid, [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintPortPolicyId,
    ]);
  referredValidators.push(spendChannelValidator);

  // load mint channel validator
  const [mintChannelValidator, mintChannelPolicyId] = readValidator(
    "minting_channel.mint_channel",
    lucid,
    [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintPortPolicyId,
      spendChannelScriptHash,
    ],
  );
  referredValidators.push(mintChannelValidator);

  // load spend handler validator
  const [spendHandlerValidator, spendHandlerScriptHash, spendHandlerAddress] =
    readValidator("spending_handler.spend_handler", lucid, [
      mintClientPolicyId,
      mintConnectionPolicyId,
      mintChannelPolicyId,
      mintPortPolicyId,
    ]);
  referredValidators.push(spendHandlerValidator);

  // deploy handler
  const [mintHandlerPolicyId, handlerTokenName] = await deployHandler(
    lucid,
    spendHandlerScriptHash,
  );

  const handlerToken: AuthToken = {
    policy_id: mintHandlerPolicyId,
    name: handlerTokenName,
  };
  const handlerTokenUnit = mintHandlerPolicyId + handlerTokenName;

  // load mint identifier validator
  const [mintIdentifierValidator, mintIdentifierPolicyId] = readValidator(
    "minting_identifier.mint_identifier",
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
    mintChannelPolicyId,
    TRANSFER_MODULE_PORT,
  );
  referredValidators.push(mintVoucher.validator, spendTransferModule.validator);

  const refUtxosInfo = await createReferenceUtxos(
    lucid,
    provider,
    referredValidators,
  );

  const [mockTokenPolicyId, mockTokenName] = await mintMockToken(lucid);

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
      mintIdentifier: {
        title: "minting_identifier.mint_identifier",
        script: mintIdentifierValidator.script,
        scriptHash: mintIdentifierPolicyId,
        address: "",
        refUtxo: refUtxosInfo[mintIdentifierPolicyId],
      },
      spendTransferModule: {
        title: "spending_transfer_module.spend_transfer_module",
        script: spendTransferModule.validator.script,
        scriptHash: spendTransferModule.scriptHash,
        address: spendTransferModule.address,
        refUtxo: refUtxosInfo[spendTransferModule.scriptHash],
      },
      mintVoucher: {
        title: "minting_voucher.mint_voucher",
        script: mintVoucher.validator.script,
        scriptHash: mintVoucher.policyId,
        address: "",
        refUtxo: refUtxosInfo[mintVoucher.policyId],
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

async function mintMockToken(lucid: Lucid) {
  // load mint mock token validator
  const [mintMockTokenValidator, mintMockTokenPolicyId] = readValidator(
    "minting_mock_token.mint_mock_token",
    lucid,
  );

  const tokenName = fromText("mock");

  const tokenUnit = mintMockTokenPolicyId + tokenName;

  const tx = lucid.newTx().attachMintingPolicy(mintMockTokenValidator)
    .mintAssets({
      [tokenUnit]: 9999999999n,
    }, Data.void()).payToAddress(
      "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql",
      {
        [tokenUnit]: 999999999n,
      },
    );

  await submitTx(tx, lucid, "Mint mock token");

  return [mintMockTokenPolicyId, tokenName];
}

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
      fundDeployAccTx.payToAddress(address, { lovelace: 1000000000n });
    }),
  );
  await submitTx(fundDeployAccTx, lucid, "fundDeployAccTx", false);

  const [, , referenceAddress] = readValidator(
    "reference_validator.refer_only",
    lucid,
  );

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

  const [mintHandlerValidator, mintHandlerPolicyId] = readValidator(
    "minting_handler.mint_handler",
    lucid,
    [outputReference, spendHandlerScriptHash],
    Data.Tuple([OutputReferenceSchema, Data.Bytes()]) as unknown as [
      OutputReference,
      string,
    ],
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

const deployTransferModule = async (
  lucid: Lucid,
  handlerToken: AuthToken,
  spendHandlerValidator: SpendingValidator,
  mintPortValidator: MintingPolicy,
  mintIdentifierValidator: MintingPolicy,
  mintChannelPolicyId: string,
  portNumber: bigint,
) => {
  console.log("Create Transfer Module");

  // generate identifier token
  const [nonceUtxo, outputReference] = await getNonceOutRef(lucid);
  const mintIdentifierPolicyId = lucid.utils.validatorToScriptHash(
    mintIdentifierValidator,
  );
  const identifierTokenName = generateIdentifierTokenName(outputReference);
  const identifierToken: AuthToken = {
    policy_id: mintIdentifierPolicyId,
    name: identifierTokenName,
  };
  const identifierTokenUnit = mintIdentifierPolicyId + identifierTokenName;
  const [mintVoucherValidator, mintVoucherPolicyId] = readValidator(
    "minting_voucher.mint_voucher",
    lucid,
    [identifierToken],
    Data.Tuple([AuthTokenSchema]) as unknown as [
      AuthToken,
    ],
  );

  const portId = fromText("port-" + portNumber.toString());
  const mintPortPolicyId = lucid.utils.validatorToScriptHash(mintPortValidator);
  const portTokenName = generateTokenName(
    handlerToken,
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
  ] = readValidator(
    "spending_transfer_module.spend_transfer_module",
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
    ]) as unknown as [
      AuthToken,
      AuthToken,
      AuthToken,
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
      // bound_port: insertSortMap(
      //   currentHandlerDatum.state.bound_port,
      //   portNumber,
      //   true,
      // ),
      bound_port: [...currentHandlerDatum.state.bound_port, portNumber].toSorted(),
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
      lucid.utils.validatorToAddress(
        spendHandlerValidator,
      ),
      {
        inline: Data.to(updatedHandlerDatum, HandlerDatum),
      },
      {
        [handlerTokenUnit]: 1n,
      },
    )
    .payToContract(
      spendTransferModuleAddress,
      {
        inline: Data.void(),
      },
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

const main = async () => {
  if (Deno.args.length < 1) throw new Error("Missing script params");

  const MODE = Deno.args[0];

  const { lucid, provider } = await setUp(MODE);

  console.log(await createDeployment(lucid, provider, MODE));
};

if (import.meta.main) {
  main();
}
