import {
  Data,
  fromText,
  Lucid,
  toText,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { DeploymentTemplate } from "../template.ts";
import {
  generateTokenName,
  parseConnectionSequence,
  setUp,
  submitTx,
} from "../utils.ts";
import {
  CHANNEL_PREFIX,
  CLIENT_PREFIX,
  MOCK_MODULE_VERSION,
} from "../constants.ts";
import { ClientDatum } from "../types/client_datum.ts";
import { CONNECTION_PREFIX } from "../constants.ts";
import { ConnectionDatum } from "../types/connection/connection_datum.ts";
import { Height } from "../types/height.ts";
import { parseClientSequence } from "../utils.ts";
import { ChannelDatum } from "../types/channel/channel_datum.ts";
import { SpendChannelRedeemer } from "../types/channel/channel_redeemer.ts";
import { MockModuleDatum } from "../types/apps/mock/datum.ts";
import { IBCModuleRedeemer } from "../types/port/ibc_module_redeemer.ts";

export type Operator = {
  channelSequence: bigint;
  counterpartyChannelId: string;
  counterpartyVersion: string;
  proofTry: string; // hex string
  proofHeight: Height;
};

export const chanOpenAck = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator
) => {
  console.log("Channel Open Ack");
  const handlerToken = deploymentInfo.handlerAuthToken;

  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;
  const mintConnectionPolicyId =
    deploymentInfo.validators.mintConnection.scriptHash;
  const mintChannelPolicyId = deploymentInfo.validators.mintChannel.scriptHash;

  const spendChannelRefUtxo = deploymentInfo.validators.spendChannel.refUtxo;
  const spendChannelAddress = deploymentInfo.validators.spendChannel.address;

  const channelTokenName = generateTokenName(
    handlerToken,
    CHANNEL_PREFIX,
    op.channelSequence
  );
  const channelTokenUnit = mintChannelPolicyId + channelTokenName;
  const channelUtxo = await lucid.utxoByUnit(channelTokenUnit);
  const channelDatum = Data.from(channelUtxo.datum!, ChannelDatum);
  if (channelDatum.state.channel.state !== "Init") {
    throw new Error("ChanOpenAck to channel not in Init state");
  }
  console.log(`Channel state with sequence`, op.channelSequence);
  console.log(channelDatum);
  const connectionId = toText(channelDatum.state.channel.connection_hops[0]);

  const connectionTokenName = generateTokenName(
    handlerToken,
    CONNECTION_PREFIX,
    parseConnectionSequence(connectionId)
  );
  const connTokenUnit = mintConnectionPolicyId + connectionTokenName;
  const connectionUtxo = await lucid.utxoByUnit(connTokenUnit);
  const connectionDatum = Data.from(connectionUtxo.datum!, ConnectionDatum);
  console.log("Current connection datum with id", connectionId);
  console.log(connectionDatum);

  const clientSequence = parseClientSequence(
    toText(connectionDatum.state.client_id)
  );
  const clientTokenName = generateTokenName(
    handlerToken,
    CLIENT_PREFIX,
    clientSequence
  );
  const clientTokenUnit = mintClientPolicyId + clientTokenName;
  const clientUtxo = await lucid.utxoByUnit(clientTokenUnit);
  console.log(`Client state with sequence`, clientSequence);
  console.log(Data.from(clientUtxo.datum!, ClientDatum));

  const updatedChannelDatum: ChannelDatum = {
    ...channelDatum,
    state: {
      ...channelDatum.state,
      channel: {
        ...channelDatum.state.channel,
        state: "Open",
        counterparty: {
          ...channelDatum.state.channel.counterparty,
          channel_id: fromText(op.counterpartyChannelId),
        },
      },
    },
  };

  const spendChannelRedeemer: SpendChannelRedeemer = {
    ChanOpenAck: {
      counterparty_version: fromText(op.counterpartyVersion),
      proof_try: fromText(op.proofTry),
      proof_height: op.proofHeight,
    },
  };

  const mockModuleIdentifier = deploymentInfo.modules.mock.identifier;
  const mockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  const curMockModuleDatum = Data.from(mockModuleUtxo.datum!, MockModuleDatum);
  const spendMockModuleRefUtxo =
    deploymentInfo.validators.spendMockModule.refUtxo;
  const mockModuleAddress = deploymentInfo.modules.mock.address;
  const channelId = CHANNEL_PREFIX + fromText("-" + op.channelSequence);
  const spendMockModuleRedeemer: IBCModuleRedeemer = {
    Callback: [
      {
        OnChanOpenAck: {
          channel_id: channelId,
        },
      },
    ],
  };
  const newMockModuleDatum: MockModuleDatum = curMockModuleDatum;

  const chanOpenAckTx = lucid
    .newTx()
    .readFrom([spendChannelRefUtxo, spendMockModuleRefUtxo])
    .collectFrom(
      [channelUtxo],
      Data.to(spendChannelRedeemer, SpendChannelRedeemer)
    )
    .collectFrom(
      [mockModuleUtxo],
      Data.to(spendMockModuleRedeemer, IBCModuleRedeemer)
    )
    .readFrom([connectionUtxo, clientUtxo])
    .payToContract(
      spendChannelAddress,
      {
        inline: Data.to(updatedChannelDatum, ChannelDatum),
      },
      {
        [channelTokenUnit]: 1n,
      }
    )
    .payToContract(
      mockModuleAddress,
      {
        inline: Data.to(newMockModuleDatum, MockModuleDatum),
      },
      mockModuleUtxo.assets
    )
    .validTo(Date.now() + 600 * 1e3);
  const txHash = await submitTx(chanOpenAckTx);
  console.log("ChanOpenAck tx submitted with hash:", txHash);
  await lucid.awaitTx(txHash);
  console.log("ChanOpenAck tx completed");
  const updatedChannelUxo = await lucid.utxoByUnit(channelTokenUnit);
  console.log(
    "Channel datum:\n",
    Data.from(updatedChannelUxo.datum!, ChannelDatum)
  );

  const newMockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  console.log(
    "Mock module datum:\n",
    Data.from(newMockModuleUtxo.datum!, MockModuleDatum)
  );
};

export const op: Operator = {
  channelSequence: 0n,
  counterpartyChannelId: "channel-0",
  counterpartyVersion: MOCK_MODULE_VERSION,
  proofTry: "",
  proofHeight: {
    revisionNumber: 0n,
    revisionHeight: 99n,
  },
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await chanOpenAck(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
