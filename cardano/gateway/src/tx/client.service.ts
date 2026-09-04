import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgRecoverClient,
  MsgRecoverClientResponse,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';
import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConsensusState } from '../shared/types/consensus-state';
import { ClientState } from '../shared/types/client-state-types';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import {
  GrpcFailedPreconditionException,
  GrpcInternalException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';
import { decodeHeader, initializeHeader } from '../shared/types/header';
import { RpcException } from '@nestjs/microservices';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { ConfigService } from '@nestjs/config';
import { ClientDatumState } from 'src/shared/types/client-datum-state';
import {
  ATTRIBUTE_KEY_CLIENT,
  CLIENT_ID_PREFIX,
  CLIENT_PREFIX,
  EVENT_TYPE_CLIENT,
  MAX_CONSENSUS_STATE_SIZE,
} from 'src/constant';
import { ClientDatum, encodeClientStateValue, encodeConsensusStateValue } from 'src/shared/types/client-datum';
import { SpendClientRedeemer } from 'src/shared/types/client-redeemer';
import { Height } from 'src/shared/types/height';
import { isExpired } from '@shared/helpers/client-state';
import {
  ClientMessage,
  getClientMessageFromTendermint,
  verifyClientMessage,
} from '../shared/types/msgs/client-message';
import { checkForMisbehaviour, TENDERMINT_MISBEHAVIOUR_TYPE_URL } from '@shared/types/misbehaviour/misbehaviour';
import { RecoverClientOperatorDto, UpdateOnMisbehaviourOperatorDto, UpdateClientOperatorDto } from './dto';
import {
  validateAndFormatCreateClientParams,
  validateAndFormatRecoverClientParams,
  validateAndFormatUpdateClientParams,
  validateUpdateHeaderAdvancesLatestHeight,
} from './helper/client.validate';
import { sumLovelaceFromUtxos } from './helper/helper';
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  computeRootWithCreateClientUpdate,
  computeRootWithUpdateClientUpdate,
  alignTreeWithChain,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';
import { PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
import { TxOperationRunnerService } from './tx-operation-runner.service';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';
import { toHex } from '../shared/helpers/hex';
import type { GatewayEvent } from './tx-events.service';
import { getHeightMapValue, getProcessedHeight } from '../shared/helpers/verify';
import { isDeepStrictEqual } from 'node:util';

@Injectable()
export class ClientService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
  ) {}

  private async refreshWalletContext(address: string, context: string): Promise<void> {
    const walletUtxos = await this.lucidService.tryFindUtxosAt(address, {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });
    if (walletUtxos.length === 0) {
      throw new GrpcInternalException(`${context} failed: no spendable UTxOs found for ${address}`);
    }
    this.lucidService.selectWalletFromAddress(address, walletUtxos);
    this.logger.log(
      `[walletContext] ${context} selecting wallet from ${address}, utxos=${walletUtxos.length}, lovelace_total=${sumLovelaceFromUtxos(walletUtxos)}`,
    );
  }

  private buildUpdateClientSyntheticEvent(
    eventType: string,
    clientId: bigint | number | string,
    consensusHeight: Height,
    clientMessage: Any,
  ): GatewayEvent {
    const clientMessageAnyHex = toHex(Any.encode(clientMessage).finish());
    const fullClientId = `${CLIENT_ID_PREFIX}-${clientId.toString()}`;

    // Hermes replays the canonical client_message Any from this event.
    return {
      type: eventType,
      attributes: [
        { key: ATTRIBUTE_KEY_CLIENT.CLIENT_ID, value: fullClientId },
        { key: ATTRIBUTE_KEY_CLIENT.CLIENT_TYPE, value: CLIENT_ID_PREFIX },
        {
          key: ATTRIBUTE_KEY_CLIENT.CONSENSUS_HEIGHT,
          value: `${consensusHeight.revisionNumber.toString()}-${consensusHeight.revisionHeight.toString()}`,
        },
        {
          key: ATTRIBUTE_KEY_CLIENT.CLIENT_MESSAGE_ANY_HEX,
          value: clientMessageAnyHex,
        },
        {
          key: ATTRIBUTE_KEY_CLIENT.HEADER,
          value: eventType === EVENT_TYPE_CLIENT.UPDATE_CLIENT ? clientMessageAnyHex : '',
        },
      ],
    };
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

  private async computeTxValidityWindow(backdateMs = 0): Promise<{
    currentSlot: number;
    currentLedgerTime: number;
    validFromTime: number;
    validToSlot: number;
    validToTime: number;
  }> {
    const ogmiosEndpoint = this.configService.getOrThrow<string>('ogmiosEndpoint');
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`client tx failed: invalid slot configuration for network ${network}`);
    }

    return computeLedgerAnchoredValidityWindow(ogmiosEndpoint, slotConfig, TRANSACTION_TIME_TO_LIVE, {
      backdateMs,
    });
  }

  private isZeroHeight(height: Height): boolean {
    return height.revisionNumber === 0n && height.revisionHeight === 0n;
  }

  private isHeightGreater(left: Height, right: Height): boolean {
    return (
      left.revisionNumber > right.revisionNumber ||
      (left.revisionNumber === right.revisionNumber && left.revisionHeight > right.revisionHeight)
    );
  }

  private isSameHeight(left: Height, right: Height): boolean {
    return left.revisionNumber === right.revisionNumber && left.revisionHeight === right.revisionHeight;
  }

  private recoveryParametersMatch(subject: ClientState, substitute: ClientState): boolean {
    return (
      subject.chainId === substitute.chainId &&
      subject.trustLevel.numerator === substitute.trustLevel.numerator &&
      subject.trustLevel.denominator === substitute.trustLevel.denominator &&
      subject.trustingPeriod === substitute.trustingPeriod &&
      subject.unbondingPeriod === substitute.unbondingPeriod &&
      subject.maxClockDrift === substitute.maxClockDrift &&
      isDeepStrictEqual(subject.proofSpecs, substitute.proofSpecs)
    );
  }

  private validateRecoveryState(
    subjectDatum: ClientDatum,
    substituteDatum: ClientDatum,
    validToNs: bigint,
  ): { height: Height; consensusState: ConsensusState; processedTime: bigint; processedHeight: bigint } {
    const subjectState = subjectDatum.state.clientState;
    const substituteState = substituteDatum.state.clientState;
    const subjectLatestConsensus = getHeightMapValue(subjectDatum.state.consensusStates, subjectState.latestHeight);
    const subjectIsActive =
      this.isZeroHeight(subjectState.frozenHeight) &&
      subjectLatestConsensus !== undefined &&
      subjectLatestConsensus.timestamp + subjectState.trustingPeriod > validToNs;
    if (subjectIsActive) {
      throw new GrpcFailedPreconditionException('Subject client must be frozen or expired');
    }

    if (!this.isZeroHeight(substituteState.frozenHeight)) {
      throw new GrpcFailedPreconditionException('Substitute client must be active');
    }
    const substituteConsensus = getHeightMapValue(substituteDatum.state.consensusStates, substituteState.latestHeight);
    if (!substituteConsensus || substituteConsensus.timestamp + substituteState.trustingPeriod <= validToNs) {
      throw new GrpcFailedPreconditionException('Substitute client must be active');
    }
    if (!this.isHeightGreater(substituteState.latestHeight, subjectState.latestHeight)) {
      throw new GrpcFailedPreconditionException('Substitute client must be newer than the subject client');
    }
    if (!this.recoveryParametersMatch(subjectState, substituteState)) {
      throw new GrpcFailedPreconditionException('Subject and substitute client parameters do not match');
    }
    if (subjectDatum.state.consensusStates.size > MAX_CONSENSUS_STATE_SIZE) {
      throw new GrpcFailedPreconditionException('Subject client consensus-state history exceeds the configured limit');
    }
    const consensusKeys = Array.from(subjectDatum.state.consensusStates.keys());
    const processedTimeKeys = Array.from(subjectDatum.state.processedTimes.keys());
    const processedHeightKeys = Array.from(subjectDatum.state.processedHeights.keys());
    const keysMatch = (candidate: Height[]) =>
      candidate.length === consensusKeys.length &&
      candidate.every((height, index) => this.isSameHeight(height, consensusKeys[index]));
    if (!keysMatch(processedTimeKeys) || !keysMatch(processedHeightKeys)) {
      throw new GrpcFailedPreconditionException(
        'Subject client consensus-state history and processed metadata keys do not match',
      );
    }

    const processedTime = getHeightMapValue(substituteDatum.state.processedTimes, substituteState.latestHeight);
    const processedHeight = getHeightMapValue(substituteDatum.state.processedHeights, substituteState.latestHeight);
    if (processedTime === undefined || processedHeight === undefined) {
      throw new GrpcFailedPreconditionException('Substitute client is missing processed metadata at its latest height');
    }

    return {
      height: substituteState.latestHeight,
      consensusState: substituteConsensus,
      processedTime,
      processedHeight,
    };
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
      await this.refreshWalletContext(constructedAddress, 'createClientBuilder');
      const { validFromTime: validFromTimestamp, validToTime: validToTimestamp } =
        await this.computeTxValidityWindow(60_000);
      const txValidFromNs = BigInt(validFromTimestamp) * 1_000_000n;
      // Build unsigned create client transaction
      const { unsignedTx: unsignedCreateClientTx, clientId, pendingTreeUpdate } = await this.buildUnsignedCreateClientTx(
        clientState,
        consensusState,
        constructedAddress,
        txValidFromNs,
      );

      this.logger.log(`[DEBUG] Setting validity: validFrom=${new Date(validFromTimestamp).toISOString()}, validTo=${new Date(validToTimestamp).toISOString()}`);

      const createdClientId = `${CLIENT_ID_PREFIX}-${clientId.toString()}`;
      const { unsignedTxCbor, unsignedTxBytes: hexStringBytes } = await this.txOperationRunnerService.run({
        operationName: 'createClient',
        unsignedTx: unsignedCreateClientTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTimestamp).validTo(validToTimestamp),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'createClient',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
        syntheticEvents: [
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
        ],
      });

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
      const { clientId, constructedAddress, clientMessage } = validateAndFormatUpdateClientParams(data);

      // Get the token unit associated with the client
      const clientTokenUnit = this.lucidService.getClientTokenUnit(clientId);
      // Find the UTXO for the client token
      const currentClientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
      // Retrieve the current client datum from the UTXO
      const currentClientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(
        currentClientUtxo.datum!,
        'client',
      );

      if (!verifyClientMessage(clientMessage, currentClientDatum)) {
        throw new GrpcInvalidArgumentException('Invalid client message');
      }

      const foundMisbehaviour = checkForMisbehaviour(clientMessage, currentClientDatum);

      if (foundMisbehaviour) {
        await this.refreshWalletContext(constructedAddress, 'updateClientOnMisbehaviourBuilder');
        // Build and complete the unsigned transaction
        const updateOnMisbehaviourOperator: UpdateOnMisbehaviourOperatorDto = {
          clientId,
          clientMessage,
          constructedAddress,
          clientDatum: currentClientDatum,
          clientTokenUnit,
          currentClientUtxo,
        };

        const { unsignedTx: unsignedUpdateClientTx, pendingTreeUpdate } =
          await this.buildUnsignedUpdateOnMisbehaviour(updateOnMisbehaviourOperator);
        const maxClockDriftMs = currentClientDatum.state.clientState.maxClockDrift / 1_000_000n;
        const maxBackdateMarginMs = 1_000n;
        const maxBackdateCapMs = 60_000n;
        const maxAllowedBackdateMs =
          maxClockDriftMs > maxBackdateMarginMs ? (maxClockDriftMs - maxBackdateMarginMs) : 0n;
        const safeBackdateMs = Number(
          maxAllowedBackdateMs < maxBackdateCapMs ? maxAllowedBackdateMs : maxBackdateCapMs,
        );
        const { validFromTime: validFromTimeMs, validToTime } = await this.computeTxValidityWindow(safeBackdateMs);
        const frozenHeight = {
          revisionNumber: 0n,
          revisionHeight: 1n,
        } as Height;
        const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
          operationName: 'updateClientOnMisbehaviour',
          unsignedTx: unsignedUpdateClientTx,
          validity: {
            apply: (builder: TxBuilder) => builder.validFrom(validFromTimeMs).validTo(validToTime),
          },
          wallet: {
            mode: 'refresh_from_address',
            address: constructedAddress,
            context: 'updateClientOnMisbehaviour',
          },
          completeOptions: {
            localUPLCEval: false,
            setCollateral: TRANSACTION_SET_COLLATERAL,
          },
          pendingTreeUpdate,
          syntheticEvents: [
            this.buildUpdateClientSyntheticEvent(
              EVENT_TYPE_CLIENT.CLIENT_MISBEHAVIOR,
              clientId,
              frozenHeight,
              clientMessage,
            ),
          ],
        });

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
      if (clientMessage.type_url === TENDERMINT_MISBEHAVIOUR_TYPE_URL) {
        throw new GrpcInvalidArgumentException('submitted Tendermint misbehaviour does not prove a conflict');
      }
      const headerMsg = decodeHeader(clientMessage.value);
      const header = initializeHeader(headerMsg);
      const updateConsensusHeight = {
        revisionNumber: header.trustedHeight.revisionNumber,
        revisionHeight: header.signedHeader.header.height,
      } as Height;
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
      const { validFromTime: validFromTimeMs, validToTime: validToTimeMs } =
        await this.computeTxValidityWindow(safeBackdateMs);
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

      await this.refreshWalletContext(constructedAddress, 'updateClientBuilder');
      const { unsignedTx: unsignedUpdateClientTx, pendingTreeUpdate } =
        await this.buildUnsignedUpdateClientTx(updateClientHeaderOperator);
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'updateClient',
        unsignedTx: unsignedUpdateClientTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTimeMs).validTo(validToTimeMs),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'updateClient',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
        syntheticEvents: [
          this.buildUpdateClientSyntheticEvent(
            EVENT_TYPE_CLIENT.UPDATE_CLIENT,
            clientId,
            updateConsensusHeight,
            clientMessage,
          ),
        ],
      });

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

  async recoverClient(data: MsgRecoverClient): Promise<MsgRecoverClientResponse> {
    try {
      const { subjectClientId, substituteClientId, constructedAddress } =
        validateAndFormatRecoverClientParams(data);
      const recoveryConfig = this.configService.get('deployment')?.validators?.recoverClient;
      if (!recoveryConfig?.address || !recoveryConfig?.refUtxo) {
        throw new GrpcFailedPreconditionException(
          'Tendermint client recovery is not configured for this deployment',
        );
      }

      const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
      if (!hostStateUtxo.datum) {
        throw new GrpcInternalException('HostState UTXO has no datum');
      }
      const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
        hostStateUtxo.datum,
        'host_state',
      );

      let signerKeyHash: string;
      try {
        const paymentCredential = this.lucidService.getPaymentCredential(constructedAddress);
        if (!paymentCredential || paymentCredential.type !== 'Key') {
          throw new Error('signer does not use a key payment credential');
        }
        signerKeyHash = paymentCredential.hash;
      } catch {
        throw new GrpcInvalidArgumentException('Recover client signer is not a valid Cardano address');
      }
      if (signerKeyHash.toLowerCase() !== hostStateDatum.deployer.toLowerCase()) {
        throw new GrpcFailedPreconditionException(
          'Recover client signer does not match the deployment recovery authority',
        );
      }

      const subjectClientTokenUnit = this.lucidService.getClientTokenUnit(subjectClientId);
      const substituteClientTokenUnit = this.lucidService.getClientTokenUnit(substituteClientId);
      const [subjectClientUtxo, substituteClientUtxo] = await Promise.all([
        this.lucidService.findUtxoByUnit(subjectClientTokenUnit),
        this.lucidService.findUtxoByUnit(substituteClientTokenUnit),
      ]);
      const [subjectClientDatum, substituteClientDatum] = await Promise.all([
        this.lucidService.decodeDatum<ClientDatum>(subjectClientUtxo.datum!, 'client'),
        this.lucidService.decodeDatum<ClientDatum>(substituteClientUtxo.datum!, 'client'),
      ]);
      const { validFromTime, validToTime } = await this.computeTxValidityWindow(60_000);

      await this.refreshWalletContext(constructedAddress, 'recoverClientBuilder');
      const { unsignedTx, pendingTreeUpdate } = await this.buildUnsignedRecoverClientTx({
        subjectClientId,
        substituteClientId,
        constructedAddress,
        subjectClientDatum,
        substituteClientDatum,
        subjectClientTokenUnit,
        subjectClientUtxo,
        substituteClientUtxo,
        hostStateUtxo,
        hostStateDatum,
        signerKeyHash,
        txValidTo: BigInt(validToTime) * 1_000_000n,
      });
      const { unsignedTxBytes } = await this.txOperationRunnerService.run({
        operationName: 'recoverClient',
        unsignedTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'recoverClient',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
        syntheticEvents: [
          {
            type: EVENT_TYPE_CLIENT.RECOVER_CLIENT,
            attributes: [
              { key: ATTRIBUTE_KEY_CLIENT.SUBJECT_CLIENT_ID, value: `${CLIENT_ID_PREFIX}-${subjectClientId}` },
              { key: ATTRIBUTE_KEY_CLIENT.CLIENT_TYPE, value: CLIENT_ID_PREFIX },
              {
                key: ATTRIBUTE_KEY_CLIENT.SUBSTITUTE_CLIENT_ID,
                value: `${CLIENT_ID_PREFIX}-${substituteClientId}`,
              },
            ],
          },
        ],
      });

      return {
        unsigned_tx: {
          type_url: '',
          value: unsignedTxBytes,
        },
      } as MsgRecoverClientResponse;
    } catch (error) {
      this.logger.error(`recoverClient: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error.stack}`);
      }
      throw error;
    }
  }

  public async buildUnsignedUpdateOnMisbehaviour(
    updateOnMisbehaviourOperator: UpdateOnMisbehaviourOperatorDto,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
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

    const newClientStateValue = Buffer.from(
      await encodeClientStateValue(newClientState, this.lucidService.LucidImporter),
      'hex',
    );

    const { newRoot, clientStateSiblings, consensusStateSiblings, removedConsensusStateSiblings, commit } =
      computeRootWithUpdateClientUpdate(
        hostStateDatum.state.ibc_state_root,
        ibcClientId,
        newClientStateValue,
        removedConsensusHeights,
        undefined,
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
    const unsignedTx = this.lucidService.createUnsignedUpdateClientTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      updateOnMisbehaviourOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedUpdatedHostStateDatum,
      encodedNewClientDatum,
      updateOnMisbehaviourOperator.clientTokenUnit,
      updateOnMisbehaviourOperator.constructedAddress,
    );
    return {
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
  }

  /**
   * Builds an unsigned UpdateClient transaction.
   */
  public async buildUnsignedUpdateClientTx(
    updateClientOperator: UpdateClientOperatorDto,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
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
    validateUpdateHeaderAdvancesLatestHeight(
      headerHeight,
      currentClientDatumState.clientState.latestHeight,
    );
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
    const newProcessedTimes = new Map(
      currentConsStateInArray.map(([height]) => [
        height,
        height.revisionHeight === newHeight.revisionHeight && height.revisionNumber === newHeight.revisionNumber
          ? updateClientOperator.txValidFrom
          : getHeightMapValue(currentClientDatumState.processedTimes, height) ?? 0n,
      ]),
    );
    const newProcessedHeights = new Map(
      currentConsStateInArray.map(([height]) => [
        height,
        height.revisionHeight === newHeight.revisionHeight && height.revisionNumber === newHeight.revisionNumber
          ? getProcessedHeight(updateClientOperator.txValidFrom)
          : getHeightMapValue(currentClientDatumState.processedHeights, height) ?? 0n,
      ]),
    );
    const newClientDatum: ClientDatum = {
      ...updateClientOperator.clientDatum,
      state: {
        clientState: newClientState,
        consensusStates: newConsStates,
        processedTimes: newProcessedTimes,
        processedHeights: newProcessedHeights,
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

    const { newRoot, clientStateSiblings, consensusStateSiblings, removedConsensusStateSiblings, commit } =
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
    const unsignedTx = this.lucidService.createUnsignedUpdateClientTransaction(
      hostStateUtxo,
      encodedHostStateRedeemer,
      updateClientOperator.currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedUpdatedHostStateDatum,
      encodedNewClientDatum,
      updateClientOperator.clientTokenUnit,
      updateClientOperator.constructedAddress,
    );
    return {
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
  }

  public async buildUnsignedRecoverClientTx(
    operator: RecoverClientOperatorDto,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    const recoveryState = this.validateRecoveryState(
      operator.subjectClientDatum,
      operator.substituteClientDatum,
      operator.txValidTo,
    );
    if (
      Array.from(operator.subjectClientDatum.state.consensusStates.keys()).some((height) =>
        this.isSameHeight(height, recoveryState.height),
      )
    ) {
      throw new GrpcFailedPreconditionException(
        'Subject client already contains the substitute latest consensus state',
      );
    }

    const subjectHistory = Array.from(operator.subjectClientDatum.state.consensusStates.entries()).map(
      ([height, consensusState]) => {
        const processedTime = getHeightMapValue(operator.subjectClientDatum.state.processedTimes, height);
        const processedHeight = getHeightMapValue(operator.subjectClientDatum.state.processedHeights, height);
        if (processedTime === undefined || processedHeight === undefined) {
          throw new GrpcFailedPreconditionException(
            'Subject client consensus-state history is missing processed metadata',
          );
        }
        return { height, consensusState, processedTime, processedHeight };
      },
    );
    const retainedHistory = [recoveryState, ...subjectHistory].slice(0, MAX_CONSENSUS_STATE_SIZE);
    const newClientState: ClientState = {
      ...operator.subjectClientDatum.state.clientState,
      frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
      latestHeight: recoveryState.height,
    };
    const recoveredClientDatum: ClientDatum = {
      ...operator.subjectClientDatum,
      state: {
        clientState: newClientState,
        consensusStates: new Map(
          retainedHistory.map(({ height, consensusState }) => [height, consensusState]),
        ),
        processedTimes: new Map(
          retainedHistory.map(({ height, processedTime }) => [height, processedTime]),
        ),
        processedHeights: new Map(
          retainedHistory.map(({ height, processedHeight }) => [height, processedHeight]),
        ),
      },
    };

    await this.ensureTreeAligned(operator.hostStateDatum.state.ibc_state_root);
    const outputHeightKeys = new Set(
      retainedHistory.map(
        ({ height }) => `${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`,
      ),
    );
    const removedConsensusHeights = Array.from(
      operator.subjectClientDatum.state.consensusStates.keys(),
    )
      .filter(
        (height) =>
          !outputHeightKeys.has(`${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`),
      )
      .map((height) => height.revisionHeight.toString());
    if (removedConsensusHeights.length > 1) {
      throw new GrpcInternalException('RecoverClient should prune at most one consensus state');
    }

    const newClientStateValue = Buffer.from(
      await encodeClientStateValue(newClientState, this.lucidService.LucidImporter),
      'hex',
    );
    const addedConsensusState = {
      height: recoveryState.height.revisionHeight.toString(),
      value: Buffer.from(
        await encodeConsensusStateValue(recoveryState.consensusState, this.lucidService.LucidImporter),
        'hex',
      ),
    };
    const ibcClientId = `${CLIENT_ID_PREFIX}-${operator.subjectClientId}`;
    const { newRoot, clientStateSiblings, consensusStateSiblings, removedConsensusStateSiblings, commit } =
      computeRootWithUpdateClientUpdate(
        operator.hostStateDatum.state.ibc_state_root,
        ibcClientId,
        newClientStateValue,
        removedConsensusHeights,
        addedConsensusState,
      );

    const updatedHostStateDatum: HostStateDatum = {
      ...operator.hostStateDatum,
      state: {
        ...operator.hostStateDatum.state,
        version: operator.hostStateDatum.state.version + 1n,
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
    const spendClientRedeemer: SpendClientRedeemer = {
      RecoverClient: {
        substitute_token: operator.substituteClientDatum.token,
      },
    };
    const withdrawalRedeemer = {
      RecoverClientWithdrawal: {
        subject_token: operator.subjectClientDatum.token,
        substitute_token: operator.substituteClientDatum.token,
      },
    };

    const [encodedHostStateRedeemer, encodedSpendClientRedeemer, encodedWithdrawalRedeemer] =
      await Promise.all([
        this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer'),
        this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer'),
        this.lucidService.encode(withdrawalRedeemer, 'recoverClientWithdrawalRedeemer'),
      ]);
    const [encodedUpdatedHostStateDatum, encodedRecoveredClientDatum] = await Promise.all([
      this.lucidService.encode(updatedHostStateDatum, 'host_state'),
      this.lucidService.encode(recoveredClientDatum, 'client'),
    ]);
    const unsignedTx = this.lucidService.createUnsignedRecoverClientTransaction(
      operator.hostStateUtxo,
      encodedHostStateRedeemer,
      operator.subjectClientUtxo,
      encodedSpendClientRedeemer,
      operator.substituteClientUtxo,
      encodedWithdrawalRedeemer,
      encodedUpdatedHostStateDatum,
      encodedRecoveredClientDatum,
      operator.subjectClientTokenUnit,
      operator.signerKeyHash,
    );

    return {
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
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
    txValidFromNs: bigint,
  ): Promise<{ unsignedTx: TxBuilder; clientId: bigint; pendingTreeUpdate: PendingTreeUpdate }> {
    // The HostState NFT identifies the single coordinator UTxO for this update.
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
      processedTimes: new Map([[clientState.latestHeight, txValidFromNs]]),
      processedHeights: new Map([[clientState.latestHeight, getProcessedHeight(txValidFromNs)]]),
    };

    const clientTokenName = this.generateClientTokenName(hostStateDatum);

    const clientDatum: ClientDatum = {
      state: clientDatumState,
      token: {
        policyId: mintClientScriptHash,
        name: clientTokenName,
      },
    };
    const mintClientRedeemer = 'MintClient';
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
}
