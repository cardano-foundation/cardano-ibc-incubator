// @ts-nocheck
import { CosmosMessage } from '@subql/types-cosmos';
import { MsgRecvPacket } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { MsgAcknowledgement } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { MsgCreateClient } from '../types/proto-interfaces/ibc/core/client/v1/tx';

import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
} from '../types/proto-interfaces/ibc/core/connection/v1/tx';
import { MsgChannelOpenConfirm } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import {
  handleMsgConOpenAck,
  handleMsgConOpenConfirm,
} from './connectionHandler';
import {
  handleMsgChanOpenAck,
  handleMsgChanOpenConfirm,
  handleParseCardanoChannelEvents,
} from './channelHandler';
import { MsgChannelOpenAck } from '../types/proto-interfaces/ibc/core/channel/v1/tx';
import { handleMsgClient, handleParseCardanoClientEvents } from './clientHandler';
import { handleParseCardanoConnectionEvents } from './connectionHandler';
import {
  handleMsgAckPacket,
  handleMsgRecvPacket,
  handleMsgTransfer,
} from './messageHandler';
import { MsgTransfer } from '../types/proto-interfaces/ibc/applications/transfer/v1/tx';

// Cardano
import {
  AlonzoBlock,
  AlonzoRedeemerList,
  BabbageBlock,
  MultiEraBlock as CardanoBlock,
} from '@dcspark/cardano-multiplatform-multiera-lib-nodejs';
import * as handler from '../contracts/handler.json';
import {
  CHANNEL_TOKEN_PREFIX,
  CLIENT_PREFIX,
  CONNECTION_TOKEN_PREFIX,
} from '../constants';
import { fromHex } from '@harmoniclabs/uint8array-utils';

export async function handleMessageAckPacket(
  msg: CosmosMessage<MsgAcknowledgement>
): Promise<void> {
  await handleMsgAckPacket(msg);
}

export async function handleMessageRecvPacket(
  msg: CosmosMessage<MsgRecvPacket>
): Promise<void> {
  await handleMsgRecvPacket(msg);
}

export async function handleMessageTransferPacket(
  msg: CosmosMessage<MsgTransfer>
): Promise<void> {
  await handleMsgTransfer(msg);
}

export async function handleMessageClient(
  msg: CosmosMessage<MsgCreateClient>
): Promise<void> {
  await handleMsgClient(msg);
}

export async function handleMsgConnectionOpenAck(
  msg: CosmosMessage<MsgConnectionOpenAck>
): Promise<void> {
  await handleMsgConOpenAck(msg);
}

export async function handleMsgConnectionOpenConfirm(
  msg: CosmosMessage<MsgConnectionOpenConfirm>
): Promise<void> {
  await handleMsgConOpenConfirm(msg);
}

export async function handleMsgChannelOpenAck(
  msg: CosmosMessage<MsgChannelOpenAck>
): Promise<void> {
  await handleMsgChanOpenAck(msg);
}

export async function handleMsgChannelOpenConfirm(
  msg: CosmosMessage<MsgChannelOpenConfirm>
): Promise<void> {
  await handleMsgChanOpenConfirm(msg);
}


export async function handleCardanoBlock(cborHex: string): Promise<void> {
  const handlerAuthToken = handler.handlerAuthToken;
  const clientTokenPrefix = generateTokenName(handlerAuthToken, CLIENT_PREFIX, '');
  const connectionTokenPrefix = generateTokenName(handlerAuthToken, CONNECTION_TOKEN_PREFIX, '');
  const channelTokenPrefix = generateTokenName(handlerAuthToken, CHANNEL_TOKEN_PREFIX, '');

  const block = from_explicit_network_cbor_bytes(fromHex(cborHex)) as CardanoBlock;
  let mixedBlock;
  let blockHeight = 0n;
  let slot = 0n;
  if (block.as_babbage()) {
    mixedBlock = block.as_babbage();
    blockHeight = mixedBlock.header().header_body().block_number();
    slot = mixedBlock.header().header_body().slot();
  }
  if (block.as_conway()) {
    mixedBlock = block.as_conway();
    blockHeight = mixedBlock.header().header_body().block_number();
    slot = mixedBlock.header().header_body().slot();
  }
  if (block.as_alonzo()) {
    mixedBlock = block.as_alonzo();
    blockHeight = mixedBlock.header().body().block_number();
    slot = mixedBlock.header().body().slot();
  }

  // const babbageBlock = block.as_babbage() as BabbageBlock;
  // const blockHeight = babbageBlock.header().header_body().block_number();
  logger.info(`Handling block ${blockHeight} on Cardano starting`);
  // const slot = babbageBlock.header().header_body().slot();
  const transactionBodies = mixedBlock.transaction_bodies();
  if (!transactionBodies.len()) {
    logger.info(`Block Height ${blockHeight} hasn't transaction`);
    return;
  }

  const outputs: TxOutput[] = extractTxOutput(transactionBodies);
  for (const txOutput of outputs) {
    const isMatchClientTokenPrefix = hasTokenPrefix(txOutput.assets, clientTokenPrefix);
    logger.info({
      isMatchClientTokenPrefix,
      clientTokenPrefix,
    });

    if (hasTokenPrefix(txOutput.assets, clientTokenPrefix)) {
      logger.info('handle client events');
      const transactionWitnessSets = mixedBlock.transaction_witness_sets().get(txOutput.txIndex);
      const rds = transactionWitnessSets.redeemers();
      if (!rds) continue;
      let redeemers: AlonzoRedeemerList | LegacyRedeemerList = rds as AlonzoRedeemerList;
      if (!!rds.as_arr_legacy_redeemer) {
        redeemers = rds.as_arr_legacy_redeemer() as LegacyRedeemerList;
      }
      if (!redeemers?.len()) continue;

      await handleParseCardanoClientEvents(txOutput, redeemers, blockHeight);
    }
    if (hasTokenPrefix(txOutput.assets, connectionTokenPrefix)) {
      logger.info('handle connection events');
      const transactionWitnessSets = mixedBlock.transaction_witness_sets().get(txOutput.txIndex);
      const rds = transactionWitnessSets.redeemers();
      if (!rds) continue;
      let redeemers: AlonzoRedeemerList | LegacyRedeemerList = rds as AlonzoRedeemerList;
      if (!!rds.as_arr_legacy_redeemer) {
        redeemers = rds.as_arr_legacy_redeemer() as LegacyRedeemerList;
      }
      if (!redeemers?.len()) continue;

      await handleParseCardanoConnectionEvents(txOutput, redeemers, blockHeight);
    }
    if (hasTokenPrefix(txOutput.assets, channelTokenPrefix)) {
      logger.info('handle channel events');
      const transactionWitnessSets = mixedBlock.transaction_witness_sets().get(txOutput.txIndex);
      const rds = transactionWitnessSets.redeemers();
      if (!rds) continue;
      let redeemers: AlonzoRedeemerList | LegacyRedeemerList = rds as AlonzoRedeemerList;
      if (!!rds.as_arr_legacy_redeemer) {
        redeemers = rds.as_arr_legacy_redeemer() as LegacyRedeemerList;
      }
      await handleParseCardanoChannelEvents(txOutput, redeemers, blockHeight, slot, transactionWitnessSets);
    }
  }
}
