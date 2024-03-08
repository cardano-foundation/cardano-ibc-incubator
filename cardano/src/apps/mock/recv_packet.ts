import {
  Data,
  fromText,
  Lucid,
  toText,
} from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { DeploymentTemplate } from "../../template.ts";
import {
  generateTokenName,
  parseConnectionSequence,
  setUp,
  submitTx,
} from "../../utils.ts";
import { CHANNEL_PREFIX, CLIENT_PREFIX } from "../../constants.ts";
import { ClientDatum } from "../../types/client_datum.ts";
import { CONNECTION_PREFIX } from "../../constants.ts";
import { ConnectionDatum } from "../../types/connection/connection_datum.ts";
import { Height } from "../../types/height.ts";
import { parseClientSequence } from "../../utils.ts";
import { ChannelDatum } from "../../types/channel/channel_datum.ts";
import { SpendChannelRedeemer } from "../../types/channel/channel_redeemer.ts";
import { MockModuleDatum } from "../../types/apps/mock/datum.ts";
import { IBCModuleRedeemer } from "../../types/port/ibc_module_redeemer.ts";
import { Packet } from "../../types/channel/packet.ts";
import { insertSortMap } from "../../utils.ts";

export type Operator = {
  channelSequence: bigint;
  packetData: string;
  proofCommitment: string;
  proofHeight: Height;
};

export const recvPacket = async (
  lucid: Lucid,
  deploymentInfo: DeploymentTemplate,
  op: Operator,
) => {
  console.log("Mock Module Recv Packet");
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
    op.channelSequence,
  );
  const channelTokenUnit = mintChannelPolicyId + channelTokenName;
  const channelUtxo = await lucid.utxoByUnit(channelTokenUnit);
  const channelDatum = Data.from(channelUtxo.datum!, ChannelDatum);
  if (channelDatum.state.channel.state !== "Open") {
    throw new Error("RecvPacket to channel not in Open state");
  }
  console.log(
    `Channel state with sequence`,
    op.channelSequence,
  );
  console.log(channelDatum);
  const connectionId = toText(channelDatum.state.channel.connection_hops[0]);

  const connectionTokenName = generateTokenName(
    handlerToken,
    CONNECTION_PREFIX,
    parseConnectionSequence(connectionId),
  );
  const connTokenUnit = mintConnectionPolicyId + connectionTokenName;
  const connectionUtxo = await lucid.utxoByUnit(connTokenUnit);
  const connectionDatum = Data.from(connectionUtxo.datum!, ConnectionDatum);
  console.log(
    "Current connection datum with id",
    connectionId,
  );
  console.log(connectionDatum);

  const clientSequence = parseClientSequence(
    toText(connectionDatum.state.client_id),
  );
  const clientTokenName = generateTokenName(
    handlerToken,
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

  const channelId = CHANNEL_PREFIX + fromText(
    "-" +
      op.channelSequence,
  );

  const packet: Packet = {
    sequence: 0n,
    source_port: channelDatum.state.channel.counterparty.port_id,
    source_channel: channelDatum.state.channel.counterparty.channel_id,
    destination_port: channelDatum.port_id,
    destination_channel: channelId,
    data: fromText(op.packetData),
    timeout_height: {
      revisionNumber: 0n,
      revisionHeight: 0n,
    },
    timeout_timestamp: BigInt(Date.now() + 10000 * 1e3) * 1000000n,
  };
  const updatedChannelDatum: ChannelDatum = {
    ...channelDatum,
    state: {
      ...channelDatum.state,
      packet_receipt: insertSortMap(
        channelDatum.state.packet_receipt,
        packet.sequence,
        "",
      ),
      packet_acknowledgement: insertSortMap(
        channelDatum.state.packet_acknowledgement,
        packet.sequence,
        "08F7557ED51826FE18D84512BF24EC75001EDBAF2123A477DF72A0A9F3640A7C",
      ),
    },
  };

  const spendChannelRedeemer: SpendChannelRedeemer = {
    RecvPacket: {
      packet: packet,
      proof_commitment: fromText(op.proofCommitment),
      proof_height: op.proofHeight,
    },
  };

  const mockModuleIdentifier = deploymentInfo.modules.mock.identifier;
  const mockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  const curMockModuleDatum = Data.from(mockModuleUtxo.datum!, MockModuleDatum);
  const spendMockModuleRefUtxo =
    deploymentInfo.validators.spendMockModule.refUtxo;
  const mockModuleAddress = deploymentInfo.modules.mock.address;
  const spendMockModuleRedeemer: IBCModuleRedeemer = {
    Callback: [{
      OnRecvPacket: {
        channel_id: channelId,
        acknowledgement: {
          response: { AcknowledgementResult: { result: "01" } },
        },
      },
    }],
  };
  const newMockModuleDatum: MockModuleDatum = {
    ...curMockModuleDatum,
    received_packets: [
      ...curMockModuleDatum.received_packets,
      fromText(op.packetData),
    ],
  };

  const recvPacketTx = lucid.newTx()
    .readFrom([spendChannelRefUtxo, spendMockModuleRefUtxo])
    .collectFrom(
      [channelUtxo],
      Data.to(spendChannelRedeemer, SpendChannelRedeemer),
    )
    .collectFrom(
      [mockModuleUtxo],
      Data.to(spendMockModuleRedeemer, IBCModuleRedeemer),
    )
    .readFrom([connectionUtxo, clientUtxo])
    .payToContract(spendChannelAddress, {
      inline: Data.to(updatedChannelDatum, ChannelDatum),
    }, {
      [channelTokenUnit]: 1n,
    })
    .payToContract(mockModuleAddress, {
      inline: Data.to(newMockModuleDatum, MockModuleDatum),
    }, mockModuleUtxo.assets)
    .validTo(Date.now() + 600 * 1e3);
  const txHash = await submitTx(recvPacketTx);
  console.log("RecvPacket tx submitted with hash:", txHash);
  await lucid.awaitTx(txHash);
  console.log("RecvPacket tx completed");
  const updatedChannelUxo = await lucid.utxoByUnit(channelTokenUnit);
  console.log(
    "Channel datum:\n",
    Data.from(updatedChannelUxo.datum!, ChannelDatum),
  );

  const newMockModuleUtxo = await lucid.utxoByUnit(mockModuleIdentifier);
  console.log(
    "Mock module datum:\n",
    Data.from(newMockModuleUtxo.datum!, MockModuleDatum),
  );
};

export const op: Operator = {
  channelSequence: 1n,
  packetData: "this is a packet data",
  proofCommitment: "",
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

  await recvPacket(lucid, deploymentInfo, op);
};

if (import.meta.main) {
  main();
}
