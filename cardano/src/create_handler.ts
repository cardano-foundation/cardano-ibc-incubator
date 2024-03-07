import {
  applyParamsToScript,
  Data,
  Lucid,
  Script,
  SpendingValidator,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { readValidator, setUp, submitTx } from "./utils.ts";
import { HANDLER_TOKEN_NAME } from "./constants.ts";
import { HandlerDatum } from "./types/handler/handler.ts";
import { DeploymentTemplate } from "./template.ts";
import {
  OutputReference,
  OutputReferenceSchema,
} from "./types/common/output_reference.ts";
import { AuthToken } from "./types/auth_token.ts";

export const createHandler = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
) => {
  console.log("Create Handler");

  const spendHandlerScriptHash =
    deploymentInfo.validators.spendHandler.scriptHash;

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
        string
      ]
    ),
  };
  const mintHandlerPolicyId =
    lucid.utils.mintingPolicyToId(mintHandlerValidator);

  const handlerToken: AuthToken = {
    policyId: mintHandlerPolicyId,
    name: HANDLER_TOKEN_NAME,
  };
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
      }
    );

  const mintHandlerTxHash = await submitTx(mintHandlerTx);
  console.log("Tx submitted with hash:", mintHandlerTxHash);
  console.log("Waiting tx complete");
  await lucid.awaitTx(mintHandlerTxHash);
  console.log("Mint Handler tx succeeded");

  return { handlerToken, handlerTokenUnit };
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await createHandler(lucid, deploymentInfo);
};

if (import.meta.main) {
  main();
}
