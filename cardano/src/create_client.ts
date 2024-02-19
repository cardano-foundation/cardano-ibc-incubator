import {
  C,
  Data,
  fromHex,
  fromText,
  type MintingPolicy,
  type SpendingValidator,
  toHex,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { queryUtxoByAuthToken, setUp, submitTx } from "./utils.ts";
import { HandlerDatum } from "./types/handler.ts";
import { ClientState } from "./types/client_state.ts";
import { ClientDatum, ClientDatumState } from "./types/client_datum.ts";
import { CLIENT_TOKEN_PREFIX } from "./constants.ts";
import { ConsensusState } from "./types/consensus_state.ts";
import { HandlerOperator } from "./types/handler_redeemer.ts";
import { MintClientRedeemer } from "./types/client_redeemer.ts";
import { ConfigTemplate } from "./template.ts";
import { BLOCKFROST_ENV } from "./constants.ts";

if (Deno.args.length < 2) throw new Error("Missing script params");

const MODE = Deno.args[0];

const { lucid, signer } = await setUp(MODE);

const signerUtxos = await lucid.utxosAt(signer.address);
if (signerUtxos.length < 1) throw new Error("No UTXO founded");

const DEPLOYMENT_FILE_PATH = Deno.args[1];
const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
const deploymentInfo: ConfigTemplate = JSON.parse(deploymentRaw);

const spendClientAddress = deploymentInfo.validators.spendClient.address;

const mintClientValidator: MintingPolicy = {
  type: "PlutusV2",
  script: deploymentInfo.validators.mintClient.script,
};
const mintClientPolicyId = lucid.utils.mintingPolicyToId(mintClientValidator);
const spendHandlerValidator: SpendingValidator = {
  type: "PlutusV2",
  script: deploymentInfo.validators.spendHandler.script,
};
const spendHandlerAddress = lucid.utils.validatorToAddress(
  spendHandlerValidator,
);
const handlerAuthToken = deploymentInfo.handlerAuthToken;
console.log("Deployment info and validator loaded");

// query handler utxo
const handlerAuthTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;
const handlerUtxos = await lucid.utxosAt(spendHandlerAddress);
const handlerUtxo = handlerUtxos.find(
  (utxo) => handlerAuthTokenUnit in utxo.assets,
);
if (!handlerUtxo) throw new Error("Unable to find Handler UTXO");
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
  state: { next_client_sequence: currentClientSeq + 1n },
  token: handlerAuthToken,
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
  unbondingPeriod: 11n ** 15n,
  maxClockDrift: 1n,
  frozenHeight: {
    revisionNumber: 0n,
    revisionHeight: 0n,
  },
  latestHeight: LATEST_HEIGHT,
  proofSpecs: [],
};
const clientTokenName = toHex(
  C.hash_blake2b256(
    fromHex(
      handlerAuthTokenUnit +
        CLIENT_TOKEN_PREFIX +
        Data.to(currentClientSeq),
    ),
  ),
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

const createClientTxValidTo = Number(CURRENT_TIME) + 100 * 1e3;

const createClientTx = lucid
  .newTx()
  .collectFrom([handlerUtxo], Data.to("CreateClient", HandlerOperator))
  .attachSpendingValidator(spendHandlerValidator)
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
  .attachMintingPolicy(mintClientValidator)
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
  ).validTo(createClientTxValidTo);

// submit create client tx
const createClientTxHash = await submitTx(
  createClientTx,
  MODE != BLOCKFROST_ENV,
);
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
