import { MsgUpdateClientResponse } from '@plus/proto-types/build/ibc/core/client/v1/tx';
import { TxBuilder, UTxO, fromHex } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { inspect } from 'util';
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
import { CLIENT_ID_PREFIX, CONNECTION_ID_PREFIX, DEFAULT_MERKLE_PREFIX } from 'src/constant';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { AuthToken } from 'src/shared/types/auth-token';
import { ConnectionDatum, encodeConnectionEndValue } from 'src/shared/types/connection/connection-datum';
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
  computeRootWithCreateConnectionUpdate as computeRootWithCreateConnectionUpdateHelper,
  alignTreeWithChain,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';
import { ConnectionEnd, State as ConnectionState } from '@plus/proto-types/build/ibc/core/connection/v1/connection';
import { clientStatePath } from '~@/shared/helpers/client-state';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { getMithrilClientStateForVerifyProofRedeemer } from '../shared/helpers/mithril-client';
import { ClientState as MithrilClientState } from '@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril';
import {
  ConnectionOpenAckOperator,
  ConnectionOpenConfirmOperator,
  ConnectionOpenInitOperator,
  ConnectionOpenTryOperator,
} from './dto';
import { UnsignedConnectionOpenAckDto } from '~@/shared/modules/lucid/dtos';
import { TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { TxEventsService } from './tx-events.service';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txEventsService: TxEventsService,
  ) {}

  /**
   * Compute the new IBC state root for CreateConnection, plus the update witness
   * required by the on-chain HostState validator.
   */
  private computeRootWithCreateConnectionUpdate(
    oldRoot: string,
    connectionId: string,
    connectionEndValue: Buffer,
  ): { newRoot: string; connectionSiblings: string[] } {
    const result = computeRootWithCreateConnectionUpdateHelper(oldRoot, connectionId, connectionEndValue);
    return { newRoot: result.newRoot, connectionSiblings: result.connectionSiblings };
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
      const { unsignedTx: unsignedConnectionOpenInitTx, connectionId } = await this.buildUnsignedConnectionOpenInitTx(
        connectionOpenInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenInitTxValidTo: TxBuilder = unsignedConnectionOpenInitTx.validTo(validToTime);

      // DEBUG: emit CBOR and key inputs so we can reproduce Ogmios eval failures
      const completedUnsignedTx = await unsignedConnectionOpenInitTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      this.logger.log(
        `[DEBUG] connectionOpenInit unsigned CBOR len=${unsignedTxCbor.length}, head=${unsignedTxCbor.substring(0, 80)}`,
      );
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'connection_open_init',
          attributes: [
            { key: 'connection_id', value: connectionId },
            { key: 'client_id', value: data.client_id },
            { key: 'counterparty_client_id', value: data.counterparty.client_id },
            { key: 'counterparty_connection_id', value: data.counterparty.connection_id || '' },
          ],
        },
      ]);

      // Return unsigned transaction for Hermes to sign
      this.logger.log('Returning unsigned tx for connection open init');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
        },
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(`connectionOpenInit: ${error}`);
      this.logger.error(`[DEBUG] connectionOpenInit error detail: ${inspect(error, { depth: 15 })}`);
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
      const { unsignedTx: unsignedConnectionOpenTryTx, connectionId } = await this.buildUnsignedConnectionOpenTryTx(
        connectionOpenTryOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenTryTxValidTo: TxBuilder = unsignedConnectionOpenTryTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenTryTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'connection_open_try',
          attributes: [
            { key: 'connection_id', value: connectionId },
            { key: 'client_id', value: data.client_id },
            { key: 'counterparty_client_id', value: data.counterparty.client_id },
            { key: 'counterparty_connection_id', value: data.counterparty.connection_id },
          ],
        },
      ]);

      this.logger.log('Returning unsigned tx for connection open try');
      const response: MsgConnectionOpenTryResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
      const { unsignedTx: unsignedConnectionOpenAckTx, clientId, counterpartyClientId } =
        await this.buildUnsignedConnectionOpenAckTx(
        connectionOpenAckOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenAckTxValidTo: TxBuilder = unsignedConnectionOpenAckTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenAckTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'connection_open_ack',
          attributes: [
            { key: 'connection_id', value: data.connection_id },
            { key: 'client_id', value: clientId },
            { key: 'counterparty_client_id', value: counterpartyClientId },
            { key: 'counterparty_connection_id', value: data.counterparty_connection_id },
          ],
        },
      ]);

      this.logger.log('Returning unsigned tx for connection open ack');
      const response: MsgConnectionOpenAckResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
      const {
        unsignedTx: unsignedConnectionOpenConfirmTx,
        clientId,
        counterpartyClientId,
        counterpartyConnectionId,
      } = await this.buildUnsignedConnectionOpenConfirmTx(
        connectionOpenConfirmOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenConfirmTxValidTo: TxBuilder = unsignedConnectionOpenConfirmTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedConnectionOpenConfirmTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'connection_open_confirm',
          attributes: [
            { key: 'connection_id', value: data.connection_id },
            { key: 'client_id', value: clientId },
            { key: 'counterparty_client_id', value: counterpartyClientId },
            { key: 'counterparty_connection_id', value: counterpartyConnectionId },
          ],
        },
      ]);

      this.logger.log('Returning unsigned tx for connection open confirm');
      const response: MsgConnectionOpenConfirmResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
  ): Promise<{ unsignedTx: TxBuilder; connectionId: string }> {
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

    // Derive the new connection identifier from the HostState sequence.
    const connectionId = `connection-${hostStateDatum.state.next_connection_sequence}`;

    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
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

    // The on-chain HostState validator enforces that `ibc_state_root` is derived from
    // the previous root with exactly the allowed CreateConnection key update applied.
    //
    // This means we must commit the exact bytes that the on-chain code uses:
    // `cbor.serialise(connection_end)`.
    const connectionEnd: ConnectionDatum['state'] = {
      // IMPORTANT: The IBC store key for client state is derived from the client identifier string.
      // For Cardano↔Cosmos parity, this must use canonical IBC identifiers like `07-tendermint-{n}`,
      // not the internal NFT/token prefix used by the STT auth tokens.
      client_id: convertString2Hex(`${CLIENT_ID_PREFIX}-${connectionOpenInitOperator.clientId}`),
      counterparty: connectionOpenInitOperator.counterparty,
      delay_period: 0n,
      versions: connectionOpenInitOperator.versions,
      state: State.Init,
    };
    const connectionEndValue = Buffer.from(
      await encodeConnectionEndValue(connectionEnd, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, connectionSiblings } = this.computeRootWithCreateConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      connectionEndValue,
    );

    // Update both Handler and HostState roots to the new committed root.
    updatedHandlerDatum.state.ibc_state_root = newRoot;

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
    const connectionDatum: ConnectionDatum = {
      state: connectionEnd,
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
    const hostStateRedeemer = {
      CreateConnection: {
        connection_siblings: connectionSiblings,
      },
    };
    const encodedHostStateRedeemer = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');

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
    const unsignedTx = this.lucidService.createUnsignedConnectionOpenInitTransaction(
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
    return { unsignedTx, connectionId };
  }

  /* istanbul ignore next */
  public async buildUnsignedConnectionOpenTryTx(
    connectionOpenTryOperator: ConnectionOpenTryOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; connectionId: string }> {
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
    
    // Derive the new connection identifier from the HostState sequence.
    const connectionId = `connection-${hostStateDatum.state.next_connection_sequence}`;
    
    // Retrieve the current client datum from the UTXO
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: hostStateDatum.state.next_connection_sequence + 1n,
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

    const connectionEnd: ConnectionDatum['state'] = {
      // See the note in `connectionOpenInit`: this must be the canonical IBC client identifier.
      client_id: convertString2Hex(`${CLIENT_ID_PREFIX}-${connectionOpenTryOperator.clientId}`),
      counterparty: connectionOpenTryOperator.counterparty,
      delay_period: 0n,
      versions: connectionOpenTryOperator.versions,
      state: State.TryOpen,
    };
    const connectionEndValue = Buffer.from(
      await encodeConnectionEndValue(connectionEnd, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, connectionSiblings } = this.computeRootWithCreateConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      connectionEndValue,
    );

    updatedHandlerDatum.state.ibc_state_root = newRoot;

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
    const connectionDatum: ConnectionDatum = {
      state: connectionEnd,
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
    const hostStateRedeemer = {
      CreateConnection: {
        connection_siblings: connectionSiblings,
      },
    };
    const encodedHostStateRedeemer = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
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
    const unsignedTx = this.lucidService.createUnsignedConnectionOpenTryTransaction(
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
    return { unsignedTx, connectionId };
  }

  private async buildUnsignedConnectionOpenAckTx(
    connectionOpenAckOperator: ConnectionOpenAckOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; clientId: string; counterpartyClientId: string }> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum!,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing a witness.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

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
    const clientId = convertHex2String(connectionDatum.state.client_id);
    const counterpartyClientId = convertHex2String(connectionDatum.state.counterparty.client_id);

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

    // Root correctness enforcement: update the committed `connections/{id}` value.
    //
    // The on-chain `host_state_stt` validator will recompute the root update from the
    // old and new connection datums in this transaction, using the sibling hashes below.
    const connectionId = `${CONNECTION_ID_PREFIX}-${connectionOpenAckOperator.connectionSequence}`;
    const updatedConnectionEndValue = Buffer.from(
      await encodeConnectionEndValue(updatedConnectionDatum.state, this.lucidService.LucidImporter),
      'hex',
    );
    const { newRoot, connectionSiblings } = this.computeRootWithCreateConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      updatedConnectionEndValue,
    );

    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const hostStateRedeemer = {
      UpdateConnection: {
        connection_siblings: connectionSiblings,
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
    const encodedHostStateRedeemer = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');

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
      type_url: '/ibc.lightclients.mithril.v1.ClientState',
      value: MithrilClientState.encode(mithrilClientState).finish(),
    };

    // Debugging aid: verify that the Tendermint proofs Hermes provided are actually proving
    // the key/value pair we expect for ConnOpenAck (connection state + counterparty client state).
    //
    // If this is wrong, the on-chain `verify_proof` minting policy will fail, and the
    // `spend_connection` script will fail as well (it requires a successful verify-proof mint).
    try {
      const expectedConnKeyUtf8 = connectionPath(convertHex2String(updatedConnectionDatum.state.counterparty.connection_id));
      const expectedConnValue = ConnectionEnd.encode(cardanoConnectionEnd).finish();
      const expectedClientKeyUtf8 = clientStatePath(convertHex2String(updatedConnectionDatum.state.counterparty.client_id));
      const expectedClientValue = Any.encode(mithrilClientStateAny).finish();

      const firstExist = (proof: any) => {
        for (const p of proof?.proofs ?? []) {
          const inner = p?.proof;
          if (inner?.CommitmentProof_Exist?.exist) return inner.CommitmentProof_Exist.exist;
        }
        return undefined;
      };

      const tryExist = firstExist(connectionOpenAckOperator.proofTry as any);
      if (tryExist?.key && tryExist?.value) {
        const keyUtf8 = Buffer.from(tryExist.key, 'hex').toString('utf8');
        const valueBytes = Buffer.from(tryExist.value, 'hex');
        const decoded = ConnectionEnd.decode(valueBytes);
        this.logger.log(
          `[DEBUG] ConnOpenAck proof_try: key='${keyUtf8}', expected='${expectedConnKeyUtf8}', value_len=${valueBytes.length}, expected_len=${expectedConnValue.length}, decoded_state=${decoded.state}`,
        );
      }

      const clientExist = firstExist(connectionOpenAckOperator.proofClient as any);
      if (clientExist?.key && clientExist?.value) {
        const keyUtf8 = Buffer.from(clientExist.key, 'hex').toString('utf8');
        const valueBytes = Buffer.from(clientExist.value, 'hex');
        const decodedAny = Any.decode(valueBytes);
        this.logger.log(
          `[DEBUG] ConnOpenAck proof_client: key='${keyUtf8}', expected='${expectedClientKeyUtf8}', value_len=${valueBytes.length}, expected_len=${expectedClientValue.length}, any_type_url=${decodedAny.type_url}`,
        );
      }
    } catch (e) {
      this.logger.warn(`[DEBUG] ConnOpenAck proof debug failed: ${e}`);
    }

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
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      connectionUtxo,
      encodedSpendConnectionRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedUpdatedConnectionDatum,
      constructedAddress,
      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };
    const unsignedTx = this.lucidService.createUnsignedConnectionOpenAckTransaction(unsignedConnectionOpenAckParams);
    return { unsignedTx, clientId, counterpartyClientId };
  }
  /* istanbul ignore next */
  async buildUnsignedConnectionOpenConfirmTx(
    connectionOpenConfirmOperator: ConnectionOpenConfirmOperator,
    constructedAddress: string,
  ): Promise<{
    unsignedTx: TxBuilder;
    clientId: string;
    counterpartyClientId: string;
    counterpartyConnectionId: string;
  }> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum!,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing a witness.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

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
    const clientId = convertHex2String(connectionDatum.state.client_id);
    const counterpartyClientId = convertHex2String(connectionDatum.state.counterparty.client_id);
    const counterpartyConnectionId =
      /^[0-9a-fA-F]+$/.test(connectionDatum.state.counterparty.connection_id) &&
      connectionDatum.state.counterparty.connection_id.length % 2 === 0
        ? convertHex2String(connectionDatum.state.counterparty.connection_id)
        : connectionDatum.state.counterparty.connection_id;
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

    // Root correctness enforcement: update the committed `connections/{id}` value.
    const connectionId = `${CONNECTION_ID_PREFIX}-${connectionOpenConfirmOperator.connectionSequence}`;
    const updatedConnectionEndValue = Buffer.from(
      await encodeConnectionEndValue(updatedConnectionDatum.state, this.lucidService.LucidImporter),
      'hex',
    );
    const { newRoot, connectionSiblings } = this.computeRootWithCreateConnectionUpdate(
      hostStateDatum.state.ibc_state_root,
      connectionId,
      updatedConnectionEndValue,
    );

    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const hostStateRedeemer = {
      UpdateConnection: {
        connection_siblings: connectionSiblings,
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
    const encodedHostStateRedeemer = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const unsignedTx = this.lucidService.createUnsignedConnectionOpenConfirmTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      connectionUtxo,
      encodedSpendConnectionRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedUpdatedConnectionDatum,
      constructedAddress,
    );
    return { unsignedTx, clientId, counterpartyClientId, counterpartyConnectionId };
  }
}
