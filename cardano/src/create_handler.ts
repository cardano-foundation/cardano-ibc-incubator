import {
  applyParamsToScript,
  Constr,
  Data,
  type MintingPolicy,
  type Script,
  type SpendingValidator,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { formatTimestamp, readValidator, setUp, submitTx } from "./utils.ts";
import { EMULATOR_ENV, HANDLER_TOKEN_NAME } from "./constants.ts";
import { HandlerDatum } from "./types/handler.ts";
import { ConfigTemplate } from "./template.ts";
import { ensureDir } from "https://deno.land/std@0.212.0/fs/mod.ts";

if (Deno.args.length < 1) throw new Error("Missing script params");

const MODE = Deno.args[0];

const { lucid, signer } = await setUp(MODE);

// load nonce UTXO
const signerUtxos = await lucid.utxosAt(signer.address);
if (signerUtxos.length < 1) throw new Error("No UTXO founded");
const NONCE_UTXO = signerUtxos[0];
console.log(`Use nonce UTXO: ${NONCE_UTXO.txHash}-${NONCE_UTXO.outputIndex}`);

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

// load mint client validator
const rawMintClientValidator: Script = {
  type: "PlutusV2",
  script: readValidator("minting_client.mint_client"),
};
const mintClientValidator: MintingPolicy = {
  type: "PlutusV2",
  script: applyParamsToScript(rawMintClientValidator.script, [
    spendClientScriptHash,
  ]),
};
const mintClientPolicyId = lucid.utils.mintingPolicyToId(mintClientValidator);

// load spend handler validator
const rawSpendHandlerValidator: Script = {
  type: "PlutusV2",
  script: readValidator("spending_handler.spend_handler"),
};
const spendHandlerValidator: SpendingValidator = {
  type: "PlutusV2",
  script: applyParamsToScript(rawSpendHandlerValidator.script, [
    mintClientPolicyId,
  ]),
};
const spendHandlerScriptHash = lucid.utils.validatorToScriptHash(
  spendHandlerValidator,
);
const spendHandlerAddress = lucid.utils.validatorToAddress(
  spendHandlerValidator,
);

// load mint handler validator
const outputReference = {
  txHash: NONCE_UTXO.txHash,
  outputIndex: NONCE_UTXO.outputIndex,
};
const outRefData = new Constr(0, [
  new Constr(0, [outputReference.txHash]),
  BigInt(outputReference.outputIndex),
]);
const rawMintHandlerValidator: Script = {
  type: "PlutusV2",
  script: readValidator("minting_handler.mint_handler"),
};
const mintHandlerValidator: SpendingValidator = {
  type: "PlutusV2",
  script: applyParamsToScript(rawMintHandlerValidator.script, [
    outRefData,
    spendHandlerScriptHash,
  ]),
};
const mintHandlerPolicyId = lucid.utils.mintingPolicyToId(mintHandlerValidator);
console.log("Validators loaded!");

// get auth token
const handlerAuthToken = mintHandlerPolicyId + HANDLER_TOKEN_NAME;

// create handler datum
const initHandlerDatum: HandlerDatum = {
  state: { next_client_sequence: 0n },
  token: { name: HANDLER_TOKEN_NAME, policyId: mintHandlerPolicyId },
};

// create and send tx create handler
const mintHandlerTx = lucid
  .newTx()
  .collectFrom([NONCE_UTXO], Data.void())
  .attachMintingPolicy(mintHandlerValidator)
  .mintAssets(
    {
      [handlerAuthToken]: 1n,
    },
    Data.void(),
  )
  .payToContract(
    spendHandlerAddress,
    {
      inline: Data.to(initHandlerDatum, HandlerDatum),
    },
    {
      [handlerAuthToken]: 1n,
    },
  );

const mintHandlerTxHash = await submitTx(mintHandlerTx);
console.log("Tx submitted with hash:", mintHandlerTxHash);
console.log("Waiting tx complete");
await lucid.awaitTx(mintHandlerTxHash);
console.log("Mint Handler tx succeeded");
console.log("----------------------------------------------------------");
const deployInfo: ConfigTemplate = {
  validators: {
    spendHandler: {
      title: "spending_handler.spend_handler",
      script: spendHandlerValidator.script,
      scriptHash: spendHandlerScriptHash,
      address: spendHandlerAddress,
    },
    spendClient: {
      title: "spending_client.spend_client",
      script: spendClientValidator.script,
      scriptHash: spendClientScriptHash,
      address: spendClientAddress,
    },
    mintHandlerValidator: {
      title: "minting_handler.mint_handler",
      script: mintHandlerValidator.script,
      scriptHash: mintHandlerPolicyId,
      address: "",
    },
    mintClient: {
      title: "minting_client.mint_client",
      script: mintClientValidator.script,
      scriptHash: mintClientPolicyId,
      address: "",
    },
  },
  nonceUtxo: {
    txHash: NONCE_UTXO.txHash,
    outputIndex: NONCE_UTXO.outputIndex,
  },
  handlerAuthToken: {
    policyId: mintHandlerPolicyId,
    name: HANDLER_TOKEN_NAME,
  },
};

if (MODE != EMULATOR_ENV) {
  const jsonConfig = JSON.stringify(deployInfo);

  const folder = "./deployments";
  await ensureDir(folder);

  const filePath = folder + "/handler_" +
    formatTimestamp(new Date().getTime()) + ".json";

  await Deno.writeTextFile(filePath, jsonConfig);
  console.log("Deploy info saved to:", filePath);
}
