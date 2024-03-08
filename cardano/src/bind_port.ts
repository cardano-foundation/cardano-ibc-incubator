import { Data, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  generateTokenName,
  queryUtxoByAuthToken,
  setUp,
  submitTx,
} from "./utils.ts";
import { PORT_PREFIX } from "./constants.ts";
import { HandlerDatum } from "./types/handler/handler.ts";
import { DeploymentTemplate } from "./template.ts";
import { HandlerOperator } from "./types/handler/handler_redeemer.ts";
import { MintPortRedeemer } from "./types/port/port_redeemer.ts";

type Operator = {
  moduleScriptHash: string;
  port: bigint;
};

export const bindPort = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator,
) => {
  console.log("Bind Port");

  const mintPortRefUtxo = deploymentInfo.validators.mintPort.refUtxo;
  const mintPortPolicyId = deploymentInfo.validators.mintPort.scriptHash;

  const spendHandlerRefUtxo = deploymentInfo.validators.spendHandler.refUtxo;
  const spendHandlerAddress = deploymentInfo.validators.spendHandler.address;
  const handlerToken = deploymentInfo.handlerAuthToken;

  // query handler utxo
  const handlerTokenUnit = handlerToken.policyId +
    handlerToken.name;
  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);
  const currentHandlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  console.log("Current Handler datum:\n", currentHandlerDatum);

  if (currentHandlerDatum.state.bound_port.get(op.port) === true) {
    throw new Error(`Port ${op.port.toString()} already bound`);
  }

  const currentBoundPortsInArray = Array.from(
    currentHandlerDatum.state.bound_port.entries(),
  );
  currentBoundPortsInArray.push([op.port, true]);
  currentBoundPortsInArray.sort(([port1], [port2]) => Number(port1 - port2));
  const newBoundPorts = new Map(currentBoundPortsInArray);

  // create new Handler datum
  const updatedHandlerDatum: HandlerDatum = {
    ...currentHandlerDatum,
    state: {
      ...currentHandlerDatum.state,
      bound_port: newBoundPorts,
    },
  };

  const spendHandlerRedeemer: HandlerOperator = "HandlerBindPort";

  const portTokenName = generateTokenName(handlerToken, PORT_PREFIX, op.port);
  const portTokenUnit = mintPortPolicyId + portTokenName;

  const moduleAddress = lucid.utils.credentialToAddress({
    type: "Script",
    hash: op.moduleScriptHash,
  });

  const mintPortRedeemer: MintPortRedeemer = {
    handler_token: handlerToken,
    spend_module_script_hash: op.moduleScriptHash,
    port_number: op.port,
  };

  const bindPortTx = lucid
    .newTx()
    .readFrom([spendHandlerRefUtxo, mintPortRefUtxo])
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .mintAssets(
      {
        [portTokenUnit]: 1n,
      },
      Data.to(
        mintPortRedeemer,
        MintPortRedeemer,
      ),
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
      moduleAddress,
      {
        inline: Data.void(),
      },
      {
        [portTokenUnit]: 1n,
      },
    );

  // submit Bind port tx
  const bindPortTxHash = await submitTx(bindPortTx);
  console.log("Bind port tx submitted:", bindPortTxHash);
  await lucid.awaitTx(bindPortTxHash);
  console.log("Bind port tx succeeded");

  const updatedHandlerUtxo = await queryUtxoByAuthToken(
    lucid,
    spendHandlerAddress,
    handlerTokenUnit,
  );
  console.log(
    `Update Handler at ${updatedHandlerUtxo.txHash}-${updatedHandlerUtxo.outputIndex} datum:\n`,
    Data.from(updatedHandlerUtxo.datum!, HandlerDatum),
  );

  const moduleUtxo = await lucid.utxoByUnit(portTokenUnit);
  console.log(
    `Module utxo at ${moduleUtxo.txHash}-${moduleUtxo.outputIndex} datum:`,
  );
  console.log(moduleUtxo);
};

export const op: Operator = {
  moduleScriptHash: "01029fca1bb1edf147556b464caf8feb251b2a06ab9accc574ba4e69",
  port: 0n,
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await bindPort(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
