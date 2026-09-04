import {
  MsgCreateClientResponse,
  MsgCreateClient,
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
import { UpdateOnMisbehaviourOperatorDto, UpdateClientOperatorDto } from './dto';
import {
  validateAndFormatCreateClientParams,
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
import { computeLedgerAnchoredValidityWindow, type SlotConfig } from '../shared/helpers/time';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';
import { toHex } from '../shared/helpers/hex';
import type { GatewayEvent } from './tx-events.service';
import { getHeightMapValue, getProcessedHeight } from '../shared/helpers/verify';
import {
  decodeSessionDatum,
  encodeMintSessionRedeemer,
  encodeSessionDatum,
  encodeSpendMultitxClientRedeemer,
  encodeSpendSessionRedeemer,
  sameTendermintUpdatePlan,
  tendermintUpdatePlanHash,
  tendermintUpdateSessionTokenName,
  type SessionDatum,
  type UpdatePlan,
} from '../shared/types/tendermint-update-session';
import {
  advanceTendermintSession,
  capTendermintStagedValidTo,
  deriveTendermintSessionUpdatePlan,
  initialTendermintSessionPhase,
  nextTendermintSessionAdvance,
  validateTendermintStagedFinalization,
} from './update-client-session-state';
import { buildTendermintStagedPayloads } from './update-client-staged-payload';
import type { LedgerStateUtxo } from '../shared/helpers/ogmios-utxo';
import {
  encodeTendermintUpdateTxChain,
  MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH,
  TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
} from './tendermint-update-tx-chain';

export const TENDERMINT_HEADER_TYPE_URL = '/ibc.lightclients.tendermint.v1.Header';
const TENDERMINT_SESSION_MATCH_MAX_ATTEMPTS = 10;
const TENDERMINT_SESSION_MATCH_RETRY_DELAY_MS = 500;
// The maximum staged plan is 70 sequential transactions. Nine minutes leaves
// enough time to submit that plan while staying inside this devnet's 576-slot
// forecast safe zone when it uses one-second slots.
export const TENDERMINT_UPDATE_CHAIN_TIME_TO_LIVE = 9 * 60 * 1000;
// Finalization records the transaction's validity upper bound as the
// conservative IBC processed time. Keep that bound narrow so subsequent
// proofs do not have to wait for the ordinary two-minute transaction TTL.
export const TENDERMINT_FINALIZATION_TIME_TO_LIVE = 60 * 1000;

type StagedTendermintSession = {
  utxo: UTxO;
  datum: SessionDatum;
  tokenUnit: string;
};

type StagedTendermintFinalization = StagedTendermintSession & {
  signerKeyHash: string;
  processedTimeNs: bigint;
};

type StagedTendermintSeedReservation = {
  seedRef: string;
  utxo: Promise<UTxO>;
  expiresAtMs: number;
};

@Injectable()
export class ClientService {
  /**
   * Reservations have two indexes: logical plan to seed, and seed out-ref to
   * logical plan. The latter prevents concurrent plans from selecting the same
   * one-shot input before either transaction reaches the ledger.
   */
  private readonly stagedTendermintInitializationSeeds = new Map<string, StagedTendermintSeedReservation>();
  private readonly stagedTendermintSeedReservations = new Map<string, string>();

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

  private async computeTxValidityWindow(
    backdateMs = 0,
    timeToLiveMs = TRANSACTION_TIME_TO_LIVE,
  ): Promise<{
    currentSlot: number;
    currentLedgerTime: number;
    validFromTime: number;
    validToSlot: number;
    validToTime: number;
    slotConfig: SlotConfig;
  }> {
    const ogmiosEndpoint = this.configService.getOrThrow<string>('ogmiosEndpoint');
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`client tx failed: invalid slot configuration for network ${network}`);
    }

    return computeLedgerAnchoredValidityWindow(ogmiosEndpoint, slotConfig, timeToLiveMs, {
      backdateMs,
    });
  }

  private tendermintUpdateSafeBackdateMs(clientDatum: ClientDatum): number {
    const maxClockDriftMs = clientDatum.state.clientState.maxClockDrift / 1_000_000n;
    const maxBackdateMarginMs = 1_000n;
    const maxBackdateCapMs = 60_000n;
    const maxAllowedBackdateMs = maxClockDriftMs > maxBackdateMarginMs ? maxClockDriftMs - maxBackdateMarginMs : 0n;
    return Number(maxAllowedBackdateMs < maxBackdateCapMs ? maxAllowedBackdateMs : maxBackdateCapMs);
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
      const {
        unsignedTx: unsignedCreateClientTx,
        clientId,
        pendingTreeUpdate,
      } = await this.buildUnsignedCreateClientTx(clientState, consensusState, constructedAddress, txValidFromNs);

      this.logger.log(
        `[DEBUG] Setting validity: validFrom=${new Date(validFromTimestamp).toISOString()}, validTo=${new Date(validToTimestamp).toISOString()}`,
      );

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
      this.logger.log(
        `CBOR hex string length: ${unsignedTxCbor.length}, first 40 chars: ${unsignedTxCbor.substring(0, 40)}`,
      );

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
        this.logger.error(
          `createClient ERROR CAUSE: ${JSON.stringify(error.cause, Object.getOwnPropertyNames(error.cause), 2)}`,
        );
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

      const stagedTendermintClient = this.lucidService.hasStagedTendermintClient();
      const clientMessageType = clientMessage.type_url;
      if (stagedTendermintClient && clientMessageType === TENDERMINT_MISBEHAVIOUR_TYPE_URL) {
        throw new GrpcInvalidArgumentException(
          'Tendermint misbehaviour is not yet supported by the staged client protocol',
        );
      }
      if (stagedTendermintClient && clientMessageType !== TENDERMINT_HEADER_TYPE_URL) {
        throw new GrpcInvalidArgumentException(
          `Unsupported staged Tendermint client message type: ${clientMessageType || '<empty>'}`,
        );
      }
      if (!stagedTendermintClient && !verifyClientMessage(clientMessage, currentClientDatum)) {
        throw new GrpcInvalidArgumentException('Invalid client message');
      }

      // The staged Aiken validators and the exact off-chain session planner are
      // the verification authority. The legacy JS verifier remains in place
      // only for deployments using the original single-transaction client.
      const foundMisbehaviour = stagedTendermintClient
        ? false
        : checkForMisbehaviour(clientMessage, currentClientDatum);

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
        const maxAllowedBackdateMs = maxClockDriftMs > maxBackdateMarginMs ? maxClockDriftMs - maxBackdateMarginMs : 0n;
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
      // Leave a small margin so the header can be up to ~1s ahead of `valid_from + max_clock_drift`
      // due to normal cross-chain time skew.
      const safeBackdateMs = this.tendermintUpdateSafeBackdateMs(currentClientDatum);
      const validityWindow = await this.computeTxValidityWindow(
        safeBackdateMs,
        stagedTendermintClient ? TENDERMINT_UPDATE_CHAIN_TIME_TO_LIVE : TRANSACTION_TIME_TO_LIVE,
      );
      const validFromTimeMs = validityWindow.validFromTime;
      const validToTimeMs = validityWindow.validToTime;
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

      if (stagedTendermintClient) {
        return await this.updateClientWithStagedSession(
          data,
          updateClientHeaderOperator,
          validFromTimeMs,
          validToTimeMs,
          updateConsensusHeight,
          validityWindow.currentLedgerTime,
          validityWindow.slotConfig,
        );
      }
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

  private async updateClientWithStagedSession(
    data: MsgUpdateClient,
    updateClientOperator: UpdateClientOperatorDto,
    validFromTimeMs: number,
    proposedValidToTimeMs: number,
    updateConsensusHeight: Height,
    currentLedgerTimeMs = validFromTimeMs,
    slotConfig: SlotConfig = { zeroTime: 0, zeroSlot: 0, slotLength: 1 },
  ): Promise<MsgUpdateClientResponse> {
    const owner = this.requireKeyPaymentCredential(updateClientOperator.constructedAddress);
    const sessionAddress = this.lucidService.getTendermintUpdateSessionAddress();
    const walletAddress = this.lucidService.credentialToAddress(updateClientOperator.constructedAddress);
    const ledgerUtxos = await this.queryTendermintLedgerSnapshot(
      sessionAddress,
      walletAddress,
      updateClientOperator.currentClientUtxo.address,
    );
    this.requireTendermintLedgerUtxo(ledgerUtxos, updateClientOperator.currentClientUtxo, 'indexed client');
    const ledgerRequestSessions = this.matchingStagedTendermintRequestSessions(
      ledgerUtxos.filter((utxo) => utxo.address === sessionAddress),
      updateClientOperator,
      owner,
    );
    let indexedRequestSessions: StagedTendermintSession[] = [];
    if (ledgerRequestSessions.length > 0) {
      const ledgerRefs = new Set(ledgerRequestSessions.map((session) => this.tendermintUtxoRef(session.utxo)));
      indexedRequestSessions = await this.findStagedTendermintRequestSessions(updateClientOperator, owner);
      indexedRequestSessions = indexedRequestSessions.filter((session) =>
        ledgerRefs.has(this.tendermintUtxoRef(session.utxo)),
      );
      if (indexedRequestSessions.length !== ledgerRefs.size) {
        indexedRequestSessions = await this.findStagedTendermintRequestSessions(
          updateClientOperator,
          owner,
          TENDERMINT_SESSION_MATCH_MAX_ATTEMPTS - 1,
          ledgerRefs,
        );
      }
      if (indexedRequestSessions.length !== ledgerRefs.size) {
        throw new GrpcFailedPreconditionException(
          'The live Tendermint update session is confirmed by the Cardano node but temporarily unavailable from the indexer; retry after the indexer catches up',
        );
      }
    }

    try {
      validateUpdateHeaderAdvancesLatestHeight(
        updateClientOperator.header.signedHeader.header.height,
        updateClientOperator.clientDatum.state.clientState.latestHeight,
      );
    } catch (error) {
      if (indexedRequestSessions.length === 0) throw error;
      return this.buildTendermintSessionCancellationChain(
        indexedRequestSessions,
        updateClientOperator,
        validFromTimeMs,
        proposedValidToTimeMs,
      );
    }

    let validToTimeMs: number;
    try {
      validateTendermintStagedFinalization({
        validFromTimeMs,
        trustedHeight: updateClientOperator.header.trustedHeight,
        headerTimeNs: updateClientOperator.header.signedHeader.header.time,
        clientDatum: updateClientOperator.clientDatum,
      });
      validToTimeMs = capTendermintStagedValidTo({
        proposedValidToMs: proposedValidToTimeMs,
        currentLedgerTimeMs,
        trustedHeight: updateClientOperator.header.trustedHeight,
        clientDatum: updateClientOperator.clientDatum,
        slotConfig,
      });
    } catch (error) {
      if (indexedRequestSessions.length > 0) {
        return this.buildTendermintSessionCancellationChain(
          indexedRequestSessions,
          updateClientOperator,
          validFromTimeMs,
          proposedValidToTimeMs,
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new GrpcFailedPreconditionException(`Cannot create a staged Tendermint update session: ${detail}`);
    }

    let plan: UpdatePlan;
    try {
      plan = deriveTendermintSessionUpdatePlan({
        header: updateClientOperator.header,
        clientDatum: updateClientOperator.clientDatum,
      });
    } catch (error) {
      if (indexedRequestSessions.length === 0) throw error;
      return this.buildTendermintSessionCancellationChain(
        indexedRequestSessions,
        updateClientOperator,
        validFromTimeMs,
        validToTimeMs,
      );
    }

    const exactSessions = indexedRequestSessions.filter((session) =>
      sameTendermintUpdatePlan(session.datum.plan, plan, this.lucidService.LucidImporter),
    );
    if (indexedRequestSessions.length > 0 && exactSessions.length === 0) {
      return this.buildTendermintSessionCancellationChain(
        indexedRequestSessions,
        updateClientOperator,
        validFromTimeMs,
        validToTimeMs,
      );
    }

    const mode = plan.header.height === plan.trustedHeight.revisionHeight + 1n ? 'adjacent' : 'non_adjacent';
    const payloads = buildTendermintStagedPayloads({
      header: updateClientOperator.header,
      mode,
      ...(mode === 'non_adjacent'
        ? {
            expectedTrustedValidatorsHash: plan.trustedConsensusState.next_validators_hash,
          }
        : {}),
    });
    const initializationKey = this.tendermintSessionInitializationKey(plan, owner);
    let existingSession: StagedTendermintSession | undefined;
    let duplicateSessions: StagedTendermintSession[] = [];
    let initialSession:
      | {
          seedUtxo: UTxO;
          datum: SessionDatum;
          tokenUnit: string;
          mintRedeemer: string;
        }
      | undefined;

    if (exactSessions.length > 0) {
      this.releaseTendermintSessionSeed(initializationKey);
      const orderedSessions = this.orderStagedTendermintSessions(exactSessions);
      existingSession = orderedSessions[0];
      const staleSessions = indexedRequestSessions.filter((session) => !exactSessions.includes(session));
      duplicateSessions = this.orderStagedTendermintSessions([...orderedSessions.slice(1), ...staleSessions]).reverse();
    } else {
      const planHash = tendermintUpdatePlanHash(plan, this.lucidService.LucidImporter);
      const seedUtxo = await this.reserveTendermintSessionSeed(
        initializationKey,
        planHash,
        updateClientOperator.constructedAddress,
        ledgerUtxos.filter((utxo) => utxo.address === walletAddress),
        validToTimeMs,
        currentLedgerTimeMs,
      );
      const seed = {
        transactionId: seedUtxo.txHash,
        outputIndex: BigInt(seedUtxo.outputIndex),
      };
      const policyId = this.lucidService.getTendermintUpdateSessionPolicyId();
      const tokenName = tendermintUpdateSessionTokenName(seed, plan, this.lucidService.LucidImporter);
      const sessionToken = { policyId, name: tokenName };
      const datum: SessionDatum = {
        sessionToken,
        owner,
        plan,
        phase: initialTendermintSessionPhase(plan),
      };
      const mintRedeemer = encodeMintSessionRedeemer(
        { MintSession: { seed, owner, plan } },
        this.lucidService.LucidImporter,
      );
      initialSession = {
        seedUtxo,
        datum,
        tokenUnit: policyId + tokenName,
        mintRedeemer,
      };
    }

    if (existingSession && 'Complete' in existingSession.datum.phase && duplicateSessions.length === 0) {
      return this.buildTendermintFinalizationChain(
        data,
        updateClientOperator,
        existingSession,
        owner,
        updateConsensusHeight,
      );
    }

    const validity = {
      apply: (builder: TxBuilder) => builder.validFrom(validFromTimeMs).validTo(validToTimeMs),
    };
    const treeNeutralUpdate = (): PendingTreeUpdate => ({
      kind: 'tree_neutral',
      expectedNewRoot: '',
      commit: () => undefined,
    });
    const { links } = await this.txOperationRunnerService.runChain({
      operationName: 'buildTendermintUpdateTransactionChain',
      wallet: {
        mode: 'refresh_from_address',
        address: updateClientOperator.constructedAddress,
        context: 'buildTendermintUpdateTransactionChain',
      },
      build: async (chain) => {
        let linkCount = 0;
        const completeIntermediate = async (operationName: string, buildUnsignedTx: () => TxBuilder) => {
          if (linkCount >= MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH - 1) {
            throw new GrpcFailedPreconditionException(
              `The staged Tendermint update needs more than ${MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH} transactions after duplicate cleanup`,
            );
          }
          linkCount += 1;
          return chain.complete({
            operationName,
            unsignedTx: buildUnsignedTx(),
            validity,
            completeOptions: {
              localUPLCEval: false,
              setCollateral: TRANSACTION_SET_COLLATERAL,
            },
            pendingTreeUpdate: treeNeutralUpdate(),
          });
        };

        for (const duplicate of duplicateSessions) {
          await completeIntermediate('cancelDuplicateTendermintUpdateSession', () =>
            this.buildUnsignedCancelTendermintSession(duplicate.utxo),
          );
        }

        let currentSession = existingSession;
        if (initialSession) {
          const initialized = await completeIntermediate('initializeTendermintUpdateSession', () =>
            this.lucidService.createUnsignedTendermintSessionTransaction(
              initialSession.seedUtxo,
              initialSession.mintRedeemer,
              encodeSessionDatum(initialSession.datum, this.lucidService.LucidImporter),
              initialSession.tokenUnit,
              owner,
            ),
          );
          currentSession = {
            utxo: this.requireDerivedTendermintSessionOutput(initialized.derivedOutputs, initialSession.tokenUnit),
            datum: initialSession.datum,
            tokenUnit: initialSession.tokenUnit,
          };
        }
        if (!currentSession) {
          throw new GrpcInternalException('Unable to establish the staged Tendermint session chain head');
        }

        for (;;) {
          const sessionHead: StagedTendermintSession = currentSession;
          const advanceRedeemer = nextTendermintSessionAdvance(sessionHead.datum, payloads);
          if (!advanceRedeemer) break;
          const nextDatum = advanceTendermintSession(sessionHead.datum, advanceRedeemer);
          const advanced = await completeIntermediate('verifyTendermintUpdateBatch', () =>
            this.lucidService.createUnsignedAdvanceTendermintSessionTransaction(
              sessionHead.utxo,
              encodeSpendSessionRedeemer(advanceRedeemer, this.lucidService.LucidImporter),
              encodeSessionDatum(nextDatum, this.lucidService.LucidImporter),
              sessionHead.tokenUnit,
              owner,
            ),
          );
          currentSession = {
            utxo: this.requireDerivedTendermintSessionOutput(advanced.derivedOutputs, sessionHead.tokenUnit),
            datum: nextDatum,
            tokenUnit: sessionHead.tokenUnit,
          };
        }

        if (!('Complete' in currentSession.datum.phase)) {
          throw new GrpcInternalException('Staged Tendermint verification stopped before the session reached Complete');
        }
      },
    });

    return {
      unsigned_tx: {
        type_url: TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
        value: encodeTendermintUpdateTxChain(
          links.map((link) => link.unsignedTxCbor),
          { rebuildAfterSubmission: true },
        ),
      },
      client_id: parseInt(updateClientOperator.clientId.toString()),
    } as unknown as MsgUpdateClientResponse;
  }

  private async buildTendermintFinalizationChain(
    data: MsgUpdateClient,
    updateClientOperator: UpdateClientOperatorDto,
    session: StagedTendermintSession,
    owner: string,
    updateConsensusHeight: Height,
  ): Promise<MsgUpdateClientResponse> {
    const clientMessage = data.client_message;
    if (!clientMessage) {
      throw new GrpcInvalidArgumentException('Tendermint update requires a client message');
    }
    const safeBackdateMs = this.tendermintUpdateSafeBackdateMs(updateClientOperator.clientDatum);
    const validityWindow = await this.computeTxValidityWindow(safeBackdateMs, TENDERMINT_FINALIZATION_TIME_TO_LIVE);
    let validToTimeMs: number;
    try {
      validateTendermintStagedFinalization({
        validFromTimeMs: validityWindow.validFromTime,
        trustedHeight: updateClientOperator.header.trustedHeight,
        headerTimeNs: updateClientOperator.header.signedHeader.header.time,
        clientDatum: updateClientOperator.clientDatum,
      });
      validToTimeMs = capTendermintStagedValidTo({
        proposedValidToMs: validityWindow.validToTime,
        currentLedgerTimeMs: validityWindow.currentLedgerTime,
        trustedHeight: updateClientOperator.header.trustedHeight,
        clientDatum: updateClientOperator.clientDatum,
        slotConfig: validityWindow.slotConfig,
        minimumRemainingValidityMs: TENDERMINT_FINALIZATION_TIME_TO_LIVE,
      });
    } catch {
      return this.buildTendermintSessionCancellationChain(
        [session],
        updateClientOperator,
        validityWindow.validFromTime,
        validityWindow.validToTime,
      );
    }

    const finalOperator: UpdateClientOperatorDto = {
      ...updateClientOperator,
      txValidFrom: BigInt(validityWindow.validFromTime) * 1_000_000n,
    };
    const validity = {
      apply: (builder: TxBuilder) => builder.validFrom(validityWindow.validFromTime).validTo(validToTimeMs),
    };
    const { links } = await this.txOperationRunnerService.runChain({
      operationName: 'buildTendermintUpdateFinalization',
      wallet: {
        mode: 'refresh_from_address',
        address: updateClientOperator.constructedAddress,
        context: 'buildTendermintUpdateFinalization',
      },
      build: async (chain) => {
        const { unsignedTx, pendingTreeUpdate } = await this.buildUnsignedUpdateClientTx(finalOperator, {
          ...session,
          signerKeyHash: owner,
          processedTimeNs: BigInt(validToTimeMs) * 1_000_000n,
        });
        await chain.complete({
          operationName: 'finalizeTendermintUpdateSession',
          unsignedTx,
          validity,
          completeOptions: {
            localUPLCEval: false,
            setCollateral: TRANSACTION_SET_COLLATERAL,
          },
          pendingTreeUpdate,
          syntheticEvents: [
            this.buildUpdateClientSyntheticEvent(
              EVENT_TYPE_CLIENT.UPDATE_CLIENT,
              updateClientOperator.clientId,
              updateConsensusHeight,
              clientMessage,
            ),
          ],
        });
      },
    });

    return {
      unsigned_tx: {
        type_url: TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
        value: encodeTendermintUpdateTxChain(links.map((link) => link.unsignedTxCbor)),
      },
      client_id: parseInt(updateClientOperator.clientId.toString()),
    } as unknown as MsgUpdateClientResponse;
  }

  private async buildTendermintSessionCancellationChain(
    sessions: StagedTendermintSession[],
    updateClientOperator: UpdateClientOperatorDto,
    validFromTimeMs: number,
    validToTimeMs: number,
  ): Promise<MsgUpdateClientResponse> {
    if (sessions.length === 0 || sessions.length > MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH) {
      throw new GrpcFailedPreconditionException(
        `Tendermint session cleanup requires between 1 and ${MAX_TENDERMINT_UPDATE_TX_CHAIN_LENGTH} transactions`,
      );
    }
    const validity = {
      apply: (builder: TxBuilder) => builder.validFrom(validFromTimeMs).validTo(validToTimeMs),
    };
    const { links } = await this.txOperationRunnerService.runChain({
      operationName: 'cancelStaleTendermintUpdateSessions',
      wallet: {
        mode: 'refresh_from_address',
        address: updateClientOperator.constructedAddress,
        context: 'cancelStaleTendermintUpdateSessions',
      },
      build: async (chain) => {
        for (const session of this.orderStagedTendermintSessions(sessions).reverse()) {
          await chain.complete({
            operationName: 'cancelStaleTendermintUpdateSession',
            unsignedTx: this.buildUnsignedCancelTendermintSession(session.utxo),
            validity,
            completeOptions: {
              localUPLCEval: false,
              setCollateral: TRANSACTION_SET_COLLATERAL,
            },
            pendingTreeUpdate: {
              kind: 'tree_neutral',
              expectedNewRoot: '',
              commit: () => undefined,
            },
          });
        }
      },
    });

    return {
      unsigned_tx: {
        type_url: TENDERMINT_UPDATE_TX_CHAIN_TYPE_URL,
        value: encodeTendermintUpdateTxChain(
          links.map((link) => link.unsignedTxCbor),
          { rebuildAfterSubmission: true },
        ),
      },
      client_id: parseInt(updateClientOperator.clientId.toString()),
    } as unknown as MsgUpdateClientResponse;
  }

  private requireKeyPaymentCredential(address: string): string {
    try {
      const credential = this.lucidService.getPaymentCredential(address);
      if (credential?.type === 'Key' && /^[0-9a-f]{56}$/i.test(credential.hash)) {
        return credential.hash.toLowerCase();
      }
    } catch {
      // Fall through to the same caller-facing validation error.
    }
    throw new GrpcInvalidArgumentException('Staged Tendermint updates require a signer with a key payment credential');
  }

  private selectTendermintSessionSeed(walletUtxos: LedgerStateUtxo[], planHash: string): LedgerStateUtxo {
    if (walletUtxos.length === 0) {
      throw new GrpcFailedPreconditionException(
        'Cannot initialize a Tendermint update session without a node-confirmed wallet UTxO',
      );
    }
    const adaOnly = walletUtxos.filter((utxo) => Object.keys(utxo.assets).every((unit) => unit === 'lovelace'));
    const candidates = [...(adaOnly.length > 0 ? adaOnly : walletUtxos)].sort((left, right) => {
      const leftHasOnlyAda = Object.keys(left.assets).every((unit) => unit === 'lovelace');
      const rightHasOnlyAda = Object.keys(right.assets).every((unit) => unit === 'lovelace');
      if (leftHasOnlyAda !== rightHasOnlyAda) return leftHasOnlyAda ? -1 : 1;
      const hashOrder = left.txHash.localeCompare(right.txHash);
      return hashOrder === 0 ? left.outputIndex - right.outputIndex : hashOrder;
    });
    const candidateIndex = Number(BigInt(`0x${planHash}`) % BigInt(candidates.length));
    return candidates[candidateIndex];
  }

  private tendermintSessionInitializationKey(plan: UpdatePlan, owner: string): string {
    return `${owner}:${tendermintUpdatePlanHash(plan, this.lucidService.LucidImporter)}`;
  }

  private tendermintUtxoRef(utxo: Pick<UTxO, 'txHash' | 'outputIndex'>): string {
    return `${utxo.txHash.toLowerCase()}#${utxo.outputIndex}`;
  }

  private requireDerivedTendermintSessionOutput(derivedOutputs: UTxO[], tokenUnit: string): UTxO {
    const matching = derivedOutputs.filter(
      (utxo) => utxo.address === this.lucidService.getTendermintUpdateSessionAddress() && utxo.assets[tokenUnit] === 1n,
    );
    if (matching.length !== 1 || !matching[0].datum) {
      throw new GrpcInternalException(
        `Expected exactly one inline-datum session output carrying ${tokenUnit}, found ${matching.length}`,
      );
    }
    return matching[0];
  }

  private releaseTendermintSessionSeed(initializationKey: string): void {
    const reserved = this.stagedTendermintInitializationSeeds.get(initializationKey);
    if (!reserved) return;
    this.stagedTendermintInitializationSeeds.delete(initializationKey);
    if (this.stagedTendermintSeedReservations.get(reserved.seedRef) === initializationKey) {
      this.stagedTendermintSeedReservations.delete(reserved.seedRef);
    }
  }

  private pruneExpiredTendermintSessionSeeds(currentLedgerTimeMs: number): void {
    for (const [initializationKey, reservation] of this.stagedTendermintInitializationSeeds) {
      if (reservation.expiresAtMs <= currentLedgerTimeMs) {
        this.releaseTendermintSessionSeed(initializationKey);
      }
    }
  }

  private reserveTendermintSessionSeed(
    initializationKey: string,
    planHash: string,
    address: string,
    liveWalletUtxos: LedgerStateUtxo[],
    expiresAtMs: number,
    currentLedgerTimeMs: number,
  ): Promise<UTxO> {
    if (
      !Number.isSafeInteger(expiresAtMs) ||
      !Number.isSafeInteger(currentLedgerTimeMs) ||
      expiresAtMs <= currentLedgerTimeMs
    ) {
      throw new GrpcFailedPreconditionException(
        'Tendermint session seed reservation requires a future ledger validity deadline',
      );
    }
    this.pruneExpiredTendermintSessionSeeds(currentLedgerTimeMs);
    const liveRefs = new Set(liveWalletUtxos.map((utxo) => this.tendermintUtxoRef(utxo)));
    const reserved = this.stagedTendermintInitializationSeeds.get(initializationKey);
    if (reserved && liveRefs.has(reserved.seedRef)) {
      reserved.expiresAtMs = Math.max(reserved.expiresAtMs, expiresAtMs);
      return reserved.utxo;
    }
    if (reserved) this.releaseTendermintSessionSeed(initializationKey);

    const selected = this.selectTendermintSessionSeed(liveWalletUtxos, planHash);
    const seedRef = this.tendermintUtxoRef(selected);
    const reservedBy = this.stagedTendermintSeedReservations.get(seedRef);
    if (reservedBy && reservedBy !== initializationKey) {
      throw new GrpcFailedPreconditionException(
        `The deterministic Tendermint session seed ${seedRef} is reserved by another update; retry after that update advances`,
      );
    }
    this.stagedTendermintSeedReservations.set(seedRef, initializationKey);

    const reservation = this.lucidService
      .tryFindUtxosAt(address, {
        maxAttempts: 6,
        retryDelayMs: 1000,
      })
      .then((walletUtxos) => {
        const indexedSeed = walletUtxos.find((utxo) => this.tendermintUtxoRef(utxo) === seedRef);
        if (!indexedSeed) {
          throw new GrpcFailedPreconditionException(
            `The node-confirmed Tendermint session seed ${seedRef} is temporarily unavailable from the indexer; retry after the indexer catches up`,
          );
        }
        return indexedSeed;
      });
    const record = { seedRef, utxo: reservation, expiresAtMs };
    this.stagedTendermintInitializationSeeds.set(initializationKey, record);
    void reservation.catch(() => {
      if (this.stagedTendermintInitializationSeeds.get(initializationKey) === record) {
        this.releaseTendermintSessionSeed(initializationKey);
      }
    });
    return reservation;
  }

  private async queryTendermintLedgerSnapshot(
    sessionAddress: string,
    walletAddress: string,
    clientAddress: string,
  ): Promise<LedgerStateUtxo[]> {
    try {
      return await this.lucidService.queryLedgerStateUtxosAtAddresses([sessionAddress, walletAddress, clientAddress]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to query authoritative Tendermint session state: ${detail}`);
      throw new GrpcFailedPreconditionException(
        'Unable to confirm Tendermint session state from the Cardano node; retry without changing the update plan',
      );
    }
  }

  private requireTendermintLedgerUtxo(
    ledgerUtxos: LedgerStateUtxo[],
    indexedUtxo: Pick<UTxO, 'txHash' | 'outputIndex'>,
    label: string,
  ): void {
    const expectedRef = this.tendermintUtxoRef(indexedUtxo);
    if (!ledgerUtxos.some((utxo) => this.tendermintUtxoRef(utxo) === expectedRef)) {
      throw new GrpcFailedPreconditionException(
        `The ${label} UTxO ${expectedRef} is no longer live according to the Cardano node; retry after the indexer catches up`,
      );
    }
  }

  private async requireLiveTendermintFinalizationInputs(hostStateUtxo: UTxO, currentClientUtxo: UTxO): Promise<void> {
    let ledgerUtxos: LedgerStateUtxo[];
    try {
      ledgerUtxos = await this.lucidService.queryLedgerStateUtxosAtAddresses([
        hostStateUtxo.address,
        currentClientUtxo.address,
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to confirm staged finalization inputs: ${detail}`);
      throw new GrpcFailedPreconditionException(
        'Unable to confirm the staged Tendermint finalization inputs from the Cardano node; retry the update',
      );
    }
    this.requireTendermintLedgerUtxo(ledgerUtxos, hostStateUtxo, 'HostState');
    this.requireTendermintLedgerUtxo(ledgerUtxos, currentClientUtxo, 'client');
  }

  private async waitForTendermintSessionMatchRetry(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, TENDERMINT_SESSION_MATCH_RETRY_DELAY_MS));
  }

  private async findStagedTendermintSessions(
    plan: UpdatePlan,
    owner: string,
    maxAttempts = 1,
    expectedRefs?: Set<string>,
  ): Promise<StagedTendermintSession[]> {
    const sessionAddress = this.lucidService.getTendermintUpdateSessionAddress();

    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      const sessionUtxos = await this.lucidService.tryFindUtxosAt(sessionAddress, {
        maxAttempts: 1,
        retryDelayMs: 0,
      });
      const matching = this.matchingStagedTendermintSessions(sessionUtxos, plan, owner);
      if (!expectedRefs) return matching;
      const expected = matching.filter((session) => expectedRefs.has(this.tendermintUtxoRef(session.utxo)));
      if (expected.length === expectedRefs.size) {
        return expected;
      }
      if (attempt < maxAttempts) await this.waitForTendermintSessionMatchRetry();
    }

    return [];
  }

  private async findStagedTendermintRequestSessions(
    updateClientOperator: UpdateClientOperatorDto,
    owner: string,
    maxAttempts = 1,
    expectedRefs?: Set<string>,
  ): Promise<StagedTendermintSession[]> {
    const sessionAddress = this.lucidService.getTendermintUpdateSessionAddress();

    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      const sessionUtxos = await this.lucidService.tryFindUtxosAt(sessionAddress, {
        maxAttempts: 1,
        retryDelayMs: 0,
      });
      const matching = this.matchingStagedTendermintRequestSessions(sessionUtxos, updateClientOperator, owner);
      if (!expectedRefs) return matching;
      const expected = matching.filter((session) => expectedRefs.has(this.tendermintUtxoRef(session.utxo)));
      if (expected.length === expectedRefs.size) return expected;
      if (attempt < maxAttempts) await this.waitForTendermintSessionMatchRetry();
    }

    return [];
  }

  private matchingStagedTendermintSessions(
    sessionUtxos: Array<UTxO | LedgerStateUtxo>,
    plan: UpdatePlan,
    owner: string,
  ): StagedTendermintSession[] {
    const policyId = this.lucidService.getTendermintUpdateSessionPolicyId();
    const matching: StagedTendermintSession[] = [];

    for (const utxo of sessionUtxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeSessionDatum(utxo.datum, this.lucidService.LucidImporter);
        const tokenUnit = datum.sessionToken.policyId + datum.sessionToken.name;
        if (
          datum.owner.toLowerCase() === owner &&
          datum.sessionToken.policyId === policyId &&
          utxo.assets[tokenUnit] === 1n &&
          sameTendermintUpdatePlan(datum.plan, plan, this.lucidService.LucidImporter)
        ) {
          matching.push({ utxo: utxo as UTxO, datum, tokenUnit });
        }
      } catch {
        // Ignore unrelated or malformed outputs at the public session address.
      }
    }

    return matching;
  }

  private matchingStagedTendermintRequestSessions(
    sessionUtxos: Array<UTxO | LedgerStateUtxo>,
    updateClientOperator: UpdateClientOperatorDto,
    owner: string,
  ): StagedTendermintSession[] {
    const policyId = this.lucidService.getTendermintUpdateSessionPolicyId();
    const matching: StagedTendermintSession[] = [];

    for (const utxo of sessionUtxos) {
      if (!utxo.datum) continue;
      try {
        const datum = decodeSessionDatum(utxo.datum, this.lucidService.LucidImporter);
        const tokenUnit = datum.sessionToken.policyId + datum.sessionToken.name;
        if (
          datum.owner.toLowerCase() === owner &&
          datum.sessionToken.policyId === policyId &&
          utxo.assets[tokenUnit] === 1n &&
          this.sameTendermintUpdateRequest(datum.plan, updateClientOperator)
        ) {
          matching.push({ utxo: utxo as UTxO, datum, tokenUnit });
        }
      } catch {
        // Ignore unrelated or malformed outputs at the public session address.
      }
    }

    return matching;
  }

  private sameTendermintUpdateRequest(sessionPlan: UpdatePlan, updateClientOperator: UpdateClientOperatorDto): boolean {
    const header = updateClientOperator.header;
    const adjacent = header.signedHeader.header.height === header.trustedHeight.revisionHeight + 1n;
    const requestBoundPlan: UpdatePlan = {
      ...sessionPlan,
      clientToken: updateClientOperator.clientDatum.token,
      trustedHeight: header.trustedHeight,
      header: header.signedHeader.header,
      commit: {
        height: header.signedHeader.commit.height,
        round: header.signedHeader.commit.round,
        blockId: header.signedHeader.commit.blockId,
      },
      targetValidatorCount: BigInt(header.validatorSet.validators.length),
      trustedValidatorCount: adjacent ? 0n : BigInt(header.trustedValidators.validators.length),
    };
    return sameTendermintUpdatePlan(sessionPlan, requestBoundPlan, this.lucidService.LucidImporter);
  }

  private tendermintSessionProgress(session: StagedTendermintSession): bigint {
    const { phase, plan } = session.datum;
    if ('AdjacentTarget' in phase) return phase.AdjacentTarget.targetAccumulator.count;
    if ('NonAdjacentTrusted' in phase) return phase.NonAdjacentTrusted.trustedAccumulator.count;
    if ('NonAdjacentTarget' in phase) {
      return plan.trustedValidatorCount + phase.NonAdjacentTarget.targetAccumulator.count;
    }
    return plan.trustedValidatorCount + plan.targetValidatorCount + 1n;
  }

  private orderStagedTendermintSessions(sessions: StagedTendermintSession[]): StagedTendermintSession[] {
    return [...sessions].sort((left, right) => {
      const progressOrder = this.tendermintSessionProgress(right) - this.tendermintSessionProgress(left);
      if (progressOrder !== 0n) return progressOrder > 0n ? 1 : -1;
      const tokenOrder = left.tokenUnit.localeCompare(right.tokenUnit);
      if (tokenOrder !== 0) return tokenOrder;
      return this.tendermintUtxoRef(left.utxo).localeCompare(this.tendermintUtxoRef(right.utxo));
    });
  }

  public buildUnsignedCancelTendermintSession(sessionUtxo: UTxO): TxBuilder {
    if (sessionUtxo.address !== this.lucidService.getTendermintUpdateSessionAddress() || !sessionUtxo.datum) {
      throw new GrpcInvalidArgumentException(
        'A live inline-datum Tendermint session UTxO is required for cancellation',
      );
    }
    let datum: SessionDatum;
    try {
      datum = decodeSessionDatum(sessionUtxo.datum, this.lucidService.LucidImporter);
    } catch {
      throw new GrpcInvalidArgumentException('The Tendermint session UTxO has a malformed datum');
    }
    const policyId = this.lucidService.getTendermintUpdateSessionPolicyId();
    const tokenUnit = datum.sessionToken.policyId + datum.sessionToken.name;
    if (
      datum.sessionToken.policyId !== policyId ||
      sessionUtxo.assets[tokenUnit] !== 1n ||
      !/^[0-9a-f]{56}$/i.test(datum.owner)
    ) {
      throw new GrpcInvalidArgumentException('The Tendermint session UTxO is not authenticated by its declared NFT');
    }

    return this.lucidService.createUnsignedCancelTendermintSessionTransaction(
      sessionUtxo,
      encodeSpendSessionRedeemer('Cancel', this.lucidService.LucidImporter),
      encodeMintSessionRedeemer(
        { BurnSession: { tokenName: datum.sessionToken.name } },
        this.lucidService.LucidImporter,
      ),
      tokenUnit,
      datum.owner.toLowerCase(),
    );
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
    stagedFinalization?: StagedTendermintFinalization,
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
    validateUpdateHeaderAdvancesLatestHeight(headerHeight, currentClientDatumState.clientState.latestHeight);
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
    const processedTimeNs = stagedFinalization?.processedTimeNs ?? updateClientOperator.txValidFrom;
    let currentConsStateInArray = Array.from(currentClientDatumState.consensusStates.entries()).filter(
      ([_, consState]) => !isExpired(newClientState, consState.timestamp, processedTimeNs),
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
          ? processedTimeNs
          : (getHeightMapValue(currentClientDatumState.processedTimes, height) ?? 0n),
      ]),
    );
    const newProcessedHeights = new Map(
      currentConsStateInArray.map(([height]) => [
        height,
        height.revisionHeight === newHeight.revisionHeight && height.revisionNumber === newHeight.revisionNumber
          ? getProcessedHeight(processedTimeNs)
          : (getHeightMapValue(currentClientDatumState.processedHeights, height) ?? 0n),
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
    if (stagedFinalization) {
      await this.requireLiveTendermintFinalizationInputs(hostStateUtxo, updateClientOperator.currentClientUtxo);
    }
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
          value: Buffer.from(await encodeConsensusStateValue(consensusState, this.lucidService.LucidImporter), 'hex'),
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

    const encodedNewClientDatum: string = await this.lucidService.encode<ClientDatum>(newClientDatum, 'client');
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    let unsignedTx: TxBuilder;
    if (stagedFinalization) {
      const encodedSpendClientRedeemer = encodeSpendMultitxClientRedeemer(
        {
          FinalizeUpdate: {
            sessionToken: stagedFinalization.datum.sessionToken,
          },
        },
        this.lucidService.LucidImporter,
      );
      const encodedSpendSessionRedeemer = encodeSpendSessionRedeemer('Finalize', this.lucidService.LucidImporter);
      const encodedBurnSessionRedeemer = encodeMintSessionRedeemer(
        {
          BurnSession: {
            tokenName: stagedFinalization.datum.sessionToken.name,
          },
        },
        this.lucidService.LucidImporter,
      );
      unsignedTx = this.lucidService.createUnsignedFinalizeTendermintSessionTransaction(
        hostStateUtxo,
        encodedHostStateRedeemer,
        updateClientOperator.currentClientUtxo,
        encodedSpendClientRedeemer,
        stagedFinalization.utxo,
        encodedSpendSessionRedeemer,
        encodedBurnSessionRedeemer,
        encodedUpdatedHostStateDatum,
        encodedNewClientDatum,
        updateClientOperator.clientTokenUnit,
        stagedFinalization.tokenUnit,
        stagedFinalization.signerKeyHash,
      );
    } else {
      const encodedSpendClientRedeemer = await this.lucidService.encode(spendClientRedeemer, 'spendClientRedeemer');
      unsignedTx = this.lucidService.createUnsignedUpdateClientTransaction(
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

    this.logger.log(
      `[DEBUG] Decoded HostState datum - version: ${hostStateDatum.state.version}, nft_policy: ${hostStateDatum.nft_policy.substring(0, 20)}...`,
    );

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

    const { newRoot, clientStateSiblings, consensusStateSiblings, commit } = computeRootWithCreateClientUpdate(
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
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedClientDatum = await this.lucidService.encode<ClientDatum>(clientDatum, 'client');

    this.logger.log(`[DEBUG] ==================== TRANSACTION CBOR VALUES ====================`);
    this.logger.log(`[DEBUG] Client token name: ${clientTokenName}`);
    this.logger.log(`[DEBUG] Client auth token unit: ${clientAuthTokenUnit}`);
    this.logger.log(`[DEBUG] Encoded mint client redeemer (CBOR): ${encodedMintClientRedeemer}`);
    this.logger.log(`[DEBUG] Encoded host state redeemer (CBOR): ${encodedHostStateRedeemer}`);
    this.logger.log(`[DEBUG] Encoded updated HostState datum (CBOR - FULL): ${encodedUpdatedHostStateDatum}`);
    this.logger.log(
      `[DEBUG] Encoded client datum (CBOR - first 200 chars): ${encodedClientDatum.substring(0, 200)}...`,
    );
    this.logger.log(
      `[DEBUG] Updated HostState datum next_client_sequence: ${updatedHostStateDatum.state.next_client_sequence}`,
    );
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
    return this.lucidService.generateTokenName(hostStateNFT, CLIENT_PREFIX, hostStateDatum.state.next_client_sequence);
  }
}
