import { MsgUpdateClientResponse } from '../../cosmjs-types/src/ibc/core/client/v1/tx';
import { type Tx, TxComplete, UTxO } from 'lucid-cardano';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
  MsgConnectionOpenInit,
  MsgConnectionOpenInitResponse,
  MsgConnectionOpenTry,
} from 'cosmjs-types/src/ibc/core/connection/v1/tx';
import { RpcException } from '@nestjs/microservices';
import { ConnectionOpenInitOperator } from './dto/connection/connection-open-init-operator.dto';
import { ConnectionOpenTryOperator } from './dto/connection/connection-open-try-operator.dto';
import {
  CLIENT_ID_PREFIX,
  CLIENT_PREFIX,
  CONNECTION_ID_PREFIX,
  DEFAULT_FEATURES_VERSION_ORDER_ORDERED,
  DEFAULT_FEATURES_VERSION_ORDER_UNORDERED,
  DEFAULT_IDENTIFIER_VERSION,
} from 'src/constant';
import { ConnectionOpenAckOperator } from './dto/connection/connection-open-ack-operator.dto';
import { ConnectionOpenConfirmOperator } from './dto/connection/connection-open-confirm-operator.dto';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { AuthToken } from 'src/shared/types/auth-token';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { State } from 'src/shared/types/connection/state';
import { MintConnectionRedeemer, SpendConnectionRedeemer } from 'src/shared/types/connection/connection-redeemer';
import { ConfigService } from '@nestjs/config';
import { parseClientSequence } from 'src/shared/helpers/sequence';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}
  /**
   * Processes the connection open init tx.
   * @param data The message containing connection open initiation data.
   * @returns A promise resolving to a message response for connection open initiation include the unsigned_tx.
   */
  async connectionOpenInit(data: MsgConnectionOpenInit): Promise<MsgConnectionOpenInitResponse> {
    try {
      this.logger.log('Connection Open Init is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
        );
      const clientSequence: string = data.client_id.replaceAll(`${CLIENT_ID_PREFIX}-`, '');
      // Prepare the connection open init operator object
      const connectionOpenInitOperator: ConnectionOpenInitOperator = {
        clientId: clientSequence,
        versions: [
          {
            identifier: DEFAULT_IDENTIFIER_VERSION,
            features: [DEFAULT_FEATURES_VERSION_ORDER_ORDERED, DEFAULT_FEATURES_VERSION_ORDER_UNORDERED],
          },
        ],
        counterparty: {
          client_id: this.lucidService.toHex(data.counterparty.client_id),
          connection_id: data.counterparty.connection_id || '',
          prefix: {
            key_prefix: this.lucidService.toBytes(data.counterparty.prefix.key_prefix),
          },
        },
      };
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenInitTx: Tx = await this.buildUnsignedConnectionOpenInitTx(
        connectionOpenInitOperator,
        constructedAddress,
      );
      const unsignedConnectionOpenInitTxValidTo: Tx = unsignedConnectionOpenInitTx.validTo(Date.now() + 100 * 1e3);

      const unsignedConnectionOpenInitTxCompleted: TxComplete = await unsignedConnectionOpenInitTxValidTo.complete();

      this.logger.log(unsignedConnectionOpenInitTxCompleted.toHash(), 'connection open init - unsignedTX - hash');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedConnectionOpenInitTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(error, 'connectionOpenInit');
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
  async connectionOpenTry(data: MsgConnectionOpenTry): Promise<MsgUpdateClientResponse> {
    try {
      this.logger.log('Connection Open Try is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
        );
      const clientSequence: string = data.client_id.replaceAll(`${CLIENT_ID_PREFIX}-`, '');
      // Prepare the connection open try operator object
      const connectionOpenTryOperator: ConnectionOpenTryOperator = {
        clientId: clientSequence,
        counterparty: {
          client_id: this.lucidService.toHex(data.counterparty.client_id),
          connection_id: this.lucidService.toHex(data.counterparty.connection_id),
          prefix: {
            key_prefix: this.lucidService.toBytes(data.counterparty.prefix.key_prefix),
          },
        },
        versions: [
          {
            identifier: DEFAULT_IDENTIFIER_VERSION,
            features: [DEFAULT_FEATURES_VERSION_ORDER_ORDERED, DEFAULT_FEATURES_VERSION_ORDER_UNORDERED],
          },
        ],
        counterpartyClientState: this.lucidService.toBytes(data.client_state!.value),
        proofInit: this.lucidService.toBytes(data.proof_init),
        proofClient: this.lucidService.toBytes(data.proof_client),
        proofHeight: {
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
        },
      };
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenTryTx: Tx = await this.buildUnsignedConnectionOpenTryTx(
        connectionOpenTryOperator,
        constructedAddress,
      );
      const unsignedConnectionOpenTryTxValidTo: Tx = unsignedConnectionOpenTryTx.validTo(Date.now() + 100 * 1e3);

      const unsignedConnectionOpenTryTxCompleted: TxComplete = await unsignedConnectionOpenTryTxValidTo.complete();

      this.logger.log(unsignedConnectionOpenTryTxCompleted.toHash(), 'connection open try - unsignedTX - hash');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedConnectionOpenTryTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(error.stack, 'connectionOpenTry');
      this.logger.error(`connectionOpenTry: ${error.stack}`);
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
  async connectionOpenAck(data: MsgConnectionOpenAck): Promise<MsgUpdateClientResponse> {
    try {
      this.logger.log('Connection Open Ack is processing', 'connectionOpenAck');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.connection_id.startsWith(`${CONNECTION_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
        );
      const connectionSequence = data.connection_id.replaceAll(`${CONNECTION_ID_PREFIX}-`, '');
      // Prepare the connection open ack operator object
      const connectionOpenAckOperator: ConnectionOpenAckOperator = {
        connectionSequence: connectionSequence,
        counterpartyClientState: this.lucidService.toBytes(data.client_state!.value),
        //TODO: change to hex if connection id not in right form
        counterpartyConnectionID: this.lucidService.toHex(data.counterparty_connection_id),
        proofTry: this.lucidService.toBytes(data.proof_try),
        proofClient: this.lucidService.toBytes(data.proof_client),
        proofHeight: {
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
        },
      };
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenAckTx: Tx = await this.buildUnsignedConnectionOpenAckTx(
        connectionOpenAckOperator,
        constructedAddress,
      );
      const unsignedConnectionOpenAckTxValidTo: Tx = unsignedConnectionOpenAckTx.validTo(Date.now() + 100 * 1e3);

      const unsignedConnectionOpenAckTxCompleted: TxComplete = await unsignedConnectionOpenAckTxValidTo.complete();

      this.logger.log(unsignedConnectionOpenAckTxCompleted.toHash(), 'connection open ack - unsignedTX - hash');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedConnectionOpenAckTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(error, 'connectionOpenAck');
      this.logger.error(`connectionOpenAck: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error.stack}`);
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
  async connectionOpenConfirm(data: MsgConnectionOpenConfirm): Promise<MsgUpdateClientResponse> {
    try {
      this.logger.log('Connection Open Confirm is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.connection_id.startsWith(`${CONNECTION_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
        );
      const connectionSequence = data.connection_id.replaceAll(`${CONNECTION_ID_PREFIX}-`, '');
      // Prepare the connection open confirm operator object
      const connectionOpenConfirmOperator: ConnectionOpenConfirmOperator = {
        connectionSequence: connectionSequence,
        //TODO: change to hex if connection id not in right form
        proofAck: this.lucidService.toBytes(data.proof_ack),
        proofHeight: {
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
        },
      };
      // Build and complete the unsigned transaction
      const unsignedConnectionOpenConfirmTx: Tx = await this.buildUnsignedConnectionOpenConfirmTx(
        connectionOpenConfirmOperator,
        constructedAddress,
      );
      const unsignedConnectionOpenConfirmTxValidTo: Tx = unsignedConnectionOpenConfirmTx.validTo(
        Date.now() + 150 * 1e3,
      );

      const unsignedConnectionOpenConfirmTxCompleted: TxComplete =
        await unsignedConnectionOpenConfirmTxValidTo.complete();

      this.logger.log(unsignedConnectionOpenConfirmTxCompleted.toHash(), 'connection open confirm - unsignedTX - hash');
      const response: MsgConnectionOpenInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedConnectionOpenConfirmTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgUpdateClientResponse;
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
  ): Promise<Tx> {
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionOpenInitOperator.clientId);
    // Find the UTXO for the client token
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    // Retrieve the current client datum from the UTXO
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: handlerDatum.state.next_connection_sequence + 1n,
      },
    };
    const spendHandlerRedeemer: HandlerOperator = 'HandlerConnOpenInit';
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      handlerDatum.state.next_connection_sequence,
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    const connToken: AuthToken = {
      policyId: mintConnectionPolicyId,
      name: connectionTokenName,
    };
    const connectionDatum: ConnectionDatum = {
      state: {
        client_id: CLIENT_PREFIX + this.lucidService.toHex('-' + connectionOpenInitOperator.clientId),
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

    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode<HandlerDatum>(
      updatedHandlerDatum,
      'handler',
    );
    const encodedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      connectionDatum,
      'connection',
    );
    return this.lucidService.createUnsignedConnectionOpenInitTransaction(
      handlerUtxo,
      encodedSpendHandlerRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedMintConnectionRedeemer,
      encodedUpdatedHandlerDatum,
      encodedConnectionDatum,
      constructedAddress,
    );
  }

  public async buildUnsignedConnectionOpenTryTx(
    connectionOpenTryOperator: ConnectionOpenTryOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionOpenTryOperator.clientId);
    // Find the UTXO for the client token
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    // Retrieve the current client datum from the UTXO
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_connection_sequence: handlerDatum.state.next_connection_sequence + 1n,
      },
    };
    const spendHandlerRedeemer: HandlerOperator = 'HandlerConnOpenTry';
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      handlerDatum.state.next_connection_sequence,
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    const connToken: AuthToken = {
      policyId: mintConnectionPolicyId,
      name: connectionTokenName,
    };
    const connectionDatum: ConnectionDatum = {
      state: {
        client_id: CLIENT_PREFIX + this.lucidService.toHex('-' + connectionOpenTryOperator.clientId),
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
    const encodedMintConnectionRedeemer: string = await this.lucidService.encode<MintConnectionRedeemer>(
      mintConnectionRedeemer,
      'mintConnectionRedeemer',
    );
    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode<HandlerDatum>(
      updatedHandlerDatum,
      'handler',
    );
    const encodedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      connectionDatum,
      'connection',
    );
    return this.lucidService.createUnsignedConnectionOpenTryTransaction(
      handlerUtxo,
      encodedSpendHandlerRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedMintConnectionRedeemer,
      encodedUpdatedHandlerDatum,
      encodedConnectionDatum,
      constructedAddress,
    );
  }

  private async buildUnsignedConnectionOpenAckTx(
    connectionOpenAckOperator: ConnectionOpenAckOperator,
    constructedAddress: string,
  ): Promise<Tx> {
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
    //TODO: check how to convert back to normal string
    const clientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
    const encodedSpendConnectionRedeemer = await this.lucidService.encode<SpendConnectionRedeemer>(
      spendConnectionRedeemer,
      'spendConnectionRedeemer',
    );
    const encodedUpdatedConnectionDatum: string = await this.lucidService.encode<ConnectionDatum>(
      updatedConnectionDatum,
      'connection',
    );
    return this.lucidService.createUnsignedConnectionOpenAckTransaction(
      connectionUtxo,
      encodedSpendConnectionRedeemer,
      connectionTokenUnit,
      clientUtxo,
      encodedUpdatedConnectionDatum,
      constructedAddress,
    );
  }
  async buildUnsignedConnectionOpenConfirmTx(
    connectionOpenConfirmOperator: ConnectionOpenConfirmOperator,
    constructedAddress: string,
  ): Promise<Tx> {
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
    //TODO: check how to convert back to normal string
    const clientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
