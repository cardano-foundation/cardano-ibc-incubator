import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '../../cosmjs-types/src/ibc/core/client/v1/tx';
import { type Tx, TxComplete } from 'lucid-cardano';

import { Inject, Injectable } from '@nestjs/common';
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
@Injectable()
export class TxService {
  constructor(@Inject(LucidService) private lucidService: LucidService) {}
  async createClient(data: MsgCreateClient): Promise<MsgCreateClientResponse> {
    const decodedClientStateMsg: ClientStateMsg = ClientStateMsg.decode(data.client_state.value);
    const decodedConsensusMsg: ConsensusStateMsg = ConsensusStateMsg.decode(data.consensus_state.value);
    const [unsignedCreateClientTx, clientId] = await this.createClientTx(decodedClientStateMsg, decodedConsensusMsg);
    try {
      const response: MsgCreateClientResponse = {
        unsigned_tx: {
          type_url: '/ibc.clients.cardano.v1.ClientState',
          value: unsignedCreateClientTx,
        },
        client_id: clientId.toString(),
      } as unknown as MsgCreateClientResponse;
      return response;
    } catch (error) {
      console.error(error);
      throw new GrpcInternalException(error);
    }
  }
  async updateClient(data: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    const clientId = data.client_id;
    const clientMessage = data.client_message;
    const headerMsg = HeaderMsg.decode(clientMessage.value);
    const header = this.initializeHeader(headerMsg);
    const unsignedUpdateClientTx: Tx = await this.lucidService.buildUnsignedUpdateClientTx(clientId, header);

    try {
      const unsignedCreateClientTxCompleted: TxComplete = await unsignedUpdateClientTx.complete();

      const response: MsgUpdateClientResponse = {
        unsigned_tx: {
          type_url: '/ibc.clients.cardano.v1.ClientState',
          value: unsignedCreateClientTxCompleted.txComplete.to_bytes(),
        },
        client_id: parseInt(clientId.toString()),
      } as unknown as MsgUpdateClientResponse;
      return response;
    } catch (error) {
      console.error(error);
      throw new GrpcInternalException(error);
    }
  }

  // Main function to create a client
  private async createClientTx(
    clientStateMsg: ClientStateMsg,
    consensusStateMsg: ConsensusStateMsg,
  ): Promise<[Uint8Array, bigint]> {
    // Convert input messages to client and consensus state
    const clientState: ClientState = this.initializeClientState(clientStateMsg);
    const consensusState: ConsensusState = this.initializeConsensusState(consensusStateMsg);
    // Build unsigned create client transaction
    const [unsignedCreateClientTx, clientId]: [Tx, bigint] = await this.lucidService.buildUnsignedCreateClientTx(
      clientState,
      consensusState,
    );

    const unSignedTxValidTo: Tx = unsignedCreateClientTx.validTo(
      Number(consensusState.timestamp / 10n ** 6n + 10n ** 6n),
    );
    const unsignedCreateClientTxCompleted: TxComplete = await unSignedTxValidTo.complete();
    const response: [Uint8Array, bigint] = [unsignedCreateClientTxCompleted.txComplete.to_bytes(), clientId];
    return response;
  }

  // Convert client state message to a structured ClientState object
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
  // Convert consensus state message to a structured ConsensusState object
  private initializeConsensusState(consensusStateMsg: ConsensusStateMsg): ConsensusState {
    const consensusState: ConsensusState = {
      // timestamp: BigInt(Date.now()) * 10n ** 6n,
      timestamp: BigInt(consensusStateMsg.timestamp.seconds) * BigInt(1e9) ?? null,
      next_validators_hash: this.lucidService.toBytes(consensusStateMsg.next_validators_hash),
      root: { hash: this.lucidService.toBytes(consensusStateMsg.root.hash) },
    };
    const validationError = this.validateConsensusState(consensusState);
    if (validationError) {
      throw validationError;
    }
    return consensusState;
  }

  private initializeHeader(headerMsg: HeaderMsg): Header {
    const toBytes = (value: Uint8Array | null | undefined) => (value ? this.lucidService.toBytes(value) : null);
    const header: Header = {
      signedHeader: {
        header: {
          chainId: toBytes(Buffer.from(headerMsg.signed_header.header.chain_id)),
          height: headerMsg.signed_header.header.height,
          time: BigInt(fromTimestamp(headerMsg.signed_header.header.time).getTime() * 10 ** 6),
          validatorsHash: toBytes(headerMsg.signed_header.header.validators_hash),
          nextValidatorsHash: toBytes(headerMsg.signed_header.header.next_validators_hash),
          appHash: toBytes(headerMsg.signed_header.header.app_hash),
        },
        commit: {
          height: headerMsg.signed_header.commit.height,
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
              timestamp: BigInt(fromTimestamp(headerMsg.signed_header.header.time).getTime() * 10 ** 6),
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
