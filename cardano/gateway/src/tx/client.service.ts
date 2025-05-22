import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/tx';
import { fromHex, TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConsensusState } from '../shared/types/consensus-state';
import { ClientState } from '../shared/types/client-state-types';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from 'nestjs-grpc-exceptions';
import { decodeHeader, initializeHeader } from '../shared/types/header';
import { RpcException } from '@nestjs/microservices';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { ConfigService } from '@nestjs/config';
import { ClientDatumState } from 'src/shared/types/client-datum-state';
import { CLIENT_ID_PREFIX, CLIENT_PREFIX, HANDLER_TOKEN_NAME, MAX_CONSENSUS_STATE_SIZE } from 'src/constant';
import { ClientDatum } from 'src/shared/types/client-datum';
import { MintClientOperator } from 'src/shared/types/mint-client-operator';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { SpendClientRedeemer } from 'src/shared/types/client-redeemer';
import { Height } from 'src/shared/types/height';
import { isExpired } from '@shared/helpers/client-state';
import {
  ClientMessage,
  getClientMessageFromTendermint,
  verifyClientMessage,
} from '../shared/types/msgs/client-message';
import { checkForMisbehaviour } from '@shared/types/misbehaviour/misbehaviour';
import { UpdateOnMisbehaviourOperatorDto, UpdateClientOperatorDto } from './dto/client/update-client-operator.dto';
import { validateAndFormatCreateClientParams, validateAndFormatUpdateClientParams } from './helper/client.validate';

@Injectable()
export class ClientService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}
  /**
   * Processes the creation of a client tx.
   * @param data The message containing client creation data.
   * @returns A promise resolving to a message response for client creation include the unsigned_tx.
   */
  async createClient(data: MsgCreateClient): Promise<MsgCreateClientResponse> {
    try {
      this.logger.log('Create client is processing', 'createClient');
      const { constructedAddress, clientState, consensusState } = validateAndFormatCreateClientParams(data);
      // Build unsigned create client transaction
      const { unsignedTx: unsignedCreateClientTx, clientId } = await this.buildUnsignedCreateClientTx(
        clientState,
        consensusState,
        constructedAddress,
      );

      const validToTime = Number(consensusState.timestamp / 10n ** 6n + 120n * 10n ** 3n);
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException(
          `create client failed: tx time invalid consesusState.timestamp ${consensusState.timestamp} validToTime ${validToTime} validToSlot ${validToSlot} currentSlot ${currentSlot}`,
        );
      }

      const unSignedTxValidTo: TxBuilder = unsignedCreateClientTx.validTo(validToTime);
      // Todo: signing should be done by the relayer in the future
      const signedCreateClientTxCompleted = await (await unSignedTxValidTo.complete()).sign.withWallet().complete();
      this.logger.log(signedCreateClientTxCompleted.toHash(), 'create client - unsignedTX');
      this.logger.log(clientId, 'create client - clientId');
      const response: MsgCreateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedCreateClientTxCompleted.toCBOR()),
        },
        client_id: `${CLIENT_ID_PREFIX}-${clientId.toString()}`,
      } as unknown as MsgCreateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(`createClient: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error.stack}`);
      } else {
        throw error;
      }
    }
  }
  /**
   * Processes the update of a client tx .
   * @param data The message containing client update data.
   * @returns A promise resolving to a message response for client update include the unsigned_tx.
   */
  async updateClient(data: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    try {
      const { clientId, constructedAddress } = validateAndFormatUpdateClientParams(data);

      // Get the token unit associated with the client
      const clientTokenUnit = this.lucidService.getClientTokenUnit(clientId);
      // Find the UTXO for the client token
      const currentClientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
      // Retrieve the current client datum from the UTXO
      const currentClientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(
        currentClientUtxo.datum!,
        'client',
      );

      verifyClientMessage(data.client_message, currentClientDatum);
      const foundMisbehaviour = checkForMisbehaviour(data.client_message, currentClientDatum);

      if (foundMisbehaviour) {
        // Build and complete the unsigned transaction
        const updateOnMisbehaviourOperator: UpdateOnMisbehaviourOperatorDto = {
          clientId,
          clientMessage: data.client_message,
          constructedAddress,
          clientDatum: currentClientDatum,
          clientTokenUnit,
          currentClientUtxo,
        };

        const unsignedUpdateClientTx: TxBuilder =
          await this.buildUnsignedUpdateOnMisbehaviour(updateOnMisbehaviourOperator);
        const unSignedTxValidTo: TxBuilder = unsignedUpdateClientTx
          .validFrom(new Date().valueOf())
          .validTo(new Date().valueOf());
        // Todo: signing should be done by the relayer in the future
        const signedUpdateClientTxCompleted = await (await unSignedTxValidTo.complete()).sign.withWallet().complete();

        this.logger.log(clientId, 'update client - client Id');
        this.logger.log(signedUpdateClientTxCompleted.toHash(), 'update client on misbehaviour - unsignedTX - hash');
        const response: MsgUpdateClientResponse = {
          unsigned_tx: {
            type_url: '',
            value: fromHex(signedUpdateClientTxCompleted.toCBOR()),
          },
          client_id: parseInt(clientId.toString()),
        } as unknown as MsgUpdateClientResponse;
        return response;
      }
      const headerMsg = decodeHeader(data.client_message.value);
      const header = initializeHeader(headerMsg);
      const validFromTime =
        (BigInt(header.signedHeader.header.time || 0) -
          BigInt(currentClientDatum.state.clientState.maxClockDrift || 0)) /
          10n ** 6n +
        100n * 10n ** 3n;
      const validToTime = new Date().valueOf() + 100 * 1e3;
      const updateClientHeaderOperator: UpdateClientOperatorDto = {
        clientId,
        header,
        constructedAddress,
        clientDatum: currentClientDatum,
        clientTokenUnit,
        currentClientUtxo,
        txValidFrom: validFromTime,
      };

      const unsignedUpdateClientTx: TxBuilder = await this.buildUnsignedUpdateClientTx(updateClientHeaderOperator);

      const validFromSlot = this.lucidService.lucid.unixTimeToSlot(Number(validFromTime));
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot < validFromSlot || currentSlot > validToSlot) {
        throw new GrpcInternalException('tx time invalid');
      }

      const validFrom = Number(validFromTime);
      const validTo = new Date().valueOf() + 100 * 1e3;

      const unSignedTxValidTo: TxBuilder = unsignedUpdateClientTx.validFrom(validFrom).validTo(validTo);

      // Todo: signing should be done by the relayer in the future
      const signedUpdateClientTxCompleted = await (await unSignedTxValidTo.complete()).sign.withWallet().complete();

      // Build and complete the unsigned transaction
      const response: MsgUpdateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedUpdateClientTxCompleted.toCBOR()),
        },
        client_id: parseInt(clientId.toString()),
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      console.error(error);

      this.logger.error(`updateClient: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error.stack}`);
      } else {
        throw error;
      }
    }
  }
  public async buildUnsignedUpdateOnMisbehaviour(
    updateOnMisbehaviourOperator: UpdateOnMisbehaviourOperatorDto,
  ): Promise<TxBuilder> {
    const currentClientDatumState = updateOnMisbehaviourOperator.clientDatum.state;
    const clientMessageAny = updateOnMisbehaviourOperator.clientMessage;
    const clientMessage: ClientMessage = getClientMessageFromTendermint(clientMessageAny);

    // Create a SpendClientRedeemer using the provided header
    const spendClientRedeemer: SpendClientRedeemer = {
      UpdateClient: {
        msg: clientMessage,
      },
    };

    const newClientState: ClientState = {
      ...currentClientDatumState.clientState,
      frozenHeight: {
        revisionNumber: 0n,
        revisionHeight: 1n,
      } as Height,
    };

    const newClientDatum: ClientDatum = {
      ...updateOnMisbehaviourOperator.clientDatum,
      state: {
        ...updateOnMisbehaviourOperator.clientDatum.state,
        clientState: newClientState,
      },
    };

    const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    return this.lucidService.createUnsignedUpdateClientTransaction(
      updateOnMisbehaviourOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedNewClientDatum,
      updateOnMisbehaviourOperator.clientTokenUnit,
      updateOnMisbehaviourOperator.constructedAddress,
    );
  }

  /**
   * Builds an unsigned UpdateClient transaction.
   */
  public async buildUnsignedUpdateClientTx(updateClientOperator: UpdateClientOperatorDto): Promise<TxBuilder> {
    const currentClientDatumState = updateClientOperator.clientDatum.state;
    const header = updateClientOperator.header;
    // Create a SpendClientRedeemer using the provided header
    const spendClientRedeemer: SpendClientRedeemer = {
      UpdateClient: {
        msg: {
          HeaderCase: [header],
        },
      },
    };
    const headerHeight = header.signedHeader.header.height;
    const newHeight: Height = {
      ...currentClientDatumState.clientState.latestHeight,
      revisionHeight: headerHeight,
      // revisionHeight: headerHeight,
    };

    const newClientState: ClientState = {
      ...currentClientDatumState.clientState,
      latestHeight: newHeight,
    };

    const newConsState: ConsensusState = {
      timestamp: header.signedHeader.header.time,
      next_validators_hash: header.signedHeader.header.nextValidatorsHash,
      root: {
        hash: header.signedHeader.header.appHash,
      },
    };
    let currentConsStateInArray = Array.from(currentClientDatumState.consensusStates.entries()).filter(
      ([_, consState]) => !isExpired(newClientState, consState.timestamp, updateClientOperator.txValidFrom),
    );

    if (currentConsStateInArray.some(([key]) => headerHeight === key.revisionHeight)) {
      console.dir(
        {
          proofHeight: headerHeight,
          currentConsStateInArray,
        },
        { depth: 10 },
      );
      throw new GrpcInternalException(`Client already created at height: ${headerHeight}`);
    }

    currentConsStateInArray.unshift([newHeight, newConsState]);
    if (currentConsStateInArray.length > MAX_CONSENSUS_STATE_SIZE) {
      currentConsStateInArray = currentConsStateInArray.splice(0, MAX_CONSENSUS_STATE_SIZE);
    }

    const newConsStates = new Map(currentConsStateInArray);
    const newClientDatum: ClientDatum = {
      ...updateClientOperator.clientDatum,
      state: {
        clientState: newClientState,
        consensusStates: newConsStates,
      },
    };

    const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    return this.lucidService.createUnsignedUpdateClientTransaction(
      updateClientOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedNewClientDatum,
      updateClientOperator.clientTokenUnit,
      updateClientOperator.constructedAddress,
    );
  }
  /**
   * Builds an unsigned transaction for creating a new client, incorporating client and consensus state.
   *
   * @returns A Promise resolving to the unsigned transaction (Tx) for creating a new client.
   */
  public async buildUnsignedCreateClientTx(
    clientState: ClientState,
    consensusState: ConsensusState,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; clientId: bigint }> {
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    // Decode the handler datum from the handler UTXO
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    // Create an updated handler datum with an incremented client sequence
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_client_sequence: handlerDatum.state.next_client_sequence + 1n,
      },
    };
    const mintClientScriptHash = this.configService.get('deployment').validators.mintClient.scriptHash;

    const clientDatumState: ClientDatumState = {
      clientState: clientState,
      consensusStates: new Map([[clientState.latestHeight, consensusState]]),
    };

    const clientTokenName = this.generateClientTokenName(handlerDatum);

    const clientDatum: ClientDatum = {
      state: clientDatumState,
      token: {
        policyId: mintClientScriptHash,
        name: clientTokenName,
      },
    };
    const mintClientOperator: MintClientOperator = this.createMintClientOperator();
    const clientAuthTokenUnit = mintClientScriptHash + clientTokenName;
    const handlerOperator: HandlerOperator = 'CreateClient';
    // Encode encoded data for created transaction
    const encodedMintClientOperator: string = await this.lucidService.encode(mintClientOperator, 'mintClientOperator');
    const encodedHandlerOperator: string = await this.lucidService.encode(handlerOperator, 'handlerOperator');
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode<HandlerDatum>(
      updatedHandlerDatum,
      'handler',
    );
    const encodedClientDatum = await this.lucidService.encode<ClientDatum>(clientDatum, 'client');
    // Create and return the unsigned transaction for creating new client
    return {
      unsignedTx: this.lucidService.createUnsignedCreateClientTransaction(
        handlerUtxo,
        encodedHandlerOperator,
        clientAuthTokenUnit,
        encodedMintClientOperator,
        encodedUpdatedHandlerDatum,
        encodedClientDatum,
        constructedAddress,
      ),
      clientId: handlerDatum.state.next_client_sequence,
    };
  }
  private generateClientTokenName(handlerDatum: HandlerDatum): string {
    // const encodedNextClientSequence = this.LucidImporter.Data.to(handlerDatum.state.next_client_sequence);
    return this.lucidService.generateTokenName(
      handlerDatum.token,
      CLIENT_PREFIX,
      handlerDatum.state.next_client_sequence,
    );
  }

  private createMintClientOperator(): MintClientOperator {
    return {
      MintNewClient: {
        handlerAuthToken: {
          name: HANDLER_TOKEN_NAME,
          policyId: this.configService.get('deployment').handlerAuthToken.policyId,
        },
      },
    };
  }
}
