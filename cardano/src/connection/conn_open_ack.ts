import {
  Data,
  fromText,
  Lucid,
  toText,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { DeploymentTemplate } from "../template.ts";
import { generateTokenName, setUp, submitTx } from "../utils.ts";
import { CLIENT_PREFIX } from "../constants.ts";
import { ClientDatum } from "../types/client_datum.ts";
import { ConnectionEnd } from "../types/connection/connection_end.ts";
import { CONNECTION_PREFIX } from "../constants.ts";
import { ConnectionDatum } from "../types/connection/connection_datum.ts";
import { SpendConnectionRedeemer } from "../types/connection/connection_redeemer.ts";
import { Height } from "../types/height.ts";
import { parseClientSequence } from "../utils.ts";

export type Operator = {
  connectionSequence: bigint;
  counterpartyClientState: string;
  counterpartyConnectionID: string;
  proofTry: string;
  proofClient: string;
  proofHeight: Height;
};

export const connOpenAck = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator,
) => {
  console.log("Connection Open Ack");
  const handlerAuthToken = deploymentInfo.handlerAuthToken;

  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;

  const spendConnectionRefUtxo =
    deploymentInfo.validators.spendConnection.refUtxo;
  const spendConnectionAddress =
    deploymentInfo.validators.spendConnection.address;
  const mintConnectionPolicyId =
    deploymentInfo.validators.mintConnection.scriptHash;

  const connectionTokenName = generateTokenName(
    handlerAuthToken,
    CONNECTION_PREFIX,
    op.connectionSequence,
  );
  const connTokenUnit = mintConnectionPolicyId + connectionTokenName;
  const connectionUtxo = await lucid.utxoByUnit(connTokenUnit);
  const connectionDatum = Data.from(connectionUtxo.datum!, ConnectionDatum);
  if (connectionDatum.state.state !== "Init") {
    throw new Error("ConnOpenAck to a Connection not in Init state");
  }
  console.log(
    "Current connection datum with sequence",
    op.connectionSequence,
  );
  console.log(connectionDatum);

  const clientSequence = parseClientSequence(
    toText(connectionDatum.state.client_id),
  );
  const clientTokenName = generateTokenName(
    handlerAuthToken,
    CLIENT_PREFIX,
    clientSequence,
  );
  const clientTokenUnit = mintClientPolicyId + clientTokenName;
  const clientUtxo = await lucid.utxoByUnit(clientTokenUnit);
  console.log(
    `Client state with sequence`,
    clientSequence,
  );
  console.log(Data.from(clientUtxo.datum!, ClientDatum));

  const updatedConnectionEnd: ConnectionEnd = {
    ...connectionDatum.state,
    state: "Open",
    counterparty: {
      ...connectionDatum.state.counterparty,
      connection_id: fromText(op.counterpartyConnectionID),
    },
  };
  const updatedConnectionDatum: ConnectionDatum = {
    ...connectionDatum,
    state: updatedConnectionEnd,
  };

  const spendConnectionRedeemer: SpendConnectionRedeemer = {
    ConnOpenAck: {
      counterparty_client_state: op.counterpartyClientState,
      proof_try: op.proofTry,
      proof_client: op.proofClient,
      proof_height: op.proofHeight,
    },
  };

  const connOpenTryTx = lucid.newTx()
    .readFrom([spendConnectionRefUtxo])
    .collectFrom(
      [connectionUtxo],
      Data.to(spendConnectionRedeemer, SpendConnectionRedeemer),
    )
    .readFrom([clientUtxo])
    .payToContract(spendConnectionAddress, {
      inline: Data.to(updatedConnectionDatum, ConnectionDatum),
    }, {
      [connTokenUnit]: 1n,
    }).validTo(Date.now() + 600 * 1e3);
  const txHash = await submitTx(connOpenTryTx);
  console.log("ConnOpenAck tx submitted with hash:", txHash);
  await lucid.awaitTx(txHash);
  console.log("ConnOpenAck tx completed");
  const updatedConnectionUtxo = await lucid.utxoByUnit(connTokenUnit);
  console.log(
    "Connection datum:\n",
    Data.from(updatedConnectionUtxo.datum!, ConnectionDatum),
  );
};

export const op: Operator = {
  connectionSequence: 0n,
  counterpartyConnectionID: "connection-100",
  counterpartyClientState: "", // hex string
  proofTry: "", // hex string
  proofClient: "", // hex string
  proofHeight: {
    revisionNumber: 0n,
    revisionHeight: 0n,
  },
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await connOpenAck(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
