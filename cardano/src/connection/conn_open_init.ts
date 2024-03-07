import { Data, fromText, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { DeploymentTemplate } from "../template.ts";
import { HandlerDatum } from "../types/handler/handler.ts";
import { generateTokenName, setUp, submitTx } from "../utils.ts";
import { Counterparty } from "../types/connection/counterparty.ts";
import { CLIENT_PREFIX } from "../constants.ts";
import { ClientDatum } from "../types/client_datum.ts";
import { ConnectionEnd } from "../types/connection/connection_end.ts";
import { CONNECTION_PREFIX } from "../constants.ts";
import { AuthToken } from "../types/auth_token.ts";
import { ConnectionDatum } from "../types/connection/connection_datum.ts";
import { MintConnectionRedeemer } from "../types/connection/connection_redeemer.ts";
import { HandlerOperator } from "../types/handler/handler_redeemer.ts";
import { Version } from "../types/connection/version.ts";

export type Operator = {
  clientSequence: bigint;
  counterparty: Counterparty;
  versions: Version[];
  delayPeriod: bigint;
};

export const connOpenInit = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator,
) => {
  console.log("Connection Open Init");
  const spendHandlerRefUtxo = deploymentInfo.validators.spendHandler.refUtxo;
  const spendHandlerAddress = deploymentInfo.validators.spendHandler.address;
  const handlerAuthToken = deploymentInfo.handlerAuthToken;
  const handlerTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;

  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;

  const spendConnectionAddress =
    deploymentInfo.validators.spendConnection.address;
  const mintConnectionRefUtxo =
    deploymentInfo.validators.mintConnection.refUtxo;
  const mintConnectionPolicyId =
    deploymentInfo.validators.mintConnection.scriptHash;

  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);
  const handlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  console.log(
    "Current Handler state:\n",
    handlerDatum,
  );

  const clientTokenName = generateTokenName(
    handlerAuthToken,
    CLIENT_PREFIX,
    op.clientSequence,
  );

  const clientTokenUnit = mintClientPolicyId + clientTokenName;
  const clientUtxo = await lucid.utxoByUnit(clientTokenUnit);
  console.log(
    `Client state with sequence ${op.clientSequence}:\n`,
    Data.from(clientUtxo.datum!, ClientDatum),
  );

  const updatedHandlerDatum: HandlerDatum = {
    ...handlerDatum,
    state: {
      ...handlerDatum.state,
      next_connection_sequence: handlerDatum.state.next_connection_sequence +
        1n,
    },
  };
  const spendHandlerRedeemer: HandlerOperator = "HandlerConnOpenInit";

  const connectionTokenName = generateTokenName(
    handlerAuthToken,
    CONNECTION_PREFIX,
    handlerDatum.state.next_connection_sequence,
  );
  const connToken: AuthToken = {
    policyId: mintConnectionPolicyId,
    name: connectionTokenName,
  };
  const connTokenUnit = mintConnectionPolicyId + connectionTokenName;

  const connectionEnd: ConnectionEnd = {
    client_id: CLIENT_PREFIX + fromText("-" + op.clientSequence),
    counterparty: {
      client_id: fromText(op.counterparty.client_id),
      connection_id: fromText(op.counterparty.connection_id),
      prefix: {
        key_prefix: fromText(op.counterparty.prefix.key_prefix),
      },
    },
    delay_period: op.delayPeriod,
    versions: op.versions.map((v) => ({
      identifier: fromText(v.identifier),
      features: v.features.map((feat) => fromText(feat)),
    })),
    state: "Init",
  };
  const connectionDatum: ConnectionDatum = {
    state: connectionEnd,
    token: connToken,
  };

  const mintConnectionRedeemer: MintConnectionRedeemer = {
    ConnOpenInit: {
      handler_auth_token: handlerAuthToken,
    },
  };

  const connOpenInitTx = lucid.newTx()
    .readFrom([spendHandlerRefUtxo, mintConnectionRefUtxo])
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .mintAssets(
      {
        [connTokenUnit]: 1n,
      },
      Data.to(mintConnectionRedeemer, MintConnectionRedeemer),
    )
    .readFrom([clientUtxo])
    .payToContract(spendHandlerAddress, {
      inline: Data.to(updatedHandlerDatum, HandlerDatum),
    }, {
      [handlerTokenUnit]: 1n,
    })
    .payToContract(spendConnectionAddress, {
      inline: Data.to(connectionDatum, ConnectionDatum),
    }, {
      [connTokenUnit]: 1n,
    }).validTo(Date.now() + 600 * 1e3);
  const txHash = await submitTx(connOpenInitTx);
  console.log("ConnOpenInit tx submitted with hash:", txHash);
  await lucid.awaitTx(txHash);
  console.log("ConnOpenInit tx completed");
  const connUtxo = await lucid.utxoByUnit(connTokenUnit);
  console.log(
    "Connection datum:\n",
    Data.from(connUtxo.datum!, ConnectionDatum),
  );
};

export const op: Operator = {
  clientSequence: 0n,
  counterparty: {
    client_id: "10-cardano-1",
    connection_id: "",
    prefix: { key_prefix: "ibc" },
  },
  delayPeriod: 0n,
  versions: [
    {
      identifier: "1",
      features: [
        "ORDER_ORDERED",
        "ORDER_UNORDERED",
      ],
    },
  ],
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await connOpenInit(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
