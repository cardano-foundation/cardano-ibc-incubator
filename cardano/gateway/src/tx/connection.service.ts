import { MsgUpdateClientResponse } from '@plus/proto-types/build/ibc/core/client/v1/tx';
import { TxBuilder, UTxO, fromHex } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenAckResponse,
  MsgConnectionOpenConfirm,
  MsgConnectionOpenConfirmResponse,
  MsgConnectionOpenInit,
  MsgConnectionOpenInitResponse,
  MsgConnectionOpenTry,
  MsgConnectionOpenTryResponse,
} from '@plus/proto-types/build/ibc/core/connection/v1/tx';
import { RpcException } from '@nestjs/microservices';
import { CLIENT_PREFIX, CONNECTION_ID_PREFIX, DEFAULT_MERKLE_PREFIX } from 'src/constant';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { AuthToken } from 'src/shared/types/auth-token';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { State } from 'src/shared/types/connection/state';
import { MintConnectionRedeemer, SpendConnectionRedeemer } from '@shared/types/connection/connection-redeemer';
import { ConfigService } from '@nestjs/config';
import { parseClientSequence } from 'src/shared/helpers/sequence';
import { convertHex2String, convertString2Hex, toHex } from '@shared/helpers/hex';
import { ClientDatum } from '@shared/types/client-datum';
import { isValidProofHeight } from './helper/height.validate';
import {
  validateAndFormatConnectionOpenAckParams,
  validateAndFormatConnectionOpenConfirmParams,
  validateAndFormatConnectionOpenInitParams,
  validateAndFormatConnectionOpenTryParams,
} from './helper/connection.validate';
import { VerifyProofRedeemer, encodeVerifyProofRedeemer } from '../shared/types/connection/verify-proof-redeemer';
import { getBlockDelay } from '../shared/helpers/verify';
import { connectionPath } from '../shared/helpers/connection';
import { 
  computeRootWithConnectionUpdate as computeRootWithConnectionUpdateHelper,
  alignTreeWithChain,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';
import { ConnectionEnd, State as ConnectionState } from '@plus/proto-types/build/ibc/core/connection/v1/connection';
import { clientStatePath } from '~@/shared/helpers/client-state';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { getMithrilClientStateForVerifyProofRedeemer } from '../shared/helpers/mithril-client';
import { ClientState as MithrilClientState } from '@plus/proto-types/build/ibc/lightclients/mithril/mithril';
import {
  ConnectionOpenAckOperator,
  ConnectionOpenConfirmOperator,
  ConnectionOpenInitOperator,
  ConnectionOpenTryOperator,
} from './dto';
import { UnsignedConnectionOpenAckDto } from '~@/shared/modules/lucid/dtos';
import { TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}

  /**
   * Computes the new IBC state root after connection update
   * Now side-effect free - returns newRoot without mutating the canonical tree
   */
  private computeRootWithConnectionUpdate(oldRoot: string, connectionId: string, connectionState: any): string {
    const result = computeRootWithConnectionUpdateHelper(oldRoot, connectionId, connectionState);
    return result.newRoot;
  }
  
  /**
   * Ensure the in-memory Merkle tree is aligned with on-chain state
   */
  private async ensureTreeAligned(onChainRoot: string): Promise<void> {
    if (!isTreeAligned(onChainRoot)) {
      this.logger.warn(`Tree is out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding...`);
      await alignTreeWithChain();
    }
  }
  /**
   * Processes the connection open init tx.
   * @param data The message containing connection open initiation data.
   * @returns A promise resolving to a message response for connection open initiation include the unsigned_tx.
   */
  async connectionOpenInit(data: MsgConnectionOpenInit): Promise<MsgConnectionOpenInitResponse> {
    try {
      this.logger.log('Connection Open Init is processing');
      const { constructedAddress, connectionOpenInitOperator } = validateAndFormatConnectionOpenInitParams(data);
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenInitTx: TxBuilder = await this.buildUnsignedConnectionOpenInitTx(
        connectionOpenInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenInitTxValidTo: TxBuilder = unsignedConnectionOpenInitTx.validTo(validToTime);

      // DEBUG: emit CBOR and key inputs so we can reproduce Ogmios eval failures
      const completedUnsignedTx = await unsignedConnectionOpenInitTxValidTo.complete();
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      this.logger.log(
        `[DEBUG] connectionOpenInit unsigned CBOR len=${unsignedTxCbor.length}, head=${unsignedTxCbor.substring(0, 80)}`,
      );

      // Return unsigned transaction for Hermes to sign
      this.logger.log('Returning unsigned tx for connection open init');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(unsignedTxCbor),
        },
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(`connectionOpenInit: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  /**
   * Processes the connection open try tx.
   * @param data The message containing connection open try data.
   * @returns A promise resolving to a message response for connection open try include the unsigned_tx.
   */
  /* istanbul ignore next */
  async connectionOpenTry(data: MsgConnectionOpenTry): Promise<MsgConnectionOpenTryResponse> {
    try {
      const { constructedAddress, connectionOpenTryOperator } = validateAndFormatConnectionOpenTryParams(data);
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenTryTx: TxBuilder = await this.buildUnsignedConnectionOpenTryTx(
        connectionOpenTryOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenTryTxValidTo: TxBuilder = unsignedConnectionOpenTryTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenTryTxValidTo.complete();
      const unsignedTxCbor = completedUnsignedTx.toCBOR();

      this.logger.log('Returning unsigned tx for connection open try');
      const response: MsgConnectionOpenTryResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(unsignedTxCbor),
        },
      } as unknown as MsgConnectionOpenTryResponse;
      return response;
    } catch (error) {
      this.logger.error(`connectionOpenTry: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  /**
   * Processes the initiation of a connection open ack tx.
   * @param data The message containing connection open ack data.
   * @returns A promise resolving to a message response for connection open ack include the unsigned_tx.
   */
  async connectionOpenAck(data: MsgConnectionOpenAck): Promise<MsgConnectionOpenAckResponse> {
    this.logger.log('Connection Open Ack is processing', 'connectionOpenAck');
    try {
      const { constructedAddress, connectionOpenAckOperator } = validateAndFormatConnectionOpenAckParams(data);
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenAckTx: TxBuilder = await this.buildUnsignedConnectionOpenAckTx(
        connectionOpenAckOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenAckTxValidTo: TxBuilder = unsignedConnectionOpenAckTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenAckTxValidTo.complete();
      const unsignedTxCbor = completedUnsignedTx.toCBOR();

      this.logger.log('Returning unsigned tx for connection open ack');
      const response: MsgConnectionOpenAckResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(unsignedTxCbor),
        },
      } as unknown as MsgConnectionOpenAckResponse;
      return response;
    } catch (error) {
      console.error(error);

      this.logger.error(error, 'connectionOpenAck');
      this.logger.error(`connectionOpenAck: ${error.stack}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  /**
   * Processes the initiation of a connection open confirm tx.
   * @param data The message containing connection open confirm data.
   * @returns A promise resolving to a message response for connection open confirm include the unsigned_tx.
   */
  /* istanbul ignore next */
  async connectionOpenConfirm(data: MsgConnectionOpenConfirm): Promise<MsgConnectionOpenConfirmResponse> {
    try {
      this.logger.log('Connection Open Confirm is processing');
      const { constructedAddress, connectionOpenConfirmOperator } = validateAndFormatConnectionOpenConfirmParams(data);
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenConfirmTx: TxBuilder = await this.buildUnsignedConnectionOpenConfirmTx(
        connectionOpenConfirmOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenConfirmTxValidTo: TxBuilder = unsignedConnectionOpenConfirmTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenConfirmTxValidTo.complete();
      const unsignedTxCbor = completedUnsignedTx.toCBOR();

      this.logger.log('Returning unsigned tx for connection open confirm');
      const response: MsgConnectionOpenConfirmResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(unsignedTxCbor),
        },
      } as unknown as MsgConnectionOpenConfirmResponse;
      return response;
    } catch (error) {
      this.logger.error(`connectionOpenConfirm: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }

  //   =======
  /**
   * Builds an unsigned transaction for initiating a connection open.
   * @param connectionOpenInitOperator Input data.
   * @param constructedAddress The constructed address use for build tx.
   * @returns The unsigned transaction.
   */
  async buildUnsignedConnectionOpenInitTx(
    connectionOpenInitOperator: ConnectionOpenInitOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum!,
      'host_state',
    );
    
    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing new root
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
    
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionOpenInitOperator.clientId);
    // Find the UTXO for the client token
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    this.logger.log(
      `[DEBUG] ConnOpenInit hostState seq=${hostStateDatum.state.next_connection_sequence}, root=${hostStateDatum.state.ibc_state_root.slice(0, 20)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit handler seq=${handlerDatum.state.next_connection_sequence}, root=${handlerDatum.state.ibc_state_root.slice(0, 20)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit client token unit=${clientTokenUnit}, client utxo=${clientUtxo.txHash}#${clientUtxo.outputIndex}`,
    );
    const clientAssetUnits = Object.keys(clientUtxo.assets || {}).filter((a) => a !== 'lovelace');
    this.logger.log(`[DEBUG] ConnOpenInit client utxo assets=${clientAssetUnits.join(',') || 'lovelace-only'}`);

    // Compute new IBC state root with connection update
    const connectionId = `connection-${hostStateDatum.state.next_connection_sequence}`;
    const newRoot = this.computeRootWithConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      connectionOpenInitOperator,
    );

    // Retrieve the current client datum from the UTXO
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
        ibc_state_root: newRoot,
      },
    };
    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const spendHandlerRedeemer: HandlerOperator = 'HandlerConnOpenInit';
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      hostStateDatum.state.next_connection_sequence,
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    this.logger.log(
      `[DEBUG] ConnOpenInit connection token unit=${connectionTokenUnit}, policy=${mintConnectionPolicyId}, name=${connectionTokenName}`,
    );
    const connToken: AuthToken = {
      policyId: mintConnectionPolicyId,
      name: connectionTokenName,
    };
    const connectionDatum: ConnectionDatum = {
      state: {
        client_id: CLIENT_PREFIX + convertString2Hex('-' + connectionOpenInitOperator.clientId),
        counterparty: connectionOpenInitOperator.counterparty,
        delay_period: 0n,
        versions: connectionOpenInitOperator.versions,
        state: State.Init,
      },
      token: connToken,
    };
    const mintConnectionRedeemer: MintConnectionRedeemer = {
      ConnOpenInit: {
        handler_auth_token: this.configService.get('deployment').handlerAuthToken,
      },
    };
    const encodedMintConnectionRedeemer: string = await this.lucidService.encode<MintConnectionRedeemer>(
      mintConnectionRedeemer,
      'mintConnectionRedeemer',
    );
    const encodedHostStateRedeemer = await this.lucidService.encode<string>('CreateConnection', 'host_state_redeemer');

    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode(updatedHandlerDatum, 'handler');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      connectionDatum,
      'connection',
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit encoded spendHandlerRedeemer: ${encodedSpendHandlerRedeemer.substring(0, 120)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit encoded mintConnectionRedeemer: ${encodedMintConnectionRedeemer.substring(0, 120)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit encoded handler datum (trunc): ${encodedUpdatedHandlerDatum.substring(0, 120)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit encoded host state datum (trunc): ${encodedUpdatedHostStateDatum.substring(0, 120)}...`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenInit encoded connection datum (trunc): ${encodedConnectionDatum.substring(0, 120)}...`,
    );
    return this.lucidService.createUnsignedConnectionOpenInitTransaction(
      handlerUtxo,
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedSpendHandlerRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedMintConnectionRedeemer,
      encodedUpdatedHandlerDatum,
      encodedUpdatedHostStateDatum,
      encodedConnectionDatum,
      constructedAddress,
    );
  }

  /* istanbul ignore next */
  public async buildUnsignedConnectionOpenTryTx(
    connectionOpenTryOperator: ConnectionOpenTryOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum!,
      'host_state',
    );
    
    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing new root
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
    
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionOpenTryOperator.clientId);
    // Find the UTXO for the client token
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    
    // Compute new IBC state root with connection update
    const connectionId = `connection-${hostStateDatum.state.next_connection_sequence}`;
    const newRoot = this.computeRootWithConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      connectionOpenTryOperator,
    );
    
    // Retrieve the current client datum from the UTXO
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
        ibc_state_root: newRoot,
      },
    };
    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const spendHandlerRedeemer: HandlerOperator = 'HandlerConnOpenTry';
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      hostStateDatum.state.next_connection_sequence,
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    const connToken: AuthToken = {
      policyId: mintConnectionPolicyId,
      name: connectionTokenName,
    };
    const connectionDatum: ConnectionDatum = {
      state: {
        client_id: CLIENT_PREFIX + convertString2Hex('-' + connectionOpenTryOperator.clientId),
        counterparty: connectionOpenTryOperator.counterparty,
        delay_period: 0n,
        versions: connectionOpenTryOperator.versions,
        state: State.TryOpen,
      },
      token: connToken,
    };
    const mintConnectionRedeemer: MintConnectionRedeemer = {
      ConnOpenTry: {
        handler_auth_token: this.configService.get('deployment').handlerAuthToken,
        client_state: connectionOpenTryOperator.counterpartyClientState,
        proof_init: connectionOpenTryOperator.proofInit,
        proof_client: connectionOpenTryOperator.proofClient,
        proof_height: connectionOpenTryOperator.proofHeight,
      },
    };
    const encodedHostStateRedeemer = await this.lucidService.encode<string>('CreateConnection', 'host_state_redeemer');
    const encodedMintConnectionRedeemer: string = await this.lucidService.encode<MintConnectionRedeemer>(
      mintConnectionRedeemer,
      'mintConnectionRedeemer',
    );
    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode(updatedHandlerDatum, 'handler');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      connectionDatum,
      'connection',
    );
    return this.lucidService.createUnsignedConnectionOpenTryTransaction(
      handlerUtxo,
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedSpendHandlerRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedMintConnectionRedeemer,
      encodedUpdatedHandlerDatum,
      encodedUpdatedHostStateDatum,
      encodedConnectionDatum,
      constructedAddress,
    );
  }

  private async buildUnsignedConnectionOpenAckTx(
    connectionOpenAckOperator: ConnectionOpenAckOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
    // Get the token unit associated with the client
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      BigInt(connectionOpenAckOperator.connectionSequence),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const spendConnectionRedeemer: SpendConnectionRedeemer = {
      ConnOpenAck: {
        counterparty_client_state: connectionOpenAckOperator.counterpartyClientState,
        proof_try: connectionOpenAckOperator.proofTry,
        proof_client: connectionOpenAckOperator.proofClient,
        proof_height: connectionOpenAckOperator.proofHeight,
      },
    };

    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );

    const clientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    const updatedConnectionDatum: ConnectionDatum = {
      ...connectionDatum,
      state: {
        ...connectionDatum.state,
        state: State.Open,
        counterparty: {
          ...connectionDatum.state.counterparty,
          connection_id: connectionOpenAckOperator.counterpartyConnectionID,
        },
      },
    };
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(clientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, connectionOpenAckOperator.proofHeight.revisionHeight)) {
      throw new GrpcInternalException(`Invalid proof height: ${connectionOpenAckOperator.proofHeight.revisionHeight}`);
    }
    const encodedSpendConnectionRedeemer = await this.lucidService.encode<SpendConnectionRedeemer>(
      spendConnectionRedeemer,
      'spendConnectionRedeemer',
    );
    const encodedUpdatedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      updatedConnectionDatum,
      'connection',
    );

    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    const [_, consensusState] = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) => key.revisionHeight === connectionOpenAckOperator.proofHeight.revisionHeight,
    );
    const cardanoConnectionEnd: ConnectionEnd = {
      client_id: convertHex2String(connectionDatum.state.counterparty.client_id),
      versions: connectionDatum.state.versions.map((version) => ({
        identifier: convertHex2String(version.identifier),
        features: version.features.map((feature) => convertHex2String(feature)),
      })),
      state: ConnectionState.STATE_TRYOPEN,
      counterparty: {
        client_id: convertHex2String(connectionDatum.state.client_id),
        connection_id: `${CONNECTION_ID_PREFIX}-${connectionOpenAckOperator.connectionSequence}`,
        prefix: { key_prefix: fromHex(DEFAULT_MERKLE_PREFIX) },
      },
      delay_period: connectionDatum.state.delay_period,
    };

    const mithrilClientState: MithrilClientState = getMithrilClientStateForVerifyProofRedeemer(
      connectionOpenAckOperator.counterpartyClientState,
    );
    const mithrilClientStateAny: Any = {
      type_url: '/ibc.clients.mithril.v1.ClientState',
      value: MithrilClientState.encode(mithrilClientState).finish(),
    };
    const verifyProofRedeemer: VerifyProofRedeemer = {
      BatchVerifyMembership: [
        [
          {
            cs: clientDatum.state.clientState,
            cons_state: consensusState,
            height: connectionOpenAckOperator.proofHeight,
            delay_time_period: updatedConnectionDatum.state.delay_period,
            delay_block_period: BigInt(getBlockDelay(updatedConnectionDatum.state.delay_period)),
            proof: connectionOpenAckOperator.proofTry,
            path: {
              key_path: [
                updatedConnectionDatum.state.counterparty.prefix.key_prefix,
                convertString2Hex(
                  connectionPath(convertHex2String(updatedConnectionDatum.state.counterparty.connection_id)),
                ),
              ],
            },
            value: toHex(ConnectionEnd.encode(cardanoConnectionEnd).finish()),
          },
          {
            cs: clientDatum.state.clientState,
            cons_state: consensusState,
            height: connectionOpenAckOperator.proofHeight,
            delay_time_period: updatedConnectionDatum.state.delay_period,
            delay_block_period: BigInt(getBlockDelay(updatedConnectionDatum.state.delay_period)),
            proof: connectionOpenAckOperator.proofClient,
            path: {
              key_path: [
                updatedConnectionDatum.state.counterparty.prefix.key_prefix,
                convertString2Hex(
                  clientStatePath(convertHex2String(updatedConnectionDatum.state.counterparty.client_id)),
                ),
              ],
            },
            value: toHex(Any.encode(mithrilClientStateAny).finish()),
          },
        ],
      ],
    };

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );

    const unsignedConnectionOpenAckParams: UnsignedConnectionOpenAckDto = {
      connectionUtxo,
      encodedSpendConnectionRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedUpdatedConnectionDatum,
      constructedAddress,
      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };
    return this.lucidService.createUnsignedConnectionOpenAckTransaction(unsignedConnectionOpenAckParams);
  }
  /* istanbul ignore next */
  async buildUnsignedConnectionOpenConfirmTx(
    connectionOpenConfirmOperator: ConnectionOpenConfirmOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
    // Get the token unit associated with the client
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      BigInt(connectionOpenConfirmOperator.connectionSequence),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const spendConnectionRedeemer: SpendConnectionRedeemer = {
      ConnOpenConfirm: {
        proof_height: connectionOpenConfirmOperator.proofHeight,
        proof_ack: connectionOpenConfirmOperator.proofAck,
      },
    };
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    if (connectionDatum.state.state !== State.Init) {
      throw new Error('ConnOpenAck to a Connection not in Init state');
    }
    const clientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    const updatedConnectionDatum: ConnectionDatum = {
      ...connectionDatum,
      state: {
        ...connectionDatum.state,
        state: State.Open,
      },
    };
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(clientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const encodedSpendConnectionRedeemer = await this.lucidService.encode<SpendConnectionRedeemer>(
      spendConnectionRedeemer,
      'spendConnectionRedeemer',
    );
    const encodedUpdatedConnectionDatum = await this.lucidService.encode<ConnectionDatum>(
      updatedConnectionDatum,
      'connection',
    );
    return this.lucidService.createUnsignedConnectionOpenConfirmTransaction(
      connectionUtxo,
      encodedSpendConnectionRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedUpdatedConnectionDatum,
      constructedAddress,
    );
  }
}
