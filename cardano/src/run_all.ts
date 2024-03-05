import {
  applyParamsToScript,
  C,
  Constr,
  Data,
  fromHex,
  fromText,
  type MintingPolicy,
  type Script,
  type SpendingValidator,
  toHex,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import {
  formatTimestamp,
  queryUtxoByAuthToken,
  readValidator,
  setUp,
  submitTx,
} from "./utils.ts";
import {
  CLIENT_TOKEN_PREFIX,
  EMULATOR_ENV,
  HANDLER_TOKEN_NAME,
  KUPMIOS_ENV,
} from "./constants.ts";
import { HandlerDatum } from "./types/handler.ts";
import { ConfigTemplate } from "./template.ts";
import { ClientDatum, ClientDatumState } from "./types/client_datum.ts";
import {
  MintClientRedeemer,
  SpendClientRedeemer,
} from "./types/client_redeemer.ts";
import { ClientState } from "./types/client_state.ts";
import { ConsensusState } from "./types/consensus_state.ts";
import { HandlerOperator } from "./types/handler_redeemer.ts";
import { ensureDir } from "https://deno.land/std@0.212.0/fs/ensure_dir.ts";
import { BLOCKFROST_ENV } from "./constants.ts";
import { LOCAL_ENV } from "./constants.ts";
import { Height } from "./types/height.ts";
import { SignedHeader } from "./types/cometbft/signed_header.ts";
import { Header } from "./types/header.ts";

if (Deno.args.length < 1) throw new Error("Missing script params");

const MODE = Deno.args[0];

const { lucid, signer } = await setUp(MODE);

const createHandler = async () => {
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
  const mintHandlerPolicyId = lucid.utils.mintingPolicyToId(
    mintHandlerValidator,
  );
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

  return deployInfo;
};

const createClient = async (deploymentInfo: ConfigTemplate) => {
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
  const handlerAuthTokenUnit = handlerAuthToken.policyId +
    handlerAuthToken.name;
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
    unbondingPeriod: TRUSTING_PERIOD + 1n,
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

  const txValidTo = Number(CURRENT_TIME) + 100 * 1e3;

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
    ).validTo(Number(txValidTo));

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
};

const updateClient = async (deploymentInfo: ConfigTemplate) => {
  const spendClientValidator: SpendingValidator = {
    type: "PlutusV2",
    script: deploymentInfo.validators.spendClient.script,
  };
  const spendClientAddress = deploymentInfo.validators.spendClient.address;
  const handlerAuthToken = deploymentInfo.handlerAuthToken;
  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;
  console.log("Setup done");

  const CLIENT_ID = Data.to(0n);

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
      chainId: currentClientDatumState.clientState.chainId,
      height: NEW_HEIGHT.revisionHeight,
      time: BigInt(Date.now()) * BigInt(1e6),
      validatorsHash: Data.to(""),
      nextValidatorsHash: Data.to(""),
      appHash: Data.to(""),
    },
    commit: {
      height: 0n,
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

  const updateClientTx = lucid.newTx().collectFrom(
    [currentClientUtxo],
    Data.to(spendClientRedeemer, SpendClientRedeemer),
  ).attachSpendingValidator(spendClientValidator)
    .payToContract(
      spendClientAddress,
      { inline: Data.to(newClientDatum, ClientDatum) },
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
  if (MODE == BLOCKFROST_ENV) {
    console.log("Delay 30s");
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } else if (MODE == KUPMIOS_ENV || MODE == LOCAL_ENV) {
    console.log("Delay 10s");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  const updateClientUtxo = await lucid.utxoByUnit(clientTokenUnit);
  console.log(
    "Update client\n",
    Data.from(updateClientUtxo.datum!, ClientDatum),
  );
};

const deploymentInfo = await createHandler();
console.log("=".repeat(70));

if (MODE == BLOCKFROST_ENV) {
  console.log("Delay 30s");
  await new Promise((resolve) => setTimeout(resolve, 30000));
} else if (MODE == KUPMIOS_ENV || MODE == LOCAL_ENV) {
  console.log("Delay 10s");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}

await createClient(deploymentInfo);

if (MODE == BLOCKFROST_ENV) {
  console.log("Delay 30s");
  await new Promise((resolve) => setTimeout(resolve, 30000));
} else if (MODE == KUPMIOS_ENV || MODE == LOCAL_ENV) {
  console.log("Delay 10s");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}

await updateClient(deploymentInfo);
