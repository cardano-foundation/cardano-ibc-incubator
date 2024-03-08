import { Data, Lucid } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { generateTokenName, setUp, submitTx } from "./utils.ts";
import { CLIENT_PREFIX } from "./constants.ts";
import { DeploymentTemplate } from "./template.ts";
import { ClientDatum } from "./types/client_datum.ts";
import { SpendClientRedeemer } from "./types/client_redeemer.ts";
import { ClientState } from "./types/client_state.ts";
import { ConsensusState } from "./types/consensus_state.ts";
import { Height } from "./types/height.ts";
import { SignedHeader } from "./types/cometbft/signed_header.ts";
import { Header } from "./types/header.ts";

export const updateClient = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
) => {
  console.log("Update Client");

  const spendClientRefUtxo = deploymentInfo.validators.spendClient.refUtxo;
  const spendClientAddress = deploymentInfo.validators.spendClient.address;
  const handlerAuthToken = deploymentInfo.handlerAuthToken;
  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;
  console.log("Setup done");

  const CLIENT_ID = 0n;

  const clientTokenName = generateTokenName(
    handlerAuthToken,
    CLIENT_PREFIX,
    CLIENT_ID,
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
      chainId: currentClientDatumState.clientState.chainId,
      height: NEW_HEIGHT.revisionHeight,
      time: BigInt(Date.now()) * BigInt(1e6),
      validatorsHash: Data.to(""),
      nextValidatorsHash: Data.to(""),
      appHash: Data.to(""),
    },
    commit: {
      height: 0n,
      round: 0n,
      blockId: {
        hash: Data.to(""),
        partSetHeader: {
          hash: Data.to(""),
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
        address: Data.to(""),
        pubkey: Data.to(""),
        votingPower: 0n,
        proposerPriority: 0n,
      },
      totalVotingPower: 0n,
    },
    trustedHeight: currentClientDatumState.clientState.latestHeight,
    trustedValidators: {
      validators: [],
      proposer: {
        address: Data.to(""),
        pubkey: Data.to(""),
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

  const updateClientTx = lucid.newTx()
    .readFrom([spendClientRefUtxo])
    .collectFrom(
      [currentClientUtxo],
      Data.to(spendClientRedeemer, SpendClientRedeemer),
    )
    .payToContract(
      spendClientAddress,
      { inline: Data.to(newClientDatum, ClientDatum) },
      {
        [clientTokenUnit]: 1n,
      },
    );

  const updateClientTxHash = await submitTx(updateClientTx);
  console.log("Update client tx hash", updateClientTxHash);
  await lucid.awaitTx(updateClientTxHash);
  console.log("Update client tx completed");
  const updateClientUtxo = await lucid.utxoByUnit(clientTokenUnit);
  console.log(
    "Update client datum\n",
    Data.from(updateClientUtxo.datum!, ClientDatum),
  );
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await updateClient(lucid, deploymentInfo);
};

if (import.meta.main) {
  main();
}
