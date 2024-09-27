// @ts-nocheck
import { CosmosMessage } from "@subql/types-cosmos";
import { MsgCreateClient } from "../types/proto-interfaces/ibc/core/client/v1/tx";
import { Client, Event } from "../types";
import { ClientState as ClientOroborous} from "../util/ouroboros";
import { TxOutput } from "./cardanoObject";
import { Data } from '../ibc-types/plutus/data';
import { AlonzoRedeemerList, LegacyRedeemerList } from "@dcspark/cardano-multiplatform-multiera-lib-nodejs";
import { Header, HeaderSchema } from '../ibc-types/client/ics_007_tendermint_client/header/Header';
import { ClientMessageSchema} from '../ibc-types/client/ics_007_tendermint_client/msgs/ClientMessage';
import { ClientDatum } from "../ibc-types/client/ics_007_tendermint_client/client_datum/ClientDatum";
import { SpendClientRedeemer } from '../ibc-types/client/ics_007_tendermint_client/client_redeemer/SpendClientRedeemer';
import { EventType } from "../types";
import * as handler from '../contracts/handler.json';
import { EventAttributeClient} from '../constants/eventAttributes';
import {convertHex2String} from '../utils/hex';
import {
  CLIENT_PREFIX,
  CLIENT_ID_PREFIX,
} from '../constants';

export async function handleMsgClient(
    msg: CosmosMessage<MsgCreateClient>
  ): Promise<void> {
    // logger.info(`Client type ${msg.msg.decodedMsg.clientState?.typeUrl}`);
    const anyData = msg.msg.decodedMsg.clientState?.value;
  
    // handle cosmos base client
    // const clientState = ClientTendermint.decode(anyData ?? new Uint8Array());
  
    // handle cardano client
    const clientState = ClientOroborous.decode(anyData ?? new Uint8Array());
  
    const clientId =
      msg.tx.tx.events
        .find((event) => event.type === "create_client")
        ?.attributes.find((attr) => attr.key === "client_id")
        ?.value.toString() || "";
    const consensusHeight =
      msg.tx.tx.events
        .find((event) => event.type === "create_client")
        ?.attributes.find((attr) => attr.key === "consensus_height")
        ?.value.toString() || "";
    const client = Client.create({
      id: `${msg.block.header.chainId}_${clientId}`,
      height: BigInt(msg.block.block.header.height),
      clientId: clientId,
      counterpartyChainId: clientState.chain_id,
      chainId: msg.block.header.chainId,
    });
    await client.save();
  }

export async function handleParseCardanoClientEvents(
  txOutput: TxOutput,
  redeemers: AlonzoRedeemerList | LegacyRedeemerList,
  blockHeight: bigint
): Promise<void> {
  try {
    logger.info(`handleParseClientEvents starting`);
    const clientDatum = decodeCborHex(txOutput.datum, ClientDatum);
    const latestConsensus = [...clientDatum.state.consensus_states].at(-1);
    const fstRedeemerData = redeemers.get(0).data();
    const txHash = txOutput.hash.toUpperCase();
    let eventType: EventType = EventType.ChannelOpenInit;
    let header = '';
    if (fstRedeemerData.as_constr_plutus_data()?.fields().len() == 0) {
      logger.info('create client');
      // for create client
      // const handlerOperatorRedeemerHex = fstRedeemerData.to_cbor_hex();
      // const handlerOperatorRedeemer = decodeCborHex(handlerOperatorRedeemerHex, HandlerOperator);
      eventType = EventType.CreateClient;
    } else {
      logger.info('update client');
      // for update client
      const spendClientRedeemerHex = redeemers.get(0).data().to_cbor_hex();
      const spendClientRedeemer = decodeCborHex(spendClientRedeemerHex, SpendClientRedeemer);
      eventType = EventType.UpdateClient;

      if (spendClientRedeemer.valueOf().hasOwnProperty('UpdateClient')) {
        // TODO: get header update client
        const UpdateClientSchema = Data.Object({UpdateClient: Data.Object({msg: ClientMessageSchema})});
        type UpdateClientSchema = Data.Static<typeof UpdateClientSchema>;
        const HeaderCaseSchema = Data.Object({HeaderCase: Data.Tuple([HeaderSchema])});
        type HeaderCaseSchema = Data.Static<typeof HeaderCaseSchema>;
        const spendClientRedeemerSchema = spendClientRedeemer.valueOf() as unknown as UpdateClientSchema;
        const clientMessage = spendClientRedeemerSchema['UpdateClient'].msg.valueOf() as unknown as HeaderCaseSchema;
        if (clientMessage.hasOwnProperty('HeaderCase')) {
          // clientMessage['HeaderCase'].valueOf()
          const headerMessage = clientMessage['HeaderCase'].valueOf()[0] as unknown as Header;
          header = encodeCborObj(headerMessage, Header);
        }
      }
    }

    const event = Event.create({
      id: `${txHash}-${txOutput.txIndex}`,
      blockHeight: blockHeight,
      txHash: txHash,
      type: eventType,
      eventAttributes: [
        {
          key: EventAttributeClient.AttributeKeyClientID,
          value: getIdFromTokenAssets(txOutput.assets, handler.handlerAuthToken, CLIENT_PREFIX),
        },
        {
          key: EventAttributeClient.AttributeKeyConsensusHeight,
          value: latestConsensus?.[0].revision_height.toString() ?? '',
        },
        {
          key: EventAttributeClient.AttributeKeyHeader,
          value: header,
        },
      ],
    });

    const clientSequence = getIdFromTokenAssets(txOutput.assets, handler.handlerAuthToken, CLIENT_PREFIX);
    const clientId = `${CLIENT_ID_PREFIX}-${clientSequence}`;
    const network = await getProjectNetwork();
    const chainId = network.networkMagic;

    const client = Client.create({
      id: `${chainId}_${clientId}`,
      height: blockHeight,
      chainId: chainId,
      clientId: clientId,
      counterpartyChainId: convertHex2String(clientDatum.state.client_state.chain_id),
    });
    await client.save();
    await event.save();
    logger.info(`handleParseClientEvents end`);
  } catch (error) {
    logger.info('Handle Parse Client Event ERR: ', error);
  }
}