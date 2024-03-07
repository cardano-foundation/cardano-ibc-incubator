import {
  Data,
  fromText,
  Lucid,
  toText,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { DeploymentTemplate } from "../template.ts";
import { HandlerDatum } from "../types/handler/handler.ts";
import {
  generateTokenName,
  parseClientSequence,
  parseConnectionSequence,
  setUp,
  submitTx,
} from "../utils.ts";
import { CLIENT_PREFIX, MOCK_MODULE_VERSION } from "../constants.ts";
import { ClientDatum } from "../types/client_datum.ts";
import { CONNECTION_PREFIX } from "../constants.ts";
import { AuthToken } from "../types/auth_token.ts";
import { ConnectionDatum } from "../types/connection/connection_datum.ts";
import { HandlerOperator } from "../types/handler/handler_redeemer.ts";
import { CHANNEL_PREFIX } from "../constants.ts";
import { Channel } from "../types/channel/channel.ts";
import { Order } from "../types/channel/order.ts";
import { ChannelDatum } from "../types/channel/channel_datum.ts";
import { MintChannelRedeemer } from "../types/channel/channel_redeemer.ts";
import { ChannelDatumState } from "../types/channel/channel_datum.ts";
import { MockModuleDatum } from "../types/apps/mock/datum.ts";
import { IBCModuleRedeemer } from "../types/port/ibc_module_redeemer.ts";
import { MOCK_MODULE_PORT } from "../constants.ts";

export type Operator = {
  connectionId: string;
  counterpartyPortId: string;
  ordering: Order;
  version: string;
  port_id: string;
};

export const chanOpenInit = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator,
) => {
  console.log("Channel Open Init");

  const spendHandlerRefUtxo = deploymentInfo.validators.spendHandler.refUtxo;
  const spendHandlerAddress = deploymentInfo.validators.spendHandler.address;
  const handlerToken = deploymentInfo.handlerAuthToken;
  const handlerTokenUnit = handlerToken.policyId + handlerToken.name;

  const mintClientPolicyId = deploymentInfo.validators.mintClient.scriptHash;

  const mintConnectionPolicyId =
    deploymentInfo.validators.mintConnection.scriptHash;

  const spendChannelAddress = deploymentInfo.validators.spendChannel.address;
  const mintChannelRefUtxo = deploymentInfo.validators.mintChannel.refUtxo;
  const mintChannelPolicyId = deploymentInfo.validators.mintChannel.scriptHash;

  const handlerUtxo = await lucid.utxoByUnit(handlerTokenUnit);
  const handlerDatum = Data.from(handlerUtxo.datum!, HandlerDatum);
  console.log(
    "Current Handler state:\n",
    handlerDatum,
  );

  const connectionTokenName = generateTokenName(
    handlerToken,
    CONNECTION_PREFIX,
    parseConnectionSequence(op.connectionId),
  );
  const connectionUtxo = await lucid.utxoByUnit(
    mintConnectionPolicyId + connectionTokenName,
  );
  const connectionDatum = Data.from(connectionUtxo.datum!, ConnectionDatum);
  console.log(
    "Connection state with id",
    op.connectionId,
  );
  console.log(connectionDatum);
  const connectionClientId = toText(connectionDatum.state.client_id);

  const clientTokenName = generateTokenName(
    handlerToken,
    CLIENT_PREFIX,
    parseClientSequence(connectionClientId),
  );
  const clientUtxo = await lucid.utxoByUnit(
    mintClientPolicyId + clientTokenName,
  );
  console.log(
    "Client state with id",
    connectionClientId,
  );
  console.log(Data.from(clientUtxo.datum!, ClientDatum));

  const updatedHandlerDatum: HandlerDatum = {
    ...handlerDatum,
    state: {
      ...handlerDatum.state,
      next_channel_sequence: handlerDatum.state.next_channel_sequence +
        1n,
    },
  };
  const spendHandlerRedeemer: HandlerOperator = "HandlerChanOpenInit";

  const channelTokenName = generateTokenName(
    handlerToken,
    CHANNEL_PREFIX,
    handlerDatum.state.next_channel_sequence,
  );
  const channelToken: AuthToken = {
    policyId: mintChannelPolicyId,
    name: channelTokenName,
  };
  const channelTokenUnit = mintChannelPolicyId + channelTokenName;

  const channel: Channel = {
    state: "Init",
    counterparty: {
      port_id: fromText(op.counterpartyPortId),
      channel_id: fromText(""),
    },
    ordering: op.ordering,
    connection_hops: [fromText(op.connectionId)],
    version: fromText(op.version),
  };

  const channelDatumState: ChannelDatumState = {
    channel,
    next_sequence_send: 1n,
    next_sequence_recv: 1n,
    next_sequence_ack: 1n,
    packet_commitment: new Map(),
    packet_receipt: new Map(),
    packet_acknowledgement: new Map(),
  };

  const channelDatum: ChannelDatum = {
    state: channelDatumState,
    port_id: fromText(op.port_id),
    token: channelToken,
  };
  const mintChannelRedeemer: MintChannelRedeemer = {
    ChanOpenInit: {
      handler_token: handlerToken,
    },
  };

  const mockModuleIdentifier = deploymentInfo.modules.mock.identifier;
  const mockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  const curMockModuleDatum = Data.from(mockModuleUtxo.datum!, MockModuleDatum);
  const spendMockModuleRefUtxo =
    deploymentInfo.validators.spendMockModule.refUtxo;
  const mockModuleAddress = deploymentInfo.modules.mock.address;

  const channelId = CHANNEL_PREFIX + fromText(
    "-" +
      handlerDatum.state.next_channel_sequence.toString(),
  );
  const spendMockModuleRedeemer: IBCModuleRedeemer = {
    Callback: [{
      OnChanOpenInit: {
        channel_id: channelId,
      },
    }],
  };

  const newMockModuleDatum: MockModuleDatum = {
    ...curMockModuleDatum,
    opened_channels: curMockModuleDatum.opened_channels.set(channelId, true),
  };

  const chanOpenInitTx = lucid.newTx()
    .readFrom([spendHandlerRefUtxo, mintChannelRefUtxo, spendMockModuleRefUtxo])
    .collectFrom([handlerUtxo], Data.to(spendHandlerRedeemer, HandlerOperator))
    .collectFrom(
      [mockModuleUtxo],
      Data.to(spendMockModuleRedeemer, IBCModuleRedeemer),
    )
    .mintAssets(
      {
        [channelTokenUnit]: 1n,
      },
      Data.to(mintChannelRedeemer, MintChannelRedeemer),
    )
    .readFrom([connectionUtxo, clientUtxo])
    .payToContract(spendHandlerAddress, {
      inline: Data.to(updatedHandlerDatum, HandlerDatum),
    }, {
      [handlerTokenUnit]: 1n,
    })
    .payToContract(spendChannelAddress, {
      inline: Data.to(channelDatum, ChannelDatum),
    }, {
      [channelTokenUnit]: 1n,
    })
    .payToContract(mockModuleAddress, {
      inline: Data.to(newMockModuleDatum, MockModuleDatum),
    }, mockModuleUtxo.assets)
    .validTo(Date.now() + 600 * 1e3);
  await submitTx(chanOpenInitTx, lucid, "ChanOpenInit");

  const channelUtxo = await lucid.utxoByUnit(channelTokenUnit);
  console.log(
    "Channel datum:\n",
    Data.from(channelUtxo.datum!, ChannelDatum),
  );

  const newMockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  console.log(
    "Mock module datum:\n",
    Data.from(newMockModuleUtxo.datum!, MockModuleDatum),
  );
};

export const op: Operator = {
  connectionId: "connection-0",
  counterpartyPortId: "bank",
  ordering: "Unordered",
  version: MOCK_MODULE_VERSION,
  port_id: "port-" + MOCK_MODULE_PORT.toString(),
};

const main = async () => {
  if (Deno.args.length < 2) throw new Error("Missing script params");

  const MODE = Deno.args[0];
  const DEPLOYMENT_FILE_PATH = Deno.args[1];

  const { lucid } = await setUp(MODE);
  const deploymentRaw = await Deno.readTextFile(DEPLOYMENT_FILE_PATH);
  const deploymentInfo: DeploymentTemplate = JSON.parse(deploymentRaw);

  await chanOpenInit(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
