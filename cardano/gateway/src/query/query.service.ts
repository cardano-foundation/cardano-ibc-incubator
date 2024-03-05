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
} from 'cosmjs-types/src/ibc/core/client/v1/query';
import { BlockData, ClientState, ConsensusState } from 'cosmjs-types/src/ibc/lightclients/ouroboros/ouroboros';
import {
  ClientState as ClientStateTendermint,
  ConsensusState as ConsensusStateTendermint,
} from 'cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import {
  InteractionContext,
  WebSocketCloseHandler,
  WebSocketErrorHandler,
  createInteractionContext,
} from '@cardano-ogmios/client';
import { StateQueryClient, createStateQueryClient } from '@cardano-ogmios/client/dist/StateQuery';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { BlockDto } from './dtos/block.dto';
import { ValidatorDto } from './dtos/validator.dto';
import { connectionConfig } from 'src/config/kupmios.config';
import { MinimumActiveEpoch } from 'src/config/constant.config';
import { Any } from 'cosmjs-types/src/google/protobuf/any';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { decodeHandlerDatum } from 'src/shared/types/handler-datum';
import { normalizeClientStateFromDatum } from 'src/shared/helpers/client-state';
import { normalizeConsensusStateFromDatum } from 'src/shared/helpers/consensus-state';
import { decodeClientDatum } from 'src/shared/types/client-datum';
import { GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import httpRequestInst from 'src/utils/http-request';
import { normalizeBlockDataFromOuroboros } from '../shared/helpers/block-data';
import { GrpcInternalException } from 'nestjs-grpc-exceptions';
import { EpochParamDto } from './dtos/epoch-param.dto';

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @InjectEntityManager() private entityManager: EntityManager,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}

  async newClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
    const { height } = request;

    const genesisConfig = await (await this.getStateQueryClient()).genesisConfig();
    this.logger.log(genesisConfig, 'genesisConfig');
    const blockHeight = await (await this.getStateQueryClient()).blockHeight();
    this.logger.log(blockHeight, 'blockHeight');
    const systemStart = await (await this.getStateQueryClient()).systemStart();
    this.logger.log(systemStart);

    const blockDto: BlockDto = await this.findBlockByHeight(height);
    const currentEpoch = blockDto.epoch;
    this.logger.log(currentEpoch);
    const currentValidatorSet = await this.findActiveValidatorsByEpoch(BigInt(currentEpoch));
    this.logger.log(currentValidatorSet);
    const nextValidatorSet = await this.findActiveValidatorsByEpoch(BigInt(currentEpoch + 1));
    this.logger.log(nextValidatorSet);

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
    };

    this.logger.log(clientState);

    const clientStateAny: Any = {
      type_url: '/ibc.clients.cardano.v1.ClientState',
      value: ClientState.encode(clientState).finish(),
    };

    const timestampInMilliseconds = systemStart.getTime() + blockDto.slot * 1000;
    const consensusState: ConsensusState = {
      timestamp: BigInt(timestampInMilliseconds / 1000), // need -> ok
      slot: BigInt(blockDto.slot), // need -> ok
    };

    this.logger.log(consensusState);

    const consensusStateAny: Any = {
      type_url: '/ibc.clients.cardano.v1.ConsensusState',
      value: ConsensusState.encode(consensusState).finish(),
    };

    const response: QueryNewClientResponse = {
      client_state: clientStateAny,
      consensus_state: consensusStateAny,
    };

    this.logger.log(response);

    return response;
  }

  async latestHeight(request: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse> {
    const blockHeight = await (await this.getStateQueryClient()).blockHeight();
    const latestHeightResponse = {
      height: blockHeight == 'origin' ? 0 : blockHeight,
    };
    this.logger.log(latestHeightResponse);
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

  async findBlockByHeight(height: bigint): Promise<BlockDto> {
    const query = 'SELECT block_no as height, slot_no as slot, epoch_no as epoch, id FROM block WHERE block_no = $1';
    const results = await this.entityManager.query(query, [height.toString()]);

    const blockDto = new BlockDto();
    blockDto.height = results[0].height;
    blockDto.slot = results[0].slot;
    blockDto.epoch = results[0].epoch;
    blockDto.block_id = results[0].id;

    return blockDto;
  }

  async findActiveValidatorsByEpoch(epoch: bigint): Promise<[ValidatorDto]> {
    epoch = epoch >= MinimumActiveEpoch ? epoch : MinimumActiveEpoch;
    const query = `
    SELECT DISTINCT ph.view as poolId, pu.vrf_key_hash as vrfKeyHash
    FROM pool_update pu
      LEFT JOIN pool_retire pr ON pu.hash_id = pr.hash_id
      LEFT JOIN pool_hash ph ON pu.hash_id = ph.id
    WHERE 
      pu.active_epoch_no <= $1
      AND pr.retiring_epoch > $1
        OR pr.retiring_epoch IS NULL
    `;

    const results = await this.entityManager.query(query, [epoch.toString()]);

    return results.map((result) => {
      const validatorDto: ValidatorDto = {
        pool_id: result.poolid,
        vrf_key_hash: result.vrfkeyhash.toString('hex'),
      };
      return validatorDto;
    });
  }

  async findEpochParamByEpochNo(epochNo: bigint): Promise<EpochParamDto> {
    const query = `SELECT * FROM epoch_param WHERE epoch_no = $1`;

    const result = await this.entityManager.query(query, [epochNo.toString()]);
    if (result.length > 0) {
      const epochParam = new EpochParamDto();
      epochParam.epoch_no = result[0].epoch_no;
      epochParam.nonce = this.toHexString(result[0].nonce);
      return epochParam;
    }

    return null;
  }

  private async getClientDatum() {
    // Get handlerUTXO

    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;
    const handlerUtxo = await this.lucidService.findUtxoByUnit(handlerAuthTokenUnit);
    const handlerDatum = await decodeHandlerDatum(handlerUtxo.datum, this.lucidService.LucidImporter);
    const clientAuthTokenUnit = this.lucidService.getClientAuthTokenUnit(handlerDatum);
    const spendClientUTXO = await this.lucidService.findUtxoByUnit(clientAuthTokenUnit);
    const clientDatum = await decodeClientDatum(spendClientUTXO.datum, this.lucidService.LucidImporter);
    return clientDatum;
  }
  async queryClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    const clientDatum = await this.getClientDatum();
    const clientStateTendermint = normalizeClientStateFromDatum(clientDatum.state.clientState);

    const clientStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ClientState',
      value: ClientStateTendermint.encode(clientStateTendermint).finish(),
    };
    const response = {
      client_state: clientStateAny,
    };

    return response as unknown as QueryClientStateResponse;
  }

  async queryConsensusState(request: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse> {
    const clientDatum = await this.getClientDatum();
    const { height } = request;
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
    const response = {
      consensus_state: consensusStateAny,
    };
    return response as unknown as QueryConsensusStateResponse;
  }

  toHexString(byteArray) {
    return byteArray.reduce((output, elem) => output + ('0' + elem.toString(16)).slice(-2), '');
  }

  async queryBlockData(request: QueryBlockDataRequest): Promise<QueryBlockDataResponse> {
    const { height } = request;
    const blockNo = parseInt(height.toString(), 10);
    console.log(blockNo);
    try {
      const blockDto: BlockDto = await this.findBlockByHeight(height);
      const epochParam = await this.findEpochParamByEpochNo(BigInt(blockDto.epoch));

      const blockDataRes = await httpRequestInst({
        url: `${this.configService.get('cardanoBridgeUrl')}/blocks`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
        },
        params: {
          height: blockNo,
        },
      });
      console.log(blockDataRes);

      const blockDataOuroboros = normalizeBlockDataFromOuroboros(blockDataRes);
      if (blockDto.epoch > 0) {
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
      this.logger.error(err.message, 'queryBlockData');
      throw new GrpcInternalException(err.message);
    }
  }
}
