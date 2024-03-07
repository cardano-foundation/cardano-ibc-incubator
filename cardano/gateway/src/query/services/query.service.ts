/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  QueryBlockDataRequest,
  QueryBlockDataResponse,
  QueryClientStateRequest,
  QueryClientStateResponse,
  QueryConsensusStateRequest,
  QueryConsensusStateResponse,
  QueryLatestHeightRequest,
  QueryLatestHeightResponse,
  QueryNewClientRequest,
  QueryNewClientResponse,
} from '@cosmjs-types/src/ibc/core/client/v1/query';
import { BlockData, ClientState, ConsensusState } from '@cosmjs-types/src/ibc/lightclients/ouroboros/ouroboros';
import {
  ClientState as ClientStateTendermint,
  ConsensusState as ConsensusStateTendermint,
} from '@cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import {
  InteractionContext,
  WebSocketCloseHandler,
  WebSocketErrorHandler,
  createInteractionContext,
} from '@cardano-ogmios/client';
import { StateQueryClient, createStateQueryClient } from '@cardano-ogmios/client/dist/StateQuery';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { BlockDto } from '../dtos/block.dto';
import { connectionConfig } from '@config/kupmios.config';
import { Any } from '@cosmjs-types/src/google/protobuf/any';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { decodeHandlerDatum } from '@shared/types/handler-datum';
import { normalizeClientStateFromDatum } from '@shared/helpers/client-state';
import { normalizeConsensusStateFromDatum } from '@shared/helpers/consensus-state';
import { ClientDatum, decodeClientDatum } from '@shared/types/client-datum';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { normalizeBlockDataFromOuroboros } from '@shared/helpers/block-data';
import { GrpcInternalException } from 'nestjs-grpc-exceptions';
import { QueryBlockResultsRequest, QueryBlockResultsResponse } from '@cosmjs-types/src/ibc/core/types/v1/query';
import { UtxoDto } from '../dtos/utxo.dto';
import {
  CHANNEL_TOKEN_PREFIX,
  CLIENT_PREFIX,
  CONNECTION_TOKEN_PREFIX,
  EVENT_TYPE_CHANNEL,
  EVENT_TYPE_CLIENT,
  EVENT_TYPE_CONNECTION,
  EVENT_TYPE_SPO,
  REDEEMER_EMPTY_DATA,
  REDEEMER_TYPE,
} from '../../constant';
import { AuthToken } from '@shared/types/auth-token';
import { ConnectionDatum, decodeConnectionDatum } from '@shared/types/connection/connection-datum';
import {
  normalizeTxsResultFromChannelDatum,
  normalizeTxsResultFromClientDatum,
  normalizeTxsResultFromConnDatum,
  normalizeTxsResultFromChannelRedeemer,
  normalizeTxsResultFromModuleRedeemer,
} from '@shared/helpers/block-results';
import { ResponseDeliverTx, ResultBlockResults } from '@cosmjs-types/src/ibc/core/types/v1/block';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '@shared/types/channel/channel-datum';
import { getChannelIdByTokenName, getConnectionIdFromConnectionHops } from '@shared/helpers/channel';
import { getConnectionIdByTokenName } from '@shared/helpers/connection';
import { UTxO } from 'lucid-cardano';
import { bytesFromBase64 } from '@cosmjs-types/src/helpers';
import { getIdByTokenName } from '@shared/helpers/helper';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { decodeMintChannelRedeemer, decodeSpendChannelRedeemer } from '../../shared/types/channel/channel-redeemer';
import {
  decodeMintConnectionRedeemer,
  decodeSpendConnectionRedeemer,
} from '../../shared/types/connection/connection-redeemer';
import { decodeIBCModuleRedeemer } from '../../shared/types/port/ibc_module_redeemer';

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectEntityManager() private entityManager: EntityManager,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
  ) {}

  async newClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }

    const genesisConfig = await (await this.getStateQueryClient()).genesisConfig();
    this.logger.log(genesisConfig, 'genesisConfig');
    const blockHeight = await (await this.getStateQueryClient()).blockHeight();
    this.logger.log(blockHeight, 'blockHeight');
    const systemStart = await (await this.getStateQueryClient()).systemStart();
    this.logger.log(systemStart, 'systemStart');

    const blockDto: BlockDto = await this.dbService.findBlockByHeight(height);
    const currentEpoch = blockDto.epoch;
    this.logger.log(currentEpoch, 'currentEpoch');
    const currentValidatorSet = await this.dbService.findActiveValidatorsByEpoch(BigInt(currentEpoch));
    this.logger.log(currentValidatorSet, 'currentValidatorSet');
    const nextValidatorSet = await this.dbService.findActiveValidatorsByEpoch(BigInt(currentEpoch + 1));
    this.logger.log(nextValidatorSet, 'nextValidatorSet');
    const clientState: ClientState = {
      chain_id: genesisConfig.networkMagic.toString(),
      latest_height: {
        revision_height: BigInt(height),
        revision_number: BigInt(0),
      }, // need -> ok
      frozen_height: {
        revision_height: BigInt(0),
        revision_number: BigInt(0),
      },
      valid_after: BigInt(0),
      genesis_time: BigInt(systemStart.getTime() / 1000), // need -> ok
      current_epoch: BigInt(currentEpoch), // need -> ok
      epoch_length: BigInt(genesisConfig.epochLength), // need  -> ok
      slot_per_kes_period: BigInt(genesisConfig.slotsPerKesPeriod), // need -> ok
      current_validator_set: currentValidatorSet, // need -> ok
      next_validator_set: nextValidatorSet, // need -> ok
      trusting_period: BigInt(0),
      upgrade_path: [],
      token_configs: {
        /** IBC handler token uint (policyID + name), in hex format */
        handler_token_unit: this.lucidService.getHandlerTokenUnit(),
        /** IBC client token policyID, in hex format */
        client_policy_id: this.lucidService.getClientPolicyId(),
        /** IBC connection token policyID, in hex format */
        connection_policy_id: this.lucidService.getConnectionPolicyId(),
        /** IBC channel token policyID, in hex format */
        channel_policy_id: this.lucidService.getChannelPolicyId(),
      },
    };

    // this.logger.log(clientState);

    const clientStateAny: Any = {
      type_url: '/ibc.clients.cardano.v1.ClientState',
      value: ClientState.encode(clientState).finish(),
    };

    const timestampInMilliseconds = systemStart.getTime() + blockDto.slot * 1000;
    const consensusState: ConsensusState = {
      timestamp: BigInt(timestampInMilliseconds / 1000), // need -> ok
      slot: BigInt(blockDto.slot), // need -> ok
    };

    // this.logger.log(consensusState);

    const consensusStateAny: Any = {
      type_url: '/ibc.clients.cardano.v1.ConsensusState',
      value: ConsensusState.encode(consensusState).finish(),
    };

    const response: QueryNewClientResponse = {
      client_state: clientStateAny,
      consensus_state: consensusStateAny,
    };

    // this.logger.log(response);

    return response;
  }

  async latestHeight(request: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse> {
    const blockHeight = await (await this.getStateQueryClient()).blockHeight();
    const latestHeightResponse = {
      height: blockHeight == 'origin' ? 0 : blockHeight,
    };
    this.logger.log(latestHeightResponse.height, 'QueryLatestHeight');
    return latestHeightResponse as unknown as QueryLatestHeightResponse;
  }

  async getStateQueryClient(): Promise<StateQueryClient> {
    const errorHandler: WebSocketErrorHandler = (error: Error) => {
      this.logger.error(error);
    };

    const closeHandler: WebSocketCloseHandler = (code, reason) => {};

    const interactionContext: InteractionContext = await createInteractionContext(errorHandler, closeHandler, {
      connection: connectionConfig,
      interactionType: 'OneTime',
    });

    return await createStateQueryClient(interactionContext);
  }

  private async getClientDatum(): Promise<[ClientDatum, UTxO]> {
    // Get handlerUTXO
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;
    const handlerUtxo = await this.lucidService.findUtxoByUnit(handlerAuthTokenUnit);
    const handlerDatum = await decodeHandlerDatum(handlerUtxo.datum, this.lucidService.LucidImporter);

    const clientAuthTokenUnit = this.lucidService.getClientAuthTokenUnit(handlerDatum);
    const spendClientUTXO = await this.lucidService.findUtxoByUnit(clientAuthTokenUnit);

    const clientDatum = await decodeClientDatum(spendClientUTXO.datum, this.lucidService.LucidImporter);
    return [clientDatum, spendClientUTXO];
  }

  async queryClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    const [clientDatum, spendClientUTXO] = await this.getClientDatum();
    const clientStateTendermint = normalizeClientStateFromDatum(clientDatum.state.clientState);

    const proofHeight = await this.dbService.findHeightByTxHash(spendClientUTXO.txHash);
    const clientStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ClientState',
      value: ClientStateTendermint.encode(clientStateTendermint).finish(),
    };

    const response = {
      client_state: clientStateAny,
      proof: bytesFromBase64(btoa(`0-${proofHeight}/client/${spendClientUTXO.txHash}/${spendClientUTXO.outputIndex}`)),
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    };

    return response as unknown as QueryClientStateResponse;
  }

  async queryConsensusState(request: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse> {
    const [clientDatum, spendClientUTXO] = await this.getClientDatum();
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    let heightReq = BigInt(height.toString());
    if (height == BigInt(0)) {
      heightReq = clientDatum.state.clientState.latestHeight.revisionHeight;
    }
    const consensusStateTendermint = normalizeConsensusStateFromDatum(clientDatum.state.consensusStates, heightReq);
    if (!consensusStateTendermint)
      throw new GrpcNotFoundException(`Unable to find Consensus State at height ${heightReq}`);
    const consensusStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
      value: ConsensusStateTendermint.encode(consensusStateTendermint).finish(),
    };
    const proofHeight = await this.dbService.findHeightByTxHash(spendClientUTXO.txHash);
    const response = {
      consensus_state: consensusStateAny,
      proof: bytesFromBase64(
        btoa(`0-${proofHeight}/consensus/${spendClientUTXO.txHash}/${spendClientUTXO.outputIndex}`),
      ),
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    };
    return response as unknown as QueryConsensusStateResponse;
  }

  async queryBlockData(request: QueryBlockDataRequest): Promise<QueryBlockDataResponse> {
    const { height } = request;
    this.logger.log(height, 'queryBlockData');
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }

    const blockNo = parseInt(height.toString(), 10);
    const blockDto: BlockDto = await this.dbService.findBlockByHeight(height);
    try {
      const results = await lastValueFrom(
        await this.httpService.get(`${this.configService.get('cardanoBridgeUrl')}/blocks`, {
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
          },
          params: {
            height: blockNo,
          },
        }),
      );
      const blockDataRes = results?.data;

      const blockDataOuroboros = normalizeBlockDataFromOuroboros(blockDataRes);
      if (blockDto.epoch > 0) {
        const epochParam = await this.dbService.findEpochParamByEpochNo(BigInt(blockDto.epoch));
        blockDataOuroboros.epoch_nonce = epochParam.nonce;
      }
      const blockData: QueryBlockDataResponse = {
        block_data: {
          type_url: 'ibc.clients.cardano.v1.BlockData',
          value: BlockData.encode(blockDataOuroboros).finish(),
        },
      } as unknown as QueryBlockDataResponse;
      return blockData;
    } catch (err) {
      this.logger.error('queryBlockData ERR:', err);

      this.logger.error(err.message, 'queryBlockData ERR:');

      throw new GrpcInternalException(err.message);
    }
  }

  async queryBlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse> {
    const { height } = request;
    this.logger.log(height, 'queryBlockResults');
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    const blockDto: BlockDto = await this.dbService.findBlockByHeight(request.height);
    if (!blockDto) {
      throw new GrpcNotFoundException(`Not found: "height" ${request.height} not found`);
    }

    try {
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const mintConnScriptHash = this.configService.get('deployment').validators.mintConnection.scriptHash;
      const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

      // connection +channel
      const utxosInBlock = await this.dbService.findUtxosByBlockNo(parseInt(request.height.toString()));
      const txsResults = await Promise.all(
        utxosInBlock
          .filter((utxo) => [mintConnScriptHash, minChannelScriptHash].includes(utxo.assetsPolicy))
          .map(async (utxo) => {
            switch (utxo.assetsPolicy) {
              case mintConnScriptHash:
                return await this._parseEventConnection(utxo, handlerAuthToken);
              case minChannelScriptHash:
                return await this._parseEventChannel(utxo, handlerAuthToken);
            }
          }),
      );

      // client state + consensus state
      const authOrClientUTxos = await this.dbService.findUtxoClientOrAuthHandler(parseInt(request.height.toString()));
      const txsAuthOrClientsResults = await this._parseEventClient(authOrClientUTxos);

      // register/unregister event spo
      const spoEvents = await this._querySpoEvents(request.height);

      const blockResults: ResultBlockResults = {
        height: {
          revision_height: request.height,
          revision_number: BigInt(0),
        },
        txs_results: [...txsAuthOrClientsResults, ...txsResults, ...spoEvents],
      } as unknown as ResultBlockResults;

      const responseBlockResults: QueryBlockResultsResponse = {
        block_results: blockResults,
      } as unknown as QueryBlockResultsResponse;

      return responseBlockResults;
    } catch (err) {
      console.error(err);

      this.logger.error(err);

      this.logger.error(err.message, 'queryBlockResults');
      throw new GrpcInternalException(err.message);
    }
  }

  private async _querySpoEvents(height: BigInt): Promise<ResponseDeliverTx[]> {
    const txsResults: ResponseDeliverTx[] = [];
    const hasEventRegister = await this.dbService.checkExistPoolUpdateByBlockNo(parseInt(height.toString()));
    if (hasEventRegister) {
      txsResults.push(<ResponseDeliverTx>{
        code: 0,
        events: [
          {
            type: EVENT_TYPE_SPO.REGISTER,
            event_attribute: [],
          },
        ],
      });
    }

    const hasEventUnRegister = await this.dbService.checkExistPoolRetireByBlockNo(parseInt(height.toString()));
    if (hasEventUnRegister) {
      txsResults.push(<ResponseDeliverTx>{
        code: 0,
        events: [
          {
            type: EVENT_TYPE_SPO.UNREGISTER,
            event_attribute: [],
          },
        ],
      });
    }

    return txsResults;
  }

  private async _parseEventConnection(utxo: UtxoDto, handlerAuthToken: AuthToken): Promise<ResponseDeliverTx> {
    const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(utxo.datum!, this.lucidService.LucidImporter);
    const currentConnectionId = getConnectionIdByTokenName(utxo.assetsName, handlerAuthToken, CONNECTION_TOKEN_PREFIX);
    const txsResult = normalizeTxsResultFromConnDatum(connDatumDecoded, currentConnectionId);

    const mintScriptHash = this.configService.get('deployment').validators.mintConnection.scriptHash;
    const spendAddress = this.configService.get('deployment').validators.spendConnection.address;
    const redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
      utxo.txId.toString(),
      mintScriptHash,
      spendAddress,
    );
    redeemers
      .filter((redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA && redeemer.data.length > 10)
      .map((redeemer) => {
        switch (redeemer.type) {
          case REDEEMER_TYPE.MINT:
            const mintRedeemer = decodeMintConnectionRedeemer(redeemer.data, this.lucidService.LucidImporter);
            if (mintRedeemer.hasOwnProperty('ConnOpenInit')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_INIT;
            if (mintRedeemer.hasOwnProperty('ConnOpenTry')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_TRY;
            break;
          case REDEEMER_TYPE.SPEND:
            const spendRedeemer = decodeSpendConnectionRedeemer(redeemer.data, this.lucidService.LucidImporter);
            if (spendRedeemer.hasOwnProperty('ConnOpenAck')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_ACK;
            if (spendRedeemer.hasOwnProperty('ConnOpenConfirm'))
              txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_CONFIRM;
            break;
          default:
        }
      });
    return txsResult as unknown as ResponseDeliverTx;
  }

  private async _parseEventChannel(utxo: UtxoDto, handlerAuthToken: AuthToken): Promise<ResponseDeliverTx> {
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);

    const currentChannelId = getChannelIdByTokenName(utxo.assetsName, handlerAuthToken, CHANNEL_TOKEN_PREFIX);
    const currentConnectionId = getConnectionIdFromConnectionHops(channelDatumDecoded.state.channel.connection_hops[0]);

    const txsResult = normalizeTxsResultFromChannelDatum(channelDatumDecoded, currentConnectionId, currentChannelId);

    const mintScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;
    const spendAddress = this.configService.get('deployment').validators.spendChannel.address;
    let redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
      utxo.txId.toString(),
      mintScriptHash,
      spendAddress,
    );
    redeemers = redeemers.filter((redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA && redeemer.data.length > 10);
    for (const redeemer of redeemers) {
      switch (redeemer.type) {
        case REDEEMER_TYPE.MINT:
          const mintRedeemer = decodeMintChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);

          if (mintRedeemer.hasOwnProperty('ChanOpenInit')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_INIT;
          if (mintRedeemer.hasOwnProperty('ChanOpenTry')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_TRY;
          break;
        case REDEEMER_TYPE.SPEND:
          const spendRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);
          if (spendRedeemer.hasOwnProperty('ChanOpenAck')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_ACK;
          if (spendRedeemer.hasOwnProperty('ChanOpenConfirm'))
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_CONFIRM;
          if (spendRedeemer.hasOwnProperty('RecvPacket')) {
            // find redeemer module recv packet -> get packet ack
            const spendMockModuleAddress = this.configService.get('deployment').validators.spendMockModule.address;
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;

            const moduleRedeemer = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
              utxo.txId.toString(),
              '',
              spendMockModuleAddress,
            );
            const moduleRedeemerDecoded = decodeIBCModuleRedeemer(
              moduleRedeemer[0].data,
              this.lucidService.LucidImporter,
            );
            const writeAckTxsResult = normalizeTxsResultFromModuleRedeemer(
              moduleRedeemerDecoded,
              spendRedeemer,
              channelDatumDecoded,
            );
            txsResult.events.push(...writeAckTxsResult.events);
          }
          break;
        default:
      }
    }

    console.dir(txsResult, { depth: 10 });

    return txsResult as unknown as ResponseDeliverTx;
  }

  private async _parseEventClient(utxos: UtxoDto[]): Promise<ResponseDeliverTx[]> {
    const mintClientScriptHash = this.configService.get('deployment').validators.mintClient.scriptHash;
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const hasHandlerUtxo = utxos.find((utxo) => utxo.assetsPolicy === handlerAuthToken.policyId);

    const txsResults = await Promise.all(
      utxos
        .filter((utxo) => [mintClientScriptHash].includes(utxo.assetsPolicy))
        .map(async (clientUtxo) => {
          const eventClient = hasHandlerUtxo ? EVENT_TYPE_CLIENT.CREATE_CLIENT : EVENT_TYPE_CLIENT.UPDATE_CLIENT;
          const clientId = getIdByTokenName(clientUtxo.assetsName, handlerAuthToken, CLIENT_PREFIX);
          const clientDatum = await decodeClientDatum(clientUtxo.datum, this.lucidService.LucidImporter);
          const txsResult = normalizeTxsResultFromClientDatum(clientDatum, eventClient, clientId);
          return txsResult as unknown as ResponseDeliverTx;
        }),
    );
    return txsResults;
  }
}