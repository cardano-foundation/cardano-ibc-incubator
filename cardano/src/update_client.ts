import {
  C,
  Data,
  fromHex,
  type SpendingValidator,
  toHex,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { setUp, submitTx } from "./utils.ts";
import { ClientState } from "./types/client_state.ts";
import { ClientDatum } from "./types/client_datum.ts";
import { CLIENT_TOKEN_PREFIX } from "./constants.ts";
import { ConsensusState } from "./types/consensus_state.ts";
import { ConfigTemplate } from "./temple.ts";
import { BLOCKFROST_ENV } from "./constants.ts";
import { SignedHeader } from "./types/cometbft/signed_header.ts";
import { Height } from "./types/height.ts";
import { SpendClientRedeemer } from "./types/client_redeemer.ts";
import { Header } from "./types/header.ts";

if (Deno.args.length < 2) throw new Error("Missing script params");

const MODE = Deno.args[0];

const { lucid, signer } = await setUp(MODE);

const signerUtxos = await lucid.utxosAt(signer.address);
if (signerUtxos.length < 1) throw new Error("No UTXO founded");

const DEPLOYMENT_FILE_PATH = Deno.args[1];
const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
const deploymentInfo: ConfigTemplate = JSON.parse(deploymentRaw);
const spendClientValidator: SpendingValidator = {
  type: "PlutusV2",
  script: deploymentInfo.validators.spendClient.script,
};
const spendClientAddress = deploymentInfo.validators.spendClient.address;
const handlerAuthToken = deploymentInfo.handlerAuthToken;
const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;
console.log("Setup done");

const CLIENT_ID = Data.to(0n);

console.log(
  handlerAuthToken.policyId,
  handlerAuthToken.name,
  CLIENT_TOKEN_PREFIX,
);

const clientTokenName = toHex(
  C.hash_blake2b256(
    fromHex(
      handlerAuthToken.policyId + handlerAuthToken.name +
        CLIENT_TOKEN_PREFIX +
        CLIENT_ID,
    ),
  ),
);
const clientTokenUnit = mintClientPolicyId + clientTokenName;
const currentClientUtxo = await lucid.utxoByUnit(clientTokenUnit);
const currentClientDatum = Data.from(currentClientUtxo.datum!, ClientDatum);
const currentClientDatumState = currentClientDatum.state;

const NEW_HEIGHT: Height = {
  ...currentClientDatumState.clientState.latestHeight,
  revisionHeight:
    currentClientDatumState.clientState.latestHeight.revisionHeight + 1n,
};

const signedHeader: SignedHeader = {
  header: {
    chain_id: currentClientDatumState.clientState.chainId,
    height: NEW_HEIGHT.revisionHeight,
    time: BigInt(Date.now()) * BigInt(1e6),
    validatorsHash: "",
    nextValidatorsHash:
      "a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5",
    appHash: "92dad9443e4dd6d70a7f11872101ebff87e21798e4fbb26fa4bf590eb440e71b",
  },
  commit: {
    height: 0n,
    blockId: {
      hash: "",
      partSetHeader: {
        hash: "",
        total: 0n,
      },
    },
    signatures: [],
  },
};
const header: Header = {
  signedHeader,
  validatorSet: {
    validators: [],
    proposer: {
      address: "",
      pubkey: "",
      votingPower: 0n,
      proposerPriority: 0n,
    },
    totalVotingPower: 0n,
  },
  trustedHeight: currentClientDatumState.clientState.latestHeight,
  trustedValidators: {
    validators: [],
    proposer: {
      address: "",
      pubkey: "",
      votingPower: 0n,
      proposerPriority: 0n,
    },
    totalVotingPower: 0n,
  },
};
const spendClientRedeemer: SpendClientRedeemer = {
  UpdateClient: {
    header,
  },
};

const newClientState: ClientState = {
  ...currentClientDatumState.clientState,
  latestHeight: NEW_HEIGHT,
};

const newConsState: ConsensusState = {
  timestamp: signedHeader.header.time,
  next_validators_hash: signedHeader.header.nextValidatorsHash,
  root: {
    hash: signedHeader.header.appHash,
  },
};
const currentConsStateInArray = Array.from(
  currentClientDatumState.consensusStates.entries(),
);
currentConsStateInArray.push([NEW_HEIGHT, newConsState]);
currentConsStateInArray.sort(([height1], [height2]) => {
  if (height1.revisionNumber == height2.revisionNumber) {
    return Number(height1.revisionHeight - height2.revisionHeight);
  }
  return Number(height1.revisionNumber - height2.revisionNumber);
});
const newConsStates = new Map(currentConsStateInArray);

const newClientDatum: ClientDatum = {
  ...currentClientDatum,
  state: {
    clientState: newClientState,
    consensusStates: newConsStates,
  },
};

console.log(newClientDatum);

const updateClientTx = lucid.newTx().collectFrom(
  [currentClientUtxo],
  Data.to(spendClientRedeemer, SpendClientRedeemer),
).attachSpendingValidator(spendClientValidator)
  .payToContract(
    spendClientAddress,
    Data.to(newClientDatum, ClientDatum),
    {
      [clientTokenUnit]: 1n,
    },
  );

const updateClientTxHash = await submitTx(
  updateClientTx,
  MODE != BLOCKFROST_ENV,
);
console.log("Update client tx hash", updateClientTxHash);
await lucid.awaitTx(updateClientTxHash);
console.log("Update client tx completed");
const updateClientUtxo = await lucid.utxoByUnit(clientTokenUnit);
console.log("Update client\n", Data.from(updateClientUtxo.datum!, ClientDatum));
