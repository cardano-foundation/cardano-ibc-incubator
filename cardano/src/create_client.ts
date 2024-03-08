import { Data, fromText, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  generateTokenName,
  queryUtxoByAuthToken,
  setUp,
  submitTx,
} from "./utils.ts";
import { CLIENT_PREFIX } from "./constants.ts";
import { HandlerDatum } from "./types/handler/handler.ts";
import { DeploymentTemplate } from "./template.ts";
import { ClientDatum, ClientDatumState } from "./types/client_datum.ts";
import { MintClientRedeemer } from "./types/client_redeemer.ts";
import { ClientState } from "./types/client_state.ts";
import { ConsensusState } from "./types/consensus_state.ts";
import { HandlerOperator } from "./types/handler/handler_redeemer.ts";

export const createClient = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
) => {
  console.log("Create Client");

  const spendClientAddress = deploymentInfo.validators.spendClient.address;
  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;
  const mintClientRefUtxo = deploymentInfo.validators.mintClient.refUtxo;

  const spendHandlerAddress = deploymentInfo.validators.spendHandler.address;
  const spendHandlerRefUtxo = deploymentInfo.validators.spendHandler.refUtxo;
  const handlerAuthToken = deploymentInfo.handlerAuthToken;

  // query handler utxo
  const handlerAuthTokenUnit = handlerAuthToken.policyId +
    handlerAuthToken.name;
  const handlerUtxo = await lucid.utxoByUnit(handlerAuthTokenUnit);
  console.log(
    "Handler UTXO loaded:",
    handlerUtxo.txHash,
    "-",
    handlerUtxo.outputIndex,
  );
  const currentHandlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  console.log("Current Handler datum:\n", currentHandlerDatum);

  // create new Handler datum
  const currentClientSeq = currentHandlerDatum.state.next_client_sequence;
  const updatedHandlerDatum: HandlerDatum = {
    ...currentHandlerDatum,
    state: {
      ...currentHandlerDatum.state,
      next_client_sequence: currentHandlerDatum.state.next_client_sequence + 1n,
    },
  };

  // create client state datum
  const CHAIN_ID = fromText("01-cosmos");
  const LATEST_HEIGHT = {
    revisionNumber: 0n,
    revisionHeight: 100n,
  };
  const TRUSTING_PERIOD = 10n ** 15n;
  const clientState: ClientState = {
    chainId: CHAIN_ID,
    trustLevel: { numerator: 2n, denominator: 3n },
    trustingPeriod: TRUSTING_PERIOD,
    unbondingPeriod: TRUSTING_PERIOD + 1n,
    maxClockDrift: 1n,
    frozenHeight: {
      revisionNumber: 0n,
      revisionHeight: 0n,
    },
    latestHeight: LATEST_HEIGHT,
    proofSpecs: [],
  };
  const clientTokenName = generateTokenName(
    handlerAuthToken,
    CLIENT_PREFIX,
    currentClientSeq,
  );

  // create consensus state datum
  const CURRENT_TIME = BigInt(Date.now());
  const consensusState: ConsensusState = {
    timestamp: CURRENT_TIME * 10n ** 6n,
    next_validators_hash: Data.to(""),
    root: {
      hash: Data.to(""),
    },
  };

  const clientDatumState: ClientDatumState = {
    clientState: clientState,
    consensusStates: new Map([[LATEST_HEIGHT, consensusState]]),
  };

  const clientDatum: ClientDatum = {
    state: clientDatumState,
    token: {
      policyId: mintClientPolicyId,
      name: clientTokenName,
    },
  };

  const clientAuthTokenUnit = mintClientPolicyId + clientTokenName;

  const txValidTo = Number(CURRENT_TIME) + 600 * 1e3;

  const createClientTx = lucid
    .newTx()
    .readFrom([spendHandlerRefUtxo, mintClientRefUtxo])
    .collectFrom([handlerUtxo], Data.to("CreateClient", HandlerOperator))
    .mintAssets(
      {
        [clientAuthTokenUnit]: 1n,
      },
      Data.to(
        {
          handlerAuthToken: handlerAuthToken,
        },
        MintClientRedeemer,
      ),
    )
    .payToContract(
      spendHandlerAddress,
      {
        inline: Data.to(updatedHandlerDatum, HandlerDatum),
      },
      {
        [handlerAuthTokenUnit]: 1n,
      },
    )
    .payToContract(
      spendClientAddress,
      {
        inline: Data.to(clientDatum, ClientDatum),
      },
      {
        [clientAuthTokenUnit]: 1n,
      },
    )
    .validTo(Number(txValidTo));

  // submit create client tx
  const createClientTxHash = await submitTx(createClientTx);
  console.log("Create client tx submitted:", createClientTxHash);
  await lucid.awaitTx(createClientTxHash);
  console.log("Create client tx succeeded");

  const updatedHandlerUtxo = await queryUtxoByAuthToken(
    lucid,
    spendHandlerAddress,
    handlerAuthTokenUnit,
  );
  console.log(
    `Update Handler at ${updatedHandlerUtxo.txHash}-${updatedHandlerUtxo.outputIndex} datum:\n`,
    Data.from(updatedHandlerUtxo.datum!, HandlerDatum),
  );

  const clientUtxo = await queryUtxoByAuthToken(
    lucid,
    spendClientAddress,
    clientAuthTokenUnit,
  );
  console.log(
    `ClientDatum at ${clientUtxo.txHash}-${clientUtxo.outputIndex} datum:\n`,
    Data.from(clientUtxo.datum!, ClientDatum),
  );
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await createClient(lucid, deploymentInfo);
};

if (import.meta.main) {
  main();
}
