import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/tx';
import { TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConsensusState } from '../shared/types/consensus-state';
import { ClientState } from '../shared/types/client-state-types';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
import { decodeHeader, initializeHeader } from '../shared/types/header';
import { RpcException } from '@nestjs/microservices';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { ConfigService } from '@nestjs/config';
import { ClientDatumState } from 'src/shared/types/client-datum-state';
import { CLIENT_ID_PREFIX, CLIENT_PREFIX, HANDLER_TOKEN_NAME, MAX_CONSENSUS_STATE_SIZE } from 'src/constant';
import { ClientDatum, encodeClientStateValue, encodeConsensusStateValue } from 'src/shared/types/client-datum';
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
import { UpdateOnMisbehaviourOperatorDto, UpdateClientOperatorDto } from './dto';
import { validateAndFormatCreateClientParams, validateAndFormatUpdateClientParams } from './helper/client.validate';
import { TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import { 
  computeRootWithClientUpdate as computeRootWithClientUpdateHelper,
  computeRootWithCreateClientUpdate,
  computeRootWithUpdateClientUpdate,
  alignTreeWithChain,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';
import { TxEventsService } from './tx-events.service';
import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
  ) {}

  /**
   * Computes the new IBC state root after client update
   * 
   * IMPORTANT: This is now side-effect free. The result contains a commit()
   * function that should be called after tx confirmation, but for simplicity
   * we just return the newRoot and let the next operation rebuild from chain.
   * 
   * @param oldRoot - Current IBC state root
   * @param clientId - Client identifier (e.g., "07-tendermint-0")
   * @param clientState - The client state to store
   * @param consensusState - Optional consensus state (required for CreateClient)
   * @param consensusHeight - Height key for the consensus state
   * @returns The new IBC state root (64-character hex string)
   */
  private computeRootWithClientUpdate(
    oldRoot: string, 
    clientId: string, 
    clientState: any,
    consensusState?: any,
    consensusHeight?: string | number | bigint,
  ): string {
    const result = computeRootWithClientUpdateHelper(oldRoot, clientId, clientState, consensusState, consensusHeight);
    // Note: Not calling result.commit() - the tree will be rebuilt from chain on next operation
    // This is safer because it handles failed transactions automatically
    return result.newRoot;
  }
  
  /**
   * Ensure the in-memory Merkle tree is aligned with on-chain state
   * Call this before building transactions if the tree may be stale
   */
  private async ensureTreeAligned(onChainRoot: string): Promise<void> {
    if (!isTreeAligned(onChainRoot)) {
      this.logger.warn(`Tree is out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding...`);
      await alignTreeWithChain();
    }
  }
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
      const { unsignedTx: unsignedCreateClientTx, clientId, pendingTreeUpdate } = await this.buildUnsignedCreateClientTx(
        clientState,
        consensusState,
        constructedAddress,
      );

      // Use absolute POSIX timestamps (milliseconds since Unix epoch)
      // Lucid will convert these to slots relative to the devnet's systemStart
      const now = Date.now(); // Current time in milliseconds

      const validFromTimestamp = now - 60000; // 1 minute ago (for clock skew tolerance)
      // Keep validity bounds within Cardano's "safe zone" for devnet era summaries
      // (otherwise Ogmios evaluateTransaction may fail with PastHorizon).
      const validToTimestamp = now + TRANSACTION_TIME_TO_LIVE;

      this.logger.log(`[DEBUG] Setting validity: validFrom=${new Date(validFromTimestamp).toISOString()}, validTo=${new Date(validToTimestamp).toISOString()}`);

      const unSignedTxValidTo: TxBuilder = unsignedCreateClientTx
        .validFrom(validFromTimestamp)
        .validTo(validToTimestamp);
      
      // Return unsigned transaction for Hermes to sign
      // Hermes will use its CardanoSigner (CIP-1852 + Ed25519) to sign this CBOR
      const completedUnsignedTx = await unSignedTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const unsignedTxHash = completedUnsignedTx.toHash();

      // Register the pending in-memory tree update keyed by the finalized tx body hash.
      // We can only compute a stable hash after `.complete()` (fees/inputs are finalized there).
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);
      
      // Return the CBOR hex string as bytes for Hermes to parse
      // unsignedTxCbor is a hex string from Lucid's toCBOR()
      // Hermes expects to receive this as a UTF-8 string (hex characters as bytes)
      // So we encode the string itself as a Uint8Array of its character codes
      const hexStringBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      
      const createdClientId = `${CLIENT_ID_PREFIX}-${clientId.toString()}`;

      // Track expected IBC events for Hermes (keyed by tx hash, stable across signing).
      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'create_client',
          attributes: [
            { key: 'client_id', value: createdClientId },
            { key: 'client_type', value: '07-tendermint' },
            {
              key: 'consensus_height',
              value: `${clientState.latestHeight.revisionNumber.toString()}-${clientState.latestHeight.revisionHeight.toString()}`,
            },
          ],
        },
      ]);

      this.logger.log(`Returning unsigned tx for client creation (client_id: ${createdClientId})`);
      this.logger.log(`CBOR hex string length: ${unsignedTxCbor.length}, first 40 chars: ${unsignedTxCbor.substring(0, 40)}`);
      
      const response: MsgCreateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: hexStringBytes,
        },
        client_id: createdClientId,
      } as unknown as MsgCreateClientResponse;
      return response;
    } catch (error) {
      this.logger.error(`createClient: ${error}`);
      // Log full error object to capture Ogmios evaluateTransaction details
      this.logger.error(`createClient FULL ERROR: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`);
      if (error?.cause) {
        this.logger.error(`createClient ERROR CAUSE: ${JSON.stringify(error.cause, Object.getOwnPropertyNames(error.cause), 2)}`);
      }
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
        const nowMs = Date.now();
        const maxClockDriftMs = currentClientDatum.state.clientState.maxClockDrift / 1_000_000n;
        const maxBackdateMarginMs = 1_000n;
        const maxBackdateCapMs = 60_000n;
        const maxAllowedBackdateMs =
          maxClockDriftMs > maxBackdateMarginMs ? (maxClockDriftMs - maxBackdateMarginMs) : 0n;
        const safeBackdateMs = Number(
          maxAllowedBackdateMs < maxBackdateCapMs ? maxAllowedBackdateMs : maxBackdateCapMs,
        );
        const validFromTimeMs = nowMs - safeBackdateMs;
        const validToTime = nowMs + TRANSACTION_TIME_TO_LIVE;
        const unSignedTxValidTo: TxBuilder = unsignedUpdateClientTx
          .validFrom(validFromTimeMs)
          .validTo(validToTime);
        
        // Return unsigned transaction for Hermes to sign
        const completedUnsignedTx = await unSignedTxValidTo.complete({ localUPLCEval: false });
        const unsignedTxCbor = completedUnsignedTx.toCBOR();
        const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

        this.logger.log(`Returning unsigned tx for update client on misbehaviour (client_id: ${clientId})`);
        
        const response: MsgUpdateClientResponse = {
          unsigned_tx: {
            type_url: '',
            value: cborHexBytes,
          },
          client_id: parseInt(clientId.toString()),
        } as unknown as MsgUpdateClientResponse;
        return response;
      }
      const headerMsg = decodeHeader(data.client_message.value);
      const header = initializeHeader(headerMsg);
      const nowMs = Date.now();
      // NOTE: UpdateClient header verification uses the transaction validity lower bound
      // (`valid_from`) as a proxy for "current time" in the Tendermint light client.
      //
      // In particular, `verifier.verify_new_header_and_vals` checks:
      //   header.time < (tx_valid_from + max_clock_drift)
      //
      // If we backdate `valid_from` too far (e.g., 60s) while `max_clock_drift` is smaller
      // (e.g., 30s), then otherwise-valid headers will be rejected as "in the future".
      //
      // So for UpdateClient we backdate by an amount that:
      // - stays strictly within `max_clock_drift` (so the header is not "in the future"), and
      // - is large enough to tolerate node/host clock skew and ledger catch-up lag
      //   (so the node doesn't reject the tx as "submitted too early").
      const maxClockDriftMs = currentClientDatum.state.clientState.maxClockDrift / 1_000_000n;
      // Leave a small margin so the header can be up to ~1s ahead of `valid_from + max_clock_drift`
      // due to normal cross-chain time skew.
      const maxBackdateMarginMs = 1_000n;
      const maxBackdateCapMs = 60_000n;
      const maxAllowedBackdateMs =
        maxClockDriftMs > maxBackdateMarginMs ? (maxClockDriftMs - maxBackdateMarginMs) : 0n;
      const safeBackdateMs = Number(
        maxAllowedBackdateMs < maxBackdateCapMs ? maxAllowedBackdateMs : maxBackdateCapMs,
      );
      const validFromTimeMs = nowMs - safeBackdateMs;
      const validToTimeMs = nowMs + TRANSACTION_TIME_TO_LIVE;
      const txValidFromNs = BigInt(validFromTimeMs) * 1_000_000n;
      const updateClientHeaderOperator: UpdateClientOperatorDto = {
        clientId,
        header,
        constructedAddress,
        clientDatum: currentClientDatum,
        clientTokenUnit,
        currentClientUtxo,
        txValidFrom: txValidFromNs,
      };

      const unsignedUpdateClientTx: TxBuilder = await this.buildUnsignedUpdateClientTx(updateClientHeaderOperator);
      const unSignedTxValidTo: TxBuilder = unsignedUpdateClientTx.validFrom(validFromTimeMs).validTo(validToTimeMs);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unSignedTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      
      this.logger.log(`Returning unsigned tx for update client (client_id: ${clientId})`);

      const response: MsgUpdateClientResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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

    // Root correctness enforcement (HostState update)
    //
    // UpdateClient must update `ibc_state_root` so that proofs about the client state
    // remain verifiable by a counterparty. Without this, an operator could update the
    // on-chain client datum while leaving the root unchanged.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    // The IBC client identifier used in the commitment tree matches the on-chain convention.
    const ibcClientId = `07-tendermint-${updateOnMisbehaviourOperator.clientId}`;

    // Determine consensus-state removals/insertions by diffing input vs output.
    // We compare by full (revisionNumber, revisionHeight) equality to match on-chain `pairs.has_key`.
    const outputFullKeys = new Set(
      Array.from(newClientDatum.state.consensusStates.keys()).map(
        (h) => `${h.revisionNumber.toString()}-${h.revisionHeight.toString()}`,
      ),
    );

    const removedConsensusHeights: string[] = [];
    for (const [height] of currentClientDatumState.consensusStates.entries()) {
      const fullKey = `${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`;
      if (!outputFullKeys.has(fullKey)) {
        removedConsensusHeights.push(height.revisionHeight.toString());
      }
    }

    // Misbehaviour updates do not add a new consensus state.
    const addedConsensusState = undefined;

    const newClientStateValue = Buffer.from(
      await encodeClientStateValue(newClientState, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, clientStateSiblings, consensusStateSiblings, removedConsensusStateSiblings } =
      computeRootWithUpdateClientUpdate(
        hostStateDatum.state.ibc_state_root,
        ibcClientId,
        newClientStateValue,
        removedConsensusHeights,
        addedConsensusState,
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
      UpdateClient: {
        client_state_siblings: clientStateSiblings,
        consensus_state_siblings: consensusStateSiblings,
        removed_consensus_state_siblings: removedConsensusStateSiblings,
      },
    };

    const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    return this.lucidService.createUnsignedUpdateClientTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      updateOnMisbehaviourOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedUpdatedHostStateDatum,
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

    // Root correctness enforcement (HostState update)
    //
    // This transaction changes client state and (usually) adds a new consensus state while
    // pruning older ones. The HostState root must commit to those changes, otherwise a
    // counterparty cannot verify proofs about the updated client.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    const ibcClientId = `07-tendermint-${updateClientOperator.clientId}`;

    const inputFullKeys = new Set(
      Array.from(currentClientDatumState.consensusStates.keys()).map(
        (h) => `${h.revisionNumber.toString()}-${h.revisionHeight.toString()}`,
      ),
    );
    const outputFullKeys = new Set(
      Array.from(newClientDatum.state.consensusStates.keys()).map(
        (h) => `${h.revisionNumber.toString()}-${h.revisionHeight.toString()}`,
      ),
    );

    const removedConsensusHeights: string[] = [];
    for (const [height] of currentClientDatumState.consensusStates.entries()) {
      const fullKey = `${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`;
      if (!outputFullKeys.has(fullKey)) {
        removedConsensusHeights.push(height.revisionHeight.toString());
      }
    }

    let addedConsensusState:
      | {
          height: string;
          value: Buffer;
        }
      | undefined = undefined;
    for (const [height, consensusState] of newClientDatum.state.consensusStates.entries()) {
      const fullKey = `${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`;
      if (!inputFullKeys.has(fullKey)) {
        if (addedConsensusState) {
          throw new GrpcInternalException('UpdateClient should add at most one consensus state');
        }
        addedConsensusState = {
          height: height.revisionHeight.toString(),
          value: Buffer.from(
            await encodeConsensusStateValue(consensusState, this.lucidService.LucidImporter),
            'hex',
          ),
        };
      }
    }

    const newClientStateValue = Buffer.from(
      await encodeClientStateValue(newClientState, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, clientStateSiblings, consensusStateSiblings, removedConsensusStateSiblings } =
      computeRootWithUpdateClientUpdate(
        hostStateDatum.state.ibc_state_root,
        ibcClientId,
        newClientStateValue,
        removedConsensusHeights,
        addedConsensusState,
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
      UpdateClient: {
        client_state_siblings: clientStateSiblings,
        consensus_state_siblings: consensusStateSiblings,
        removed_consensus_state_siblings: removedConsensusStateSiblings,
      },
    };

    const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    return this.lucidService.createUnsignedUpdateClientTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      updateClientOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedUpdatedHostStateDatum,
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
  ): Promise<{ unsignedTx: TxBuilder; clientId: bigint; pendingTreeUpdate: PendingTreeUpdate }> {
    // STT Architecture: Query the HostState UTXO via its unique NFT
    // the NFT serves as a linear threading token -
    // the UTXO set can only contain exactly one unspent output with this NFT at any given slot,
    // which eliminates race conditions and indexing ambiguities that would otherwise require
    // sophisticated conflict resolution when multiple Handler UTXOs could theoretically coexist.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    
    this.logger.log(`[DEBUG] HostState UTXO: ${hostStateUtxo.txHash}#${hostStateUtxo.outputIndex}`);
    this.logger.log(`[DEBUG] HostState UTXO address: ${hostStateUtxo.address}`);
    this.logger.log(`[DEBUG] HostState UTXO datum (FULL CBOR): ${hostStateUtxo.datum || 'MISSING!'}`);
    this.logger.log(`[DEBUG] HostState UTXO datumHash: ${hostStateUtxo.datumHash || 'NONE (inline)'}`);
    
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException(`HostState UTXO has no inline datum! This indicates a deployment issue.`);
    }
    
    // Decode the HostState datum from the UTXO
    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    
    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing new root
    // This prevents stale tree state from causing root mismatches after failed transactions
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
    
    this.logger.log(`[DEBUG] Decoded HostState datum - version: ${hostStateDatum.state.version}, nft_policy: ${hostStateDatum.nft_policy.substring(0, 20)}...`);
    
    this.logger.log(`[DEBUG] HostState datum version: ${hostStateDatum.state.version}`);
    this.logger.log(`[DEBUG] HostState next_client_sequence: ${hostStateDatum.state.next_client_sequence}`);
    this.logger.log(`[DEBUG] HostState ibc_state_root: ${hostStateDatum.state.ibc_state_root.slice(0, 20)}...`);
    
    // Compute new IBC state root with client update
    // When creating a client, we need to add BOTH the clientState AND the initial consensusState
    // to the Merkle tree. The consensus state is keyed by the client's latest height.
    // This is essential for proof generation - without the consensus state in the tree,
    // queries for proofs will fail with "key not found".
    const clientId = `07-tendermint-${hostStateDatum.state.next_client_sequence}`;
    const consensusHeight = clientState.latestHeight.revisionHeight;

    // Encode the exact bytes that the on-chain validator commits to the root.
    // These bytes must match Aiken's `cbor.serialise(...)` output.
    const clientStateValue = Buffer.from(
      await encodeClientStateValue(clientState, this.lucidService.LucidImporter),
      'hex',
    );
    const consensusStateValue = Buffer.from(
      await encodeConsensusStateValue(consensusState, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, clientStateSiblings, consensusStateSiblings, commit } =
      computeRootWithCreateClientUpdate(
        hostStateDatum.state.ibc_state_root,
        clientId,
        clientStateValue,
        consensusStateValue,
        consensusHeight,
      );
    
    // Create an updated HostState datum with:
    // - Incremented version (STT monotonicity requirement)
    // - Incremented client sequence
    // - Updated ibc_state_root
    // - Current timestamp
    const updatedHostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        next_client_sequence: hostStateDatum.state.next_client_sequence + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const mintClientScriptHash = this.configService.get('deployment').validators.mintClientStt.scriptHash;

    const clientDatumState: ClientDatumState = {
      clientState: clientState,
      consensusStates: new Map([[clientState.latestHeight, consensusState]]),
    };

    const clientTokenName = this.generateClientTokenName(hostStateDatum);

    const clientDatum: ClientDatum = {
      state: clientDatumState,
      token: {
        policyId: mintClientScriptHash,
        name: clientTokenName,
      },
    };
    // STT architecture: MintClientRedeemer is just the handler auth token
    const handlerToken = this.configService.get('deployment').handlerAuthToken;
    const mintClientRedeemer = {
      handler_auth_token: {
        policy_id: handlerToken.policyId,
        name: handlerToken.name,
      },
    };
    const clientAuthTokenUnit = mintClientScriptHash + clientTokenName;
    
    // STT redeemer: Explicitly specify the operation type
    // The reason I'm doing it this way is because the validator needs type-specific invariants -
    // CreateClient requires incrementing next_client_sequence while preserving connection/channel
    // sequences, whereas other operations have different field constraints. The redeemer acts as
    // a dispatch mechanism so the validator can branch to operation-specific validation logic.
    const hostStateRedeemer = {
      CreateClient: {
        client_state_siblings: clientStateSiblings,
        consensus_state_siblings: consensusStateSiblings,
      },
    };
    
    // Encode all data for the transaction
    const encodedMintClientRedeemer: string = await this.lucidService.encode(mintClientRedeemer, 'mintClientRedeemer');
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(
      updatedHostStateDatum,
      'host_state',
    );
    const encodedClientDatum = await this.lucidService.encode<ClientDatum>(clientDatum, 'client');
    
    this.logger.log(`[DEBUG] ==================== TRANSACTION CBOR VALUES ====================`);
    this.logger.log(`[DEBUG] Client token name: ${clientTokenName}`);
    this.logger.log(`[DEBUG] Client auth token unit: ${clientAuthTokenUnit}`);
    this.logger.log(`[DEBUG] Encoded mint client redeemer (CBOR): ${encodedMintClientRedeemer}`);
    this.logger.log(`[DEBUG] Encoded host state redeemer (CBOR): ${encodedHostStateRedeemer}`);
    this.logger.log(`[DEBUG] Encoded updated HostState datum (CBOR - FULL): ${encodedUpdatedHostStateDatum}`);
    this.logger.log(`[DEBUG] Encoded client datum (CBOR - first 200 chars): ${encodedClientDatum.substring(0, 200)}...`);
    this.logger.log(`[DEBUG] Updated HostState datum next_client_sequence: ${updatedHostStateDatum.state.next_client_sequence}`);
    this.logger.log(`[DEBUG] ==================================================================`);
    
    // Create and return the unsigned transaction for creating new client
    // This will spend the old HostState UTXO and create a new one with the same NFT
    const unsignedTx = this.lucidService.createUnsignedCreateClientTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      clientAuthTokenUnit,
      encodedMintClientRedeemer,
      encodedUpdatedHostStateDatum,
      encodedClientDatum,
      constructedAddress,
    );

    return {
      unsignedTx,
      clientId: hostStateDatum.state.next_client_sequence,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
  }
  
  private generateClientTokenName(hostStateDatum: any): string {
    // Generate client token name from HostState NFT policy
    const hostStateNFT = this.configService.get('deployment').hostStateNFT;
    return this.lucidService.generateTokenName(
      hostStateNFT,
      CLIENT_PREFIX,
      hostStateDatum.state.next_client_sequence,
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
