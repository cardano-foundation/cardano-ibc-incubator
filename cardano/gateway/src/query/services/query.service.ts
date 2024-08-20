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
} from '@plus/proto-types/build/ibc/core/client/v1/query';
import { BlockData, ClientState, ConsensusState } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import {
  ClientState as ClientStateTendermint,
  ConsensusState as ConsensusStateTendermint,
} from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import {
  ClientState as ClientStateMithril,
  ConsensusState as ConsensusStateMithril,
  MithrilHeader,
} from '@plus/proto-types/build/ibc/lightclients/mithril/mithril';
import {
  InteractionContext,
  WebSocketCloseHandler,
  WebSocketErrorHandler,
  createInteractionContext,
} from '@cardano-ogmios/client';
import { StateQueryClient, createStateQueryClient } from '@cardano-ogmios/client/dist/StateQuery';
import { BlockDto } from '../dtos/block.dto';
import { connectionConfig } from '@config/kupmios.config';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { decodeHandlerDatum } from '@shared/types/handler-datum';
import { normalizeClientStateFromDatum } from '@shared/helpers/client-state';
import { normalizeConsensusStateFromDatum } from '@shared/helpers/consensus-state';
import { ClientDatum, decodeClientDatum } from '@shared/types/client-datum';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { normalizeBlockDataFromOuroboros } from '@shared/helpers/block-data';
import { GrpcInternalException } from 'nestjs-grpc-exceptions';
import {
  QueryBlockResultsRequest,
  QueryBlockResultsResponse,
  QueryBlockSearchRequest,
  QueryBlockSearchResponse,
  QueryTransactionByHashRequest,
  QueryTransactionByHashResponse,
  QueryIBCHeaderRequest,
  QueryIBCHeaderResponse,
} from '@plus/proto-types/build/ibc/core/types/v1/query';
import { UtxoDto } from '../dtos/utxo.dto';
import {
  CHANNEL_ID_PREFIX,
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
import {
  ResponseDeliverTx,
  ResultBlockResults,
  ResultBlockSearch,
} from '@plus/proto-types/build/ibc/core/types/v1/block';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '@shared/types/channel/channel-datum';
import { getChannelIdByTokenName, getConnectionIdFromConnectionHops } from '@shared/helpers/channel';
import { getConnectionIdByTokenName } from '@shared/helpers/connection';
import { UTxO } from '@cuonglv0297/lucid-custom';
import { bytesFromBase64 } from '@plus/proto-types/build/helpers';
import { getIdByTokenName } from '@shared/helpers/helper';
import { decodeMintChannelRedeemer, decodeSpendChannelRedeemer } from '../../shared/types/channel/channel-redeemer';
import {
  MintConnectionRedeemer,
  decodeMintConnectionRedeemer,
  decodeSpendConnectionRedeemer,
  encodeMintConnectionRedeemer,
} from '../../shared/types/connection/connection-redeemer';
import { decodeIBCModuleRedeemer } from '../../shared/types/port/ibc_module_redeemer';
import { Packet } from '@shared/types/channel/packet';
import { decodeSpendClientRedeemer } from '@shared/types/client-redeemer';
import { validQueryClientStateParam, validQueryConsensusStateParam } from '../helpers/client.validate';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { getNanoseconds } from '../../shared/helpers/time';
import { doubleToFraction } from '../../shared/helpers/number';
import {
  normalizeMithrilStakeDistribution,
  normalizeMithrilStakeDistributionCertificate,
} from '../../shared/helpers/mithril-header';
import { convertString2Hex } from '../../shared/helpers/hex';
import {
  blockHeight as queryBlockHeight,
  genesisConfiguration,
  systemStart as querySystemStart,
} from '../../shared/helpers/ogmios';

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
    @Inject(MiniProtocalsService) private miniProtocalsService: MiniProtocalsService,
    @Inject(MithrilService) private mithrilService: MithrilService,
  ) {}

  async queryNewMithrilClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    const currentEpochSettings = await this.mithrilService.getCurrentEpochSettings();

    let mithrilStakeDistributionsList = await this.mithrilService.mithrilClient.list_mithril_stake_distributions();
    let mithrilDistribution = mithrilStakeDistributionsList[0];
    let fcCertificateMsd = await this.mithrilService.mithrilClient.get_mithril_certificate(
      mithrilDistribution.certificate_hash,
    );

    let certificateList = await this.mithrilService.mithrilClient.list_mithril_certificates();
    const latestCertificateMsd = certificateList.find(
      (certificate) => BigInt(certificate.epoch) === BigInt(mithrilDistribution.epoch),
    );

    const listSnapshots = await this.mithrilService.mithrilClient.list_snapshots();
    let latestSnapshot = listSnapshots[0];
    const latestSnapshotCertificate = await this.mithrilService.mithrilClient.get_mithril_certificate(
      latestSnapshot.certificate_hash,
    );

    const phifFraction = doubleToFraction(currentEpochSettings.protocol.phi_f);
    const clientStateMithril: ClientStateMithril = {
      /** Chain id */
      chain_id: this.configService.get('cardanoChainNetworkMagic').toString(),
      /** Latest height the client was updated to */
      latest_height: {
        /** the immutable file number */
        mithril_height: BigInt(latestSnapshotCertificate.beacon.immutable_file_number),
      },
      /** Block height when the client was frozen due to a misbehaviour */
      frozen_height: {
        mithril_height: 0n,
      },
      /** Epoch number of current chain state */
      current_epoch: BigInt(currentEpochSettings.epoch),
      trusting_period: {
        seconds: 0n,
        nanos: 0,
      },
      protocol_parameters: {
        /** Quorum parameter */
        k: BigInt(currentEpochSettings.protocol.k),
        /** Security parameter (number of lotteries) */
        m: BigInt(currentEpochSettings.protocol.m),
        /** f in phi(w) = 1 - (1 - f)^w, where w is the stake of a participant */
        phi_f: {
          numerator: phifFraction.numerator,
          denominator: phifFraction.denominator,
        },
      },
      /** Path at which next upgraded client will be committed. */
      upgrade_path: [],
    } as unknown as ClientStateMithril;

    const timestamp = new Date(fcCertificateMsd.metadata.sealed_at).valueOf();
    const consensusStateMithril: ConsensusStateMithril = {
      timestamp: BigInt(timestamp) * 10n ** 9n + BigInt(getNanoseconds(fcCertificateMsd.metadata.sealed_at)),
      /** First certificate hash of latest epoch of mithril stake distribution */
      fc_hash_latest_epoch_msd: mithrilDistribution.certificate_hash,
      /** Latest certificate hash of mithril stake distribution */
      latest_cert_hash_msd: latestCertificateMsd.hash,
      /** First certificate hash of latest epoch of transaction snapshot */
      fc_hash_latest_epoch_ts: mithrilDistribution.certificate_hash,
      /** Latest certificate hash of transaction snapshot */
      latest_cert_hash_ts: latestSnapshot.certificate_hash,
    } as unknown as ConsensusStateMithril;

    const clientStateAny: Any = {
      type_url: '/ibc.clients.mithril.v1.ClientState',
      value: ClientStateMithril.encode(clientStateMithril).finish(),
    };

    const consensusStateAny: Any = {
      type_url: '/ibc.clients.mithril.v1.ConsensusState',
      value: ConsensusStateMithril.encode(consensusStateMithril).finish(),
    };

    const response: QueryNewClientResponse = {
      client_state: clientStateAny,
      consensus_state: consensusStateAny,
    };

    return response;
  }

  async latestHeight(request: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse> {
    // const blockHeight = await (await this.getStateQueryClient()).blockHeight();
    // const latestBlockNo = await this.dbService.queryLatestBlockNo();
    const listSnapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();

    const latestHeightResponse = {
      height: listSnapshots[0].block_number,
    };
    this.logger.log(latestHeightResponse.height, 'QueryLatestHeight');
    return latestHeightResponse as unknown as QueryLatestHeightResponse;
  }

  private async getClientDatum(clientId: string): Promise<[ClientDatum, UTxO]> {
    // Get handlerUTXO
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;
    const handlerUtxo = await this.lucidService.findUtxoByUnit(handlerAuthTokenUnit);
    const handlerDatum = await decodeHandlerDatum(handlerUtxo.datum, this.lucidService.LucidImporter);

    const clientAuthTokenUnit = this.lucidService.getClientAuthTokenUnit(handlerDatum, BigInt(clientId));
    const spendClientUTXO = await this.lucidService.findUtxoByUnit(clientAuthTokenUnit);

    const clientDatum = await decodeClientDatum(spendClientUTXO.datum, this.lucidService.LucidImporter);
    return [clientDatum, spendClientUTXO];
  }

  async queryClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    this.logger.log(request.client_id, 'queryClientState');
    const { client_id: clientId } = validQueryClientStateParam(request);
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    const [clientDatum, spendClientUTXO] = await this.getClientDatum(clientId);
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
    this.logger.log(`client_id = ${request.client_id}, height = ${request.height}`, 'queryConsensusState');
    const { client_id: clientId, height } = validQueryConsensusStateParam(request);
    const [clientDatum, spendClientUTXO] = await this.getClientDatum(clientId);
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

    const blockDto: BlockDto = await this.dbService.findBlockByHeight(height);
    const blockHeader = await this.miniProtocalsService.fetchBlockHeader(blockDto.hash, BigInt(blockDto.slot));
    try {
      const blockDataOuroboros = normalizeBlockDataFromOuroboros(blockDto, blockHeader);
      blockDataOuroboros.chain_id = `${this.configService.get('cardanoChainNetworkMagic')}`;
      blockDataOuroboros.epoch_nonce = this.configService.get('cardanoEpochNonceGenesis');
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
    // const listBlockNo = await this.dbService.queryListBlockByImmutableFileNo(Number(height));

    // const blockDto: BlockDto = await this.dbService.findBlockByHeight(request.height);
    // if (!listBlockNo.length) {
    //   // throw new GrpcNotFoundException(`Not found: "height" ${request.height} not found`);
    //   return {
    //     block_results: {
    //       height: {
    //         revision_height: request.height,
    //         revision_number: BigInt(0),
    //       },
    //       txs_results: [],
    //     },
    //   } as unknown as QueryBlockResultsResponse;
    // }

    try {
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const mintConnScriptHash = this.configService.get('deployment').validators.mintConnection.scriptHash;
      const mintChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

      const totalEventResults: ResponseDeliverTx[] = [];
      for (const blockNo of [height]) {
        // connection +channel
        const utxosInBlock = await this.dbService.findUtxosByBlockNo(parseInt(blockNo.toString()));
        const txsResults = await Promise.all(
          utxosInBlock
            .filter((utxo) => [mintConnScriptHash, mintChannelScriptHash].includes(utxo.assetsPolicy))
            .map(async (utxo) => {
              switch (utxo.assetsPolicy) {
                case mintConnScriptHash:
                  return await this._parseEventConnection(utxo, handlerAuthToken);
                case mintChannelScriptHash:
                  return await this._parseEventChannel(utxo, handlerAuthToken);
              }
            }),
        );

        // client state + consensus state
        const authOrClientUTxos = await this.dbService.findUtxoClientOrAuthHandler(parseInt(blockNo.toString()));
        const txsAuthOrClientsResults = await this._parseEventClient(authOrClientUTxos);

        // register/unregister event spo
        const spoEvents = await this._querySpoEvents(BigInt(blockNo));
        const eventInBlock = [...txsAuthOrClientsResults, ...txsResults, ...spoEvents];
        totalEventResults.push(...eventInBlock);
      }

      const blockResults: ResultBlockResults = {
        height: {
          revision_height: request.height,
          revision_number: BigInt(0),
        },
        txs_results: totalEventResults,
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
    console.dir(
      {
        txsResult,
      },
      { depth: 10 },
    );
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

    redeemers = redeemers.filter((redeemer) => ![REDEEMER_EMPTY_DATA].includes(redeemer.data));
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
          if (spendRedeemer.hasOwnProperty('RecvPacket') || spendRedeemer.hasOwnProperty('SendPacket')) {
            // find redeemer module recv packet -> get packet ack
            const spendTransferModuleAddress = this.configService.get('deployment').modules.transfer.address;
            const spendMockModuleAddress = this.configService.get('deployment').modules.mock.address;
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
            if (spendRedeemer.hasOwnProperty('SendPacket')) break;

            const moduleRedeemer = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
              utxo.txId.toString(),
              '',
              spendTransferModuleAddress,
            );
            if (moduleRedeemer.length > 0) {
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

            const mockModuleRedeemer = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
              utxo.txId.toString(),
              '',
              spendMockModuleAddress,
            );
            if (mockModuleRedeemer.length > 0) {
              const mockModuleRedeemerDecoded = decodeIBCModuleRedeemer(
                mockModuleRedeemer[0].data,
                this.lucidService.LucidImporter,
              );
              const writeAckTxsResult = normalizeTxsResultFromModuleRedeemer(
                mockModuleRedeemerDecoded,
                spendRedeemer,
                channelDatumDecoded,
              );
              txsResult.events.push(...writeAckTxsResult.events);
            }
          }
          if (spendRedeemer.hasOwnProperty('AcknowledgePacket')) {
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
          }
          if (spendRedeemer.hasOwnProperty('TimeoutPacket')) {
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
          }
          if (spendRedeemer === 'ChanCloseInit') {
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.CLOSE_INIT;
          }
          if (spendRedeemer.hasOwnProperty('ChanCloseConfirm')) {
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.CLOSE_CONFIRM;
          }
          break;
        default:
      }
    }

    console.dir(
      {
        txsResult,
      },
      { depth: 10 },
    );

    return txsResult as unknown as ResponseDeliverTx;
  }

  private async _parseEventClient(utxos: UtxoDto[]): Promise<ResponseDeliverTx[]> {
    const mintClientScriptHash = this.configService.get('deployment').validators.mintClient.scriptHash;
    const spendClientAddress = this.configService.get('deployment').validators.spendClient.address;
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const hasHandlerUtxo = utxos.find((utxo) => utxo.assetsPolicy === handlerAuthToken.policyId);

    const txsResults = await Promise.all(
      utxos
        .filter((utxo) => [mintClientScriptHash].includes(utxo.assetsPolicy))
        .map(async (clientUtxo) => {
          const eventClient = hasHandlerUtxo ? EVENT_TYPE_CLIENT.CREATE_CLIENT : EVENT_TYPE_CLIENT.UPDATE_CLIENT;
          const clientId = getIdByTokenName(clientUtxo.assetsName, handlerAuthToken, CLIENT_PREFIX);
          const clientDatum = await decodeClientDatum(clientUtxo.datum, this.lucidService.LucidImporter);

          const redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
            clientUtxo.txId.toString(),
            mintClientScriptHash,
            spendClientAddress,
          );
          const spendClientRedeemer = redeemers.find((e) => e.type == 'spend');
          let spendClientRedeemerData = null;
          if (spendClientRedeemer) {
            spendClientRedeemerData = decodeSpendClientRedeemer(
              spendClientRedeemer.data,
              this.lucidService.LucidImporter,
            );
          }

          const txsResult = normalizeTxsResultFromClientDatum(
            clientDatum,
            eventClient,
            clientId,
            spendClientRedeemerData,
          );
          return txsResult as unknown as ResponseDeliverTx;
        }),
    );
    console.dir(
      {
        txsResults,
      },
      { depth: 10 },
    );

    return txsResults;
  }

  async queryBlockSearch(request: QueryBlockSearchRequest): Promise<QueryBlockSearchResponse> {
    this.logger.log(
      `packet_src_channel = ${request.packet_src_channel}, packet_sequence=${request.packet_sequence}`,
      'QueryBlockSearch',
    );
    try {
      const { packet_sequence, packet_src_channel: srcChannelId, limit, page } = request;
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;
      const spendAddress = this.configService.get('deployment').validators.spendChannel.address;
      if (!request.packet_src_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      const channelId = srcChannelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

      const channelTokenName = this.lucidService.generateTokenName(
        handlerAuthToken,
        CHANNEL_TOKEN_PREFIX,
        BigInt(channelId),
      );
      const utxosOfChannel = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
        minChannelScriptHash,
        channelTokenName,
      );
      let blockResults: ResultBlockSearch[] = await Promise.all(
        utxosOfChannel.map(async (utxo) => {
          let redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
            utxo.txId.toString(),
            minChannelScriptHash,
            spendAddress,
          );
          redeemers = redeemers.filter(
            (redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA && redeemer.data.length > 10,
          );
          let isMatched = false;
          for (const redeemer of redeemers) {
            if (redeemer.type !== REDEEMER_TYPE.SPEND) continue;
            const spendRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);
            let packet: Packet = null;
            if (spendRedeemer['RecvPacket']) packet = spendRedeemer['RecvPacket']?.packet as unknown as Packet;
            if (spendRedeemer['AcknowledgePacket'])
              packet = spendRedeemer['AcknowledgePacket']?.packet as unknown as Packet;
            if (spendRedeemer['TimeoutPacket']) packet = spendRedeemer['TimeoutPacket']?.packet as unknown as Packet;
            if (spendRedeemer['SendPacket']) packet = spendRedeemer['SendPacket']?.packet as unknown as Packet;
            if (!packet) continue;
            if (packet.sequence === BigInt(packet_sequence)) {
              isMatched = true;
              break;
            }
          }
          if (!isMatched) return null;

          return {
            block_id: utxo.blockId,
            block: {
              height: utxo.blockNo,
            },
          } as unknown as ResultBlockSearch;
        }),
      );
      blockResults = blockResults.filter((e) => e);
      let blockResultsResp = blockResults;
      if (blockResults.length > limit) {
        const offset = page <= 0 ? 0 : limit * (page - 1n);
        const from = parseInt(offset.toString());
        const to = parseInt(offset.toString()) + parseInt(limit.toString());
        blockResultsResp = blockResults.slice(from, to);
      }

      const responseBlockSearch: QueryBlockSearchResponse = {
        blocks: blockResultsResp,
        total_count: blockResultsResp.length,
      } as unknown as QueryBlockSearchResponse;

      return responseBlockSearch;
    } catch (error) {
      console.error(error);

      this.logger.error(error.message, 'queryChannel');
      throw new GrpcInternalException(error.message);
    }
  }

  async queryTransactionByHash(request: QueryTransactionByHashRequest): Promise<QueryTransactionByHashResponse> {
    this.logger.log(`hash = ${request.hash}`, 'queryTransactionByHash');
    const { hash } = request;
    if (!hash) throw new GrpcInvalidArgumentException(`Invalid argument: "hash" must be provided`);

    const tx = await this.dbService.findTxByHash(hash);
    if (!tx) {
      throw new GrpcNotFoundException(`Not found: "hash" ${hash} not found`);
    }

    // get create_client events from tx
    const authOrClientUTxos = await this.dbService.findUtxoClientOrAuthHandler(tx.height);
    let createClientEvent = null;
    if (authOrClientUTxos.length) {
      const txsAuthOrClientsResults = await this._parseEventClient(authOrClientUTxos);
      createClientEvent = txsAuthOrClientsResults.find((e) => e.events[0].type === EVENT_TYPE_CLIENT.CREATE_CLIENT);
    }

    const response: QueryTransactionByHashResponse = {
      hash: tx.hash,
      height: tx.height,
      gas_fee: tx.gas_fee,
      tx_size: tx.tx_size,
      events: createClientEvent ? createClientEvent.events : [],
    } as unknown as QueryTransactionByHashResponse;
    return response;
  }

  async queryIBCHeader(request: QueryIBCHeaderRequest): Promise<QueryIBCHeaderResponse> {
    this.logger.log(`height = ${request.height}`, 'queryIBCHeader');
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    let mithrilStakeDistributionsList = await this.mithrilService.mithrilClient.list_mithril_stake_distributions();
    let mithrilStakeDistribution = mithrilStakeDistributionsList[0];

    let distributionCertificate = await this.mithrilService.mithrilClient.get_mithril_certificate(
      mithrilStakeDistribution.certificate_hash,
    );

    const listSnapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
    const snapshot = listSnapshots.find((e) => BigInt(e.block_number) === BigInt(height));
    if (!snapshot) throw new GrpcNotFoundException(`Not found: "height" ${height} not found`);
    const snapshotCertificate = await await this.mithrilService.mithrilClient.get_mithril_certificate(
      snapshot.certificate_hash,
    );

    const mithrilHeader: MithrilHeader = {
      mithril_stake_distribution: normalizeMithrilStakeDistribution(mithrilStakeDistribution, distributionCertificate),
      mithril_stake_distribution_certificate: normalizeMithrilStakeDistributionCertificate(
        mithrilStakeDistribution,
        distributionCertificate,
      ),
      transaction_snapshot: {
        merkle_root: snapshot.merkle_root,
        hash: snapshot.hash,
        certificate_hash: snapshot.certificate_hash,
        epoch: BigInt(snapshotCertificate.epoch),
        block_number: BigInt(snapshot.block_number),
        created_at: snapshot.created_at,
      },
      transaction_snapshot_certificate: normalizeMithrilStakeDistributionCertificate(
        {
          epoch: snapshot.epoch,
          hash: snapshot.hash,
          certificate_hash: snapshot.certificate_hash,
          created_at: snapshot.created_at,
        },
        snapshotCertificate,
      ),
    };

    const mithrilHeaderAny: Any = {
      type_url: '/ibc.clients.mithril.v1.MithrilHeader',
      value: MithrilHeader.encode(mithrilHeader).finish(),
    };
    const response: QueryIBCHeaderResponse = {
      header: mithrilHeaderAny,
    };
    return response;
  }
}
