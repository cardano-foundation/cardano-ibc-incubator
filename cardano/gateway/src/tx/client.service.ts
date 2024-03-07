import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '../../cosmjs-types/src/ibc/core/client/v1/tx';
import { type Tx, TxComplete, UTxO } from 'lucid-cardano';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConsensusState } from '../shared/types/consesus-state';
import { ClientState } from '../shared/types/client-state-types';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import {
  ClientState as ClientStateMsg,
  ConsensusState as ConsensusStateMsg,
  Header as HeaderMsg,
} from 'cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { Header } from '../shared/types/header';
import { fromTimestamp } from 'cosmjs-types/src/helpers';
import { RpcException } from '@nestjs/microservices';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { ConfigService } from '@nestjs/config';
import { ClientDatumState } from 'src/shared/types/client-datum-state';
import { CLIENT_ID_PREFIX, CLIENT_PREFIX, HANDLER_TOKEN_NAME } from 'src/constant';
import { ClientDatum } from 'src/shared/types/client-datum';
import { MintClientOperator } from 'src/shared/types/mint-client-operator';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { SpendClientRedeemer } from 'src/shared/types/client-redeemer';
import { Height } from 'src/shared/types/height';

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
      const decodedClientStateMsg: ClientStateMsg = ClientStateMsg.decode(data.client_state.value);
      const decodedConsensusMsg: ConsensusStateMsg = ConsensusStateMsg.decode(data.consensus_state.value);
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      // Convert input messages to client and consensus state
      const clientState: ClientState = this.initializeClientState(decodedClientStateMsg);
      const consensusState: ConsensusState = this.initializeConsensusState(decodedConsensusMsg);
      // Build unsigned create client transaction
      const [unsignedCreateClientTx, clientId]: [Tx, bigint] = await this.buildUnsignedCreateClientTx(
        clientState,
        consensusState,
        constructedAddress,
      );
      const unSignedTxValidTo: Tx = unsignedCreateClientTx.validTo(
        Number(consensusState.timestamp / 10n ** 6n + 10n ** 6n),
      );
      const unsignedCreateClientTxCompleted: TxComplete = await unSignedTxValidTo.complete();

      this.logger.log(unsignedCreateClientTxCompleted.toHash(), 'create client - unsignedTX');
      this.logger.log(clientId, 'create client - clientId');
      const response: MsgCreateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedCreateClientTxCompleted.txComplete.to_bytes(),
        },
        client_id: `${CLIENT_ID_PREFIX}-${clientId.toString()}`,
      } as unknown as MsgCreateClientResponse;
      return response;
    } catch (error) {
      if (!(error instanceof RpcException)) {
        this.logger.error(`createClient: ${error}`);
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
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
      this.logger.log('Update client is processing');
      if (!data.client_id) {
        throw new GrpcInvalidArgumentException('Invalid clientId');
      }
      if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
        );
      const clientId: string = data.client_id.replaceAll(`${CLIENT_ID_PREFIX}-`, '');

      const clientMessage = data.client_message;
      const headerMsg = HeaderMsg.decode(clientMessage.value);
      const header = this.initializeHeader(headerMsg);
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      // Build and complete the unsigned transaction
      const unsignedUpdateClientTx: Tx = await this.buildUnsignedUpdateClientTx(clientId, header, constructedAddress);
      const unsignedUpdateClientTxCompleted: TxComplete = await unsignedUpdateClientTx.complete();
      this.logger.log(clientId, 'update client - client Id');
      this.logger.log(unsignedUpdateClientTxCompleted.toHash(), 'update client - unsignedTX - hash');
      const response: MsgUpdateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedUpdateClientTxCompleted.txComplete.to_bytes(),
        },
        client_id: parseInt(clientId.toString()),
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(`updateClient: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Builds an unsigned UpdateClient transaction.
   **/
  public async buildUnsignedUpdateClientTx(clientId: string, header: Header, constructedAddress: string): Promise<Tx> {
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(clientId);
    // Find the UTXO for the client token
    const currentClientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    // Retrieve the current client datum from the UTXO
    const currentClientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(
      currentClientUtxo.datum!,
      'client',
    );
    const currentClientDatumState = currentClientDatum.state;
    // Create a SpendClientRedeemer using the provided header
    const spendClientRedeemer: SpendClientRedeemer = {
      UpdateClient: {
        header,
      },
    };
    const headerHeight = header.signedHeader.header.height;
    const newHeight: Height = {
      ...currentClientDatumState.clientState.latestHeight,
      revisionHeight: headerHeight,
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
    const currentConsStateInArray = Array.from(currentClientDatumState.consensusStates.entries());
    currentConsStateInArray.push([newHeight, newConsState]);
    currentConsStateInArray.sort(([height1], [height2]) => {
      if (height1.revisionNumber == height2.revisionNumber) {
        return Number(height1.revisionHeight - height2.revisionHeight);
      }
      return Number(height1.revisionNumber - height2.revisionNumber);
    });
    const newConsStates = new Map(currentConsStateInArray);
    const newClientDatum: ClientDatum = {
      ...currentClientDatum,
      state: {
        clientState: newClientState,
        consensusStates: newConsStates,
      },
    };

    const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    return this.lucidService.createUnsignedUpdateClientTransaction(
      currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedNewClientDatum,
      clientTokenUnit,
      constructedAddress,
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
  ): Promise<[Tx, bigint]> {
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
    return [
      this.lucidService.createUnsignedCreateClientTransaction(
        handlerUtxo,
        encodedHandlerOperator,
        clientAuthTokenUnit,
        encodedMintClientOperator,
        encodedUpdatedHandlerDatum,
        encodedClientDatum,
        constructedAddress,
      ),
      handlerDatum.state.next_client_sequence,
    ];
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
  // Convert client state operator to a structured ClientState object for submit on cardano
  private initializeClientState(clientStateMsg: ClientStateMsg): ClientState {
    // Helper function to convert numbers to BigInt
    const convertToBigInt = (value: any): bigint | null => value;

    const convertHeight = (height: any): { revisionNumber: bigint | null; revisionHeight: bigint | null } => ({
      revisionNumber: convertToBigInt(height?.revision_number),
      revisionHeight: convertToBigInt(height?.revision_height),
    });
    // Build the client state object
    const clientState: ClientState = {
      chainId: this.lucidService.toBytes(Buffer.from(clientStateMsg.chain_id)),
      trustLevel: {
        //TODO: remove hardcode 2n
        numerator: convertToBigInt(clientStateMsg.trust_level?.numerator),
        denominator: convertToBigInt(clientStateMsg.trust_level?.denominator),
      },
      trustingPeriod: convertToBigInt(clientStateMsg.trusting_period.seconds * 10n ** 9n),
      unbondingPeriod: convertToBigInt(clientStateMsg.unbonding_period.seconds * 10n ** 9n),
      maxClockDrift: convertToBigInt(clientStateMsg.max_clock_drift.seconds * 10n ** 9n),
      frozenHeight: convertHeight(clientStateMsg.frozen_height),
      latestHeight: convertHeight(clientStateMsg.latest_height),
      proofSpecs: this.convertToProofType(clientStateMsg.proof_specs),
    };
    const validationError = this.validateClientState(clientState);
    if (validationError) {
      throw validationError;
    }
    return clientState;
  }
  // Convert consensus state operator to a structured ConsensusState object to submit to cardano
  private initializeConsensusState(consensusStateMsg: ConsensusStateMsg): ConsensusState {
    const consensusState: ConsensusState = {
      // timestamp: BigInt(Date.now()) * 10n ** 6n,
      timestamp:
        BigInt(consensusStateMsg.timestamp.seconds) * BigInt(1e9) + BigInt(consensusStateMsg.timestamp.nanos || 0) ??
        null,
      next_validators_hash: this.lucidService.toBytes(consensusStateMsg.next_validators_hash),
      root: { hash: this.lucidService.toBytes(consensusStateMsg.root.hash) },
    };
    const validationError = this.validateConsensusState(consensusState);
    if (validationError) {
      throw validationError;
    }
    return consensusState;
  }
  // Convert Header operator to a structured Header object to submit to cardano

  private initializeHeader(headerMsg: HeaderMsg): Header {
    const toBytes = (value: Uint8Array | null | undefined) => (value ? this.lucidService.toBytes(value) : null);
    const header: Header = {
      signedHeader: {
        header: {
          chainId: toBytes(Buffer.from(headerMsg.signed_header.header.chain_id)),
          height: headerMsg.signed_header.header.height,
          time:
            BigInt(headerMsg.signed_header.header.time.seconds) * BigInt(1e9) +
            BigInt(headerMsg.signed_header.header.time.nanos),
          validatorsHash: toBytes(headerMsg.signed_header.header.validators_hash),
          nextValidatorsHash: toBytes(headerMsg.signed_header.header.next_validators_hash),
          appHash: toBytes(headerMsg.signed_header.header.app_hash),
        },
        commit: {
          height: headerMsg.signed_header.commit.height,
          round: BigInt(headerMsg.signed_header.commit.round),
          blockId: {
            hash: toBytes(headerMsg.signed_header.commit.block_id.hash),
            partSetHeader: {
              total: BigInt(headerMsg.signed_header.commit.block_id.part_set_header.total),
              hash: toBytes(headerMsg.signed_header.commit.block_id.part_set_header.hash),
            },
          },
          signatures: headerMsg.signed_header.commit.signatures.map((signature) => {
            return {
              block_id_flag: BigInt(signature.block_id_flag),
              validator_address: this.lucidService.toBytes(signature.validator_address),
              timestamp:
                BigInt(headerMsg.signed_header.header.time.seconds) * BigInt(1e9) +
                BigInt(headerMsg.signed_header.header.time.nanos),
              signature: this.lucidService.toBytes(signature.signature),
            };
          }),
        },
      },
      validatorSet: {
        validators: headerMsg.validator_set.validators.map((validator) => ({
          address: toBytes(validator.address),
          pubkey: toBytes(validator.pub_key.ed25519) || toBytes(validator.pub_key.secp256k1),
          votingPower: validator.voting_power,
          proposerPriority: validator.proposer_priority,
        })),
        proposer: {
          address: toBytes(headerMsg.validator_set.proposer.address),
          pubkey:
            toBytes(headerMsg.validator_set.proposer.pub_key.ed25519) ||
            toBytes(headerMsg.validator_set.proposer.pub_key.secp256k1),
          votingPower: headerMsg.validator_set.proposer.voting_power,
          proposerPriority: headerMsg.validator_set.proposer.proposer_priority,
        },
        totalVotingPower: headerMsg.validator_set.total_voting_power,
      },
      trustedHeight: {
        revisionHeight: headerMsg.trusted_height.revision_height,
        revisionNumber: headerMsg.trusted_height.revision_number,
      },
      trustedValidators: {
        validators: headerMsg.trusted_validators.validators.map((validator) => ({
          address: toBytes(validator.address),
          pubkey: toBytes(validator.pub_key.ed25519) || toBytes(validator.pub_key.secp256k1),
          votingPower: validator.voting_power,
          proposerPriority: validator.proposer_priority,
        })),
        proposer: {
          address: toBytes(headerMsg.trusted_validators.proposer.address),
          pubkey:
            toBytes(headerMsg.trusted_validators.proposer.pub_key.ed25519) ||
            toBytes(headerMsg.trusted_validators.proposer.pub_key.secp256k1),
          votingPower: headerMsg.trusted_validators.proposer.voting_power,
          proposerPriority: headerMsg.trusted_validators.proposer.proposer_priority,
        },
        totalVotingPower: headerMsg.trusted_validators.total_voting_power,
      },
    };
    return header;
  }

  // Validate the structure and values of the consensus state
  private validateConsensusState(consensusState: ConsensusState): GrpcInvalidArgumentException {
    if (consensusState.root?.hash?.length === 0) {
      return new GrpcInvalidArgumentException('root cannot be empty');
    }
    //tm hash size defined at: https://pkg.go.dev/github.com/cometbft/cometbft@v0.38.2/crypto/tmhash
    // const tmHashSize = 20;
    // if (consensusState.next_validators_hash?.length > 0 && consensusState.next_validators_hash?.length !== tmHashSize) {
    //   return new GrpcInvalidArgumentException(
    //     `Expected size to be ${tmHashSize} bytes, got ${consensusState.next_validators_hash.length} bytes`,
    //   );
    // }
    if (consensusState.timestamp <= 0) {
      return new GrpcInvalidArgumentException('timestamp must be a positive Unix time');
    }
    return null;
  }
  // Validate the structure and values of the client state
  private validateClientState(clientState: ClientState): GrpcInvalidArgumentException {
    if (clientState.chainId?.length === 0) {
      return new GrpcInvalidArgumentException('chain id cannot be empty string');
    }
    if (clientState.chainId?.length > 50) {
      return new GrpcInvalidArgumentException(`chainID is too long; got: ${clientState.chainId.length}, max: 50`);
    }
    // ValidateTrustLevel checks that trustLevel is within the allowed range [1/3,
    // 1]. If not, it returns an error. 1/3 is the minimum amount of trust needed
    // which does not break the security model.
    if (
      (clientState.trustLevel?.numerator !== null &&
        clientState.trustLevel?.denominator !== null &&
        BigInt(clientState.trustLevel?.numerator) * BigInt(3) < clientState.trustLevel?.denominator) || // < 1/3
      clientState.trustLevel?.numerator > clientState.trustLevel?.denominator || // > 1
      (clientState.trustLevel?.numerator !== null &&
        clientState.trustLevel?.numerator > clientState.trustLevel?.denominator) || // ? This condition seems incorrect. Did you mean denominator?
      clientState.trustLevel?.denominator === null ||
      clientState.trustLevel?.denominator === BigInt(0)
    ) {
      return new GrpcInvalidArgumentException('trustLevel must be within [1/3, 1]');
    }
    if (clientState.trustingPeriod <= 0) {
      return new GrpcInvalidArgumentException('trusting period must be greater than zero');
    }
    if (clientState.unbondingPeriod <= 0) {
      return new GrpcInvalidArgumentException('unbonding period must be greater than zero');
    }
    if (clientState.maxClockDrift <= 0) {
      return new GrpcInvalidArgumentException('max clock drift must be greater than zero');
    }
    // the latest height revision number must match the chain id revision number
    const chainIdParts = clientState.chainId?.split('-');
    const isValidRevisionNumber = clientState.latestHeight?.revisionNumber.toString() === chainIdParts[1];
    if (isValidRevisionNumber) {
      return new GrpcInvalidArgumentException('latest height revision number must match chain id revision number');
    }
    if (clientState.latestHeight?.revisionHeight == BigInt(0)) {
      return new GrpcInvalidArgumentException('tendermint clients latest height revision height cannot be zero');
    }
    if (clientState.trustingPeriod >= clientState.unbondingPeriod) {
      return new GrpcInvalidArgumentException(
        `trusting period ${clientState.trustingPeriod} should be < unbonding period ${clientState.unbondingPeriod}`,
      );
    }
    if (clientState.proofSpecs == null) {
      return new GrpcInvalidArgumentException('proof specs cannot be null for tm client');
    }
    if (clientState.proofSpecs === null || clientState.proofSpecs === undefined) {
      throw new GrpcInvalidArgumentException(`proof spec cannot be null`);
    }
    //
    // for (let i = 0; i < clientState.proofSpecs?.length; i++) {
    //   const spec = clientState.proofSpecs[i];
    //   if (spec === null) {
    //     throw new GrpcInvalidArgumentException(`proof spec cannot be null at index: ${i}`);
    //   }
    // }
    //
  }
  // private initializeProof(proofSpecs: ProofSpec) {}
  private convertToProofType(obj: any, isTopLevel: boolean = true): any {
    const uint8ArrayToString = (uint8Array: Uint8Array): string => this.lucidService.toBytes(uint8Array);

    if (obj === null || typeof obj !== 'object') {
      return typeof obj === 'number' ? BigInt(obj) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertToProofType(item, isTopLevel));
    }

    if (obj instanceof Uint8Array) {
      return uint8ArrayToString(obj);
    }

    const newObj = Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, this.convertToProofType(value, false)]),
    );

    if (isTopLevel) {
      newObj.prehash_key_before_comparison = false;
    }

    return newObj;
  }
}
