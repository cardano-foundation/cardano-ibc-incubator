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
import { sumLovelaceFromUtxos } from './helper/helper';
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
	  getCurrentTree,
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
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { TxEventsService } from './tx-events.service';
import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txEventsService: TxEventsService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
  ) {}

  private toUtxoRef(utxo: UTxO | undefined): string {
    if (!utxo) return '<undefined>';
    return `${utxo.txHash}#${utxo.outputIndex}`;
  }

  private compareUtxoRef(a: UTxO, b: UTxO): number {
    const txHashA = a.txHash.toLowerCase();
    const txHashB = b.txHash.toLowerCase();
    if (txHashA < txHashB) return -1;
    if (txHashA > txHashB) return 1;
    return a.outputIndex - b.outputIndex;
  }

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

  /**
   * Best-effort mapping for ledger-style redeemer pointers like `Spend[0]`.
   *
   * The ledger indexes spending redeemers by the *position of the input* in the final
   * transaction body's `inputs` list (sorted lexicographically by txid then index).
   *
   * Before `.complete()` succeeds we cannot see the final inputs list (Lucid may add
   * extra wallet inputs during balancing), but we can still log the sorted order of
   * the inputs we explicitly provided via `.collectFrom()`.
   */
  private debugLogPredictedSpendIndex(
    context: string,
    spendInputs: Array<{ label: string; utxo: UTxO; validator: string }>,
  ): void {
    const sorted = [...spendInputs].sort((a, b) => this.compareUtxoRef(a.utxo, b.utxo));
    const rendered = sorted
      .map(
        (entry, index) =>
          `Spend[${index}] ${this.toUtxoRef(entry.utxo)} (${entry.label}:${entry.validator})`,
      )
      .join(', ');
    this.logger.log(`[DEBUG] ${context} predicted_spend_inputs_sorted: ${rendered}`);
  }

  /**
   * Decode a completed Lucid transaction and emit a compact summary that is
   * directly comparable with Ogmios "redeemer pointer" failures like:
   *   purpose=spend, index=0
   *
   * On Cardano, a spending redeemer pointer index refers to the index of the
   * input in the final transaction body inputs list. Lucid may reorder/add
   * wallet inputs during `.complete()`, so we log the *post-complete* ordering.
   */
  private debugLogCompletedTxSummary(
    context: string,
    completedUnsignedTx: { toCBOR(): string; toHash(): string },
    knownUtxos: Record<string, UTxO | undefined> = {},
  ): void {
    try {
      const unsignedTxCborHex = completedUnsignedTx.toCBOR();
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.logger.log(
        `[DEBUG] ${context} unsigned_tx hash=${unsignedTxHash} cbor_len=${unsignedTxCborHex.length} cbor_head=${unsignedTxCborHex.substring(0, 120)}`,
      );

      const { CML } = this.lucidService.LucidImporter;
      if (!CML?.Transaction?.from_cbor_hex) {
        this.logger.warn(`[DEBUG] ${context} cannot decode tx: LucidImporter.CML.Transaction unavailable`);
        return;
      }

      const parsedTx = CML.Transaction.from_cbor_hex(unsignedTxCborHex);
      const body = parsedTx.body();

      const knownByRef = new Map<string, string>();
      for (const [name, utxo] of Object.entries(knownUtxos)) {
        if (!utxo) continue;
        knownByRef.set(this.toUtxoRef(utxo), name);
      }

      const inputs = body.inputs();
      const inputRefs: string[] = [];
      for (let i = 0; i < inputs.len(); i += 1) {
        const input = inputs.get(i);
        const ref = `${input.transaction_id().to_hex()}#${input.index()}`;
        const label = knownByRef.get(ref);
        inputRefs.push(label ? `${ref} (${label})` : ref);
      }
      this.logger.log(`[DEBUG] ${context} inputs(${inputRefs.length}): ${inputRefs.join(', ')}`);

      const referenceInputs = body.reference_inputs();
      if (referenceInputs) {
        const refInputRefs: string[] = [];
        for (let i = 0; i < referenceInputs.len(); i += 1) {
          const input = referenceInputs.get(i);
          const ref = `${input.transaction_id().to_hex()}#${input.index()}`;
          const label = knownByRef.get(ref);
          refInputRefs.push(label ? `${ref} (${label})` : ref);
        }
        this.logger.log(
          `[DEBUG] ${context} reference_inputs(${refInputRefs.length}): ${refInputRefs.join(', ')}`,
        );
      }

      const witnessSet = parsedTx.witness_set();
      const redeemers = witnessSet.redeemers();
      if (!redeemers) {
        this.logger.log(`[DEBUG] ${context} redeemers: none`);
        return;
      }

      const redeemerLines: string[] = [];
      if (redeemers.kind() === CML.RedeemersKind.MapRedeemerKeyToRedeemerVal) {
        const redeemerMap = redeemers.as_map_redeemer_key_to_redeemer_val();
        const keys = redeemerMap.keys();
        for (let i = 0; i < keys.len(); i += 1) {
          const key = keys.get(i);
          const tag = key.tag();
          const index = Number(key.index());
          const tagName = (CML.RedeemerTag as any)[tag] ?? String(tag);
          const inputLabel =
            tag === CML.RedeemerTag.Spend
              ? inputRefs[index] ?? `<missing input for Spend[${index}]>`
              : undefined;
          redeemerLines.push(
            inputLabel ? `${tagName}[${index}] -> ${inputLabel}` : `${tagName}[${index}]`,
          );
        }
      } else {
        // Legacy redeemer format: still log the CBOR for later inspection.
        redeemerLines.push(`legacy_redeemers cbor_head=${redeemers.to_cbor_hex().substring(0, 120)}`);
      }
      this.logger.log(`[DEBUG] ${context} redeemers(${redeemerLines.length}): ${redeemerLines.join(', ')}`);

      const plutusDatums = witnessSet.plutus_datums();
      if (plutusDatums) {
        this.logger.log(`[DEBUG] ${context} plutus_datums(${plutusDatums.len()})`);
      }
    } catch (error) {
      this.logger.warn(`[DEBUG] ${context} failed to decode/log tx summary: ${inspect(error, { depth: 6 })}`);
    }
  }

  /**
   * Compute the new IBC state root for CreateConnection, plus the update witness
   * required by the on-chain HostState validator.
   */
  private computeRootWithCreateConnectionUpdate(
    oldRoot: string,
    connectionId: string,
    connectionEndValue: Buffer,
  ): { newRoot: string; connectionSiblings: string[]; commit: () => void } {
    const result = computeRootWithCreateConnectionUpdateHelper(oldRoot, connectionId, connectionEndValue);
    return { newRoot: result.newRoot, connectionSiblings: result.connectionSiblings, commit: result.commit };
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
      const { unsignedTx: unsignedConnectionOpenInitTx, connectionId, pendingTreeUpdate } = await this.buildUnsignedConnectionOpenInitTx(
        connectionOpenInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenInitTxValidTo: TxBuilder = unsignedConnectionOpenInitTx.validTo(validToTime);

      // DEBUG: emit CBOR and key inputs so we can reproduce Ogmios eval failures
      await this.refreshWalletContext(constructedAddress, 'connectionOpenInit');
      const completedUnsignedTx = await unsignedConnectionOpenInitTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      this.logger.log(
        `[DEBUG] connectionOpenInit unsigned CBOR len=${unsignedTxCbor.length}, head=${unsignedTxCbor.substring(0, 80)}`,
      );
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      // Register the pending in-memory tree update keyed by the finalized tx body hash.
      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

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
      const { unsignedTx: unsignedConnectionOpenTryTx, connectionId, pendingTreeUpdate } = await this.buildUnsignedConnectionOpenTryTx(
        connectionOpenTryOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenTryTxValidTo: TxBuilder = unsignedConnectionOpenTryTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      await this.refreshWalletContext(constructedAddress, 'connectionOpenTry');
      const completedUnsignedTx = await unsignedConnectionOpenTryTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

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
      const {
        unsignedTx: unsignedConnectionOpenAckTx,
        clientId,
        counterpartyClientId,
        hostStateUtxo,
        connectionUtxo,
        clientUtxo,
        pendingTreeUpdate,
      } =
        await this.buildUnsignedConnectionOpenAckTx(
        connectionOpenAckOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenAckTxValidTo: TxBuilder = unsignedConnectionOpenAckTx.validTo(validToTime);
      
      // DEBUG: `.complete()` asks the node to evaluate scripts to pick fees/execution units.
      // When it fails, we *won't* have a transaction body to decode, so we must log as
      // much as possible before calling it.
      //
      // Note: `rawConfig()` is best-effort only. Lucid can defer parts of the builder
      // until completion (fee balancing, implicit inputs, etc), so this may show
      // empty arrays even if `.collectFrom()` was already called.
      try {
        const deploymentConfig = this.configService.get('deployment');
        const raw = unsignedConnectionOpenAckTxValidTo.rawConfig();
        const knownByRef = new Map<string, string>([
          [this.toUtxoRef(hostStateUtxo), 'hostStateUtxo'],
          [this.toUtxoRef(connectionUtxo), 'connectionUtxo'],
          [this.toUtxoRef(clientUtxo), 'clientUtxo'],
        ]);
        const maybeRefScripts: Array<[string, UTxO | undefined]> = [
          ['refScript.hostStateStt', deploymentConfig.validators.hostStateStt?.refUtxo],
          ['refScript.spendConnection', deploymentConfig.validators.spendConnection?.refUtxo],
          ['refScript.verifyProof', deploymentConfig.validators.verifyProof?.refUtxo],
        ];
        for (const [name, utxo] of maybeRefScripts) {
          if (!utxo) continue;
          knownByRef.set(this.toUtxoRef(utxo), name);
        }
        const collected = raw.collectedInputs.map((u, i) => {
          const ref = this.toUtxoRef(u);
          const label = knownByRef.get(ref);
          return label ? `#${i} ${ref} (${label})` : `#${i} ${ref}`;
        });
        const reads = raw.readInputs.map((u, i) => {
          const ref = this.toUtxoRef(u);
          const label = knownByRef.get(ref);
          return label ? `#${i} ${ref} (${label})` : `#${i} ${ref}`;
        });
        this.logger.log(`[DEBUG] connectionOpenAck raw.collectedInputs(${collected.length}): ${collected.join(', ')}`);
        this.logger.log(`[DEBUG] connectionOpenAck raw.readInputs(${reads.length}): ${reads.join(', ')}`);
      } catch (e) {
        this.logger.warn(`[DEBUG] connectionOpenAck failed to read rawConfig: ${e}`);
      }

      // Return unsigned transaction for Hermes to sign
      // Use Ogmios evaluation by default so we can surface Aiken `trace` logs and
      // structured failure reasons when a script fails.
      //
      // If you need to fall back to local evaluation during debugging, switch this to:
      //   `.complete({ localUPLCEval: true })`
      await this.refreshWalletContext(constructedAddress, 'connectionOpenAck');
      const completedUnsignedTx = await unsignedConnectionOpenAckTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

      // DEBUG: emit CBOR and input/redeemer mapping so Ogmios failures like Spend[0]
      // can be mapped back to a specific UTxO / validator.
      this.debugLogCompletedTxSummary('connectionOpenAck', completedUnsignedTx, {
        hostStateUtxo,
        connectionUtxo,
        clientUtxo,
      });

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

      // DEBUG: Ogmios evaluation errors are often deeply nested and hard to scan in logs.
      // Print a compact summary if possible, before dumping the full object below.
      try {
        const failures = (error as any)?.data?.failures;
        if (Array.isArray(failures) && failures.length > 0) {
          const summary = failures
            .map((f: any) => `${f?.validator?.purpose ?? 'unknown'}[${f?.validator?.index ?? '?'}]`)
            .join(', ');
          this.logger.error(`[DEBUG] connectionOpenAck script_failures: ${summary}`);
        }
      } catch {
        // Best-effort debug logging only.
      }

      this.logger.error(error, 'connectionOpenAck');
      this.logger.error(`connectionOpenAck: ${error.stack}`);
      this.logger.error(`[DEBUG] connectionOpenAck error detail: ${inspect(error, { depth: 15 })}`);
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
        pendingTreeUpdate,
      } = await this.buildUnsignedConnectionOpenConfirmTx(
        connectionOpenConfirmOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedConnectionOpenConfirmTxValidTo: TxBuilder = unsignedConnectionOpenConfirmTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      await this.refreshWalletContext(constructedAddress, 'connectionOpenConfirm');
      const completedUnsignedTx = await unsignedConnectionOpenConfirmTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

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
  ): Promise<{ unsignedTx: TxBuilder; connectionId: string; pendingTreeUpdate: PendingTreeUpdate }> {
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

    const { newRoot, connectionSiblings, commit } = this.computeRootWithCreateConnectionUpdate(
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
    return { unsignedTx, connectionId, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
  }

  /* istanbul ignore next */
  public async buildUnsignedConnectionOpenTryTx(
    connectionOpenTryOperator: ConnectionOpenTryOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; connectionId: string; pendingTreeUpdate: PendingTreeUpdate }> {
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

    const { newRoot, connectionSiblings, commit } = this.computeRootWithCreateConnectionUpdate(
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
    return { unsignedTx, connectionId, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
  }

  private async buildUnsignedConnectionOpenAckTx(
    connectionOpenAckOperator: ConnectionOpenAckOperator,
    constructedAddress: string,
  ): Promise<{
    unsignedTx: TxBuilder;
    clientId: string;
    counterpartyClientId: string;
    hostStateUtxo: UTxO;
    connectionUtxo: UTxO;
    clientUtxo: UTxO;
    pendingTreeUpdate: PendingTreeUpdate;
	  }> {
    const deploymentConfig = this.configService.get('deployment');
    const expectedHostStateAddress = deploymentConfig.validators.hostStateStt.address;
    const expectedConnectionAddress = deploymentConfig.validators.spendConnection.address;
    const hostStateNftUnit = deploymentConfig.hostStateNFT.policyId + deploymentConfig.hostStateNFT.name;

    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    const hostStateHasNft = (hostStateUtxo.assets?.[hostStateNftUnit] ?? 0n) > 0n;
    this.logger.log(
      `[DEBUG] ConnOpenAck hostStateUtxo=${this.toUtxoRef(hostStateUtxo)} addr_ok=${hostStateUtxo.address === expectedHostStateAddress} nft_ok=${hostStateHasNft}`,
    );
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum!,
      'host_state',
    );

	    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing a witness.
	    this.logger.log(
	      `[DEBUG] ConnOpenAck on_chain_ibc_state_root=${hostStateDatum.state.ibc_state_root.substring(0, 32)}...`,
	    );
	    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
	    const treeRootAfterAlign = getCurrentTree().getRoot();
	    this.logger.log(
	      `[DEBUG] ConnOpenAck tree_root_after_align=${treeRootAfterAlign.substring(0, 32)}... matches_on_chain=${treeRootAfterAlign === hostStateDatum.state.ibc_state_root}`,
	    );

    // Get the token unit associated with the client
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      BigInt(connectionOpenAckOperator.connectionSequence),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    this.logger.log(
      `[DEBUG] ConnOpenAck connectionUtxo=${this.toUtxoRef(connectionUtxo)} addr_ok=${connectionUtxo.address === expectedConnectionAddress} unit=${connectionTokenUnit}`,
    );
    this.debugLogPredictedSpendIndex('ConnOpenAck', [
      { label: 'hostStateUtxo', utxo: hostStateUtxo, validator: 'host_state_stt' },
      { label: 'connectionUtxo', utxo: connectionUtxo, validator: 'spend_connection' },
    ]);
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
    this.logger.log(
      `[DEBUG] ConnOpenAck connection input state=${connectionDatum.state.state} token_policy=${connectionDatum.token.policyId} token_name=${connectionDatum.token.name}`,
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
	    const connectionKey = `connections/${connectionId}`;
	    const treeOldConnectionValue = getCurrentTree().get(connectionKey);
	    const oldConnectionEndValue = Buffer.from(
	      await encodeConnectionEndValue(connectionDatum.state, this.lucidService.LucidImporter),
	      'hex',
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness key=${connectionKey} tree_old_value_len=${treeOldConnectionValue?.length ?? 0} input_old_value_len=${oldConnectionEndValue.length} tree_old_equals_input_old=${treeOldConnectionValue ? treeOldConnectionValue.equals(oldConnectionEndValue) : false}`,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness old_value_from_tree=${treeOldConnectionValue?.toString('hex') ?? '<missing>'}`,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness old_value_from_input_datum=${oldConnectionEndValue.toString('hex')}`,
	    );
	    const updatedConnectionEndValue = Buffer.from(
	      await encodeConnectionEndValue(updatedConnectionDatum.state, this.lucidService.LucidImporter),
	      'hex',
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness new_value=${updatedConnectionEndValue.toString('hex')}`,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck connection_end_value_len=${updatedConnectionEndValue.length} connection_id=${connectionId}`,
	    );
	    const { newRoot, connectionSiblings, commit } = this.computeRootWithCreateConnectionUpdate(
	      hostStateDatum.state.ibc_state_root,
	      connectionId,
	      updatedConnectionEndValue,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck computed_new_root=${newRoot.substring(0, 32)}... siblings_len=${connectionSiblings.length}`,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness old_root=${hostStateDatum.state.ibc_state_root} new_root=${newRoot}`,
	    );
	    this.logger.log(
	      `[DEBUG] ConnOpenAck root_witness siblings=${connectionSiblings.join(',')}`,
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
    this.logger.log(`[DEBUG] ConnOpenAck clientUtxo(ref only)=${this.toUtxoRef(clientUtxo)} unit=${clientTokenUnit}`);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, connectionOpenAckOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${connectionOpenAckOperator.proofHeight.revisionNumber}/${connectionOpenAckOperator.proofHeight.revisionHeight}`,
      );
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
    this.logger.log(
      `[DEBUG] ConnOpenAck encoded_host_state_redeemer head=${encodedHostStateRedeemer.substring(0, 16)} len=${encodedHostStateRedeemer.length}`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenAck encoded_spend_connection_redeemer head=${encodedSpendConnectionRedeemer.substring(0, 16)} len=${encodedSpendConnectionRedeemer.length}`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenAck encoded_updated_host_state_datum head=${encodedUpdatedHostStateDatum.substring(0, 16)} len=${encodedUpdatedHostStateDatum.length}`,
    );
    this.logger.log(
      `[DEBUG] ConnOpenAck encoded_updated_connection_datum head=${encodedUpdatedConnectionDatum.substring(0, 16)} len=${encodedUpdatedConnectionDatum.length}`,
    );

    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    this.logger.log(`[DEBUG] ConnOpenAck verifyProofPolicyId=${verifyProofPolicyId}`);
    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) =>
        key.revisionNumber === connectionOpenAckOperator.proofHeight.revisionNumber &&
        key.revisionHeight === connectionOpenAckOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      const available = heightsArray
        .slice(0, 8)
        .map((h) => `${h.revisionNumber}/${h.revisionHeight}`)
        .join(', ');
      throw new GrpcInternalException(
        `Missing consensus state at proof height ${connectionOpenAckOperator.proofHeight.revisionNumber}/${connectionOpenAckOperator.proofHeight.revisionHeight}. Available heights: ${available}${heightsArray.length > 8 ? ', ...' : ''}`,
      );
    }
    const consensusState = consensusEntry[1];
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

    const firstExist = (proof: any) => {
      for (const p of proof?.proofs ?? []) {
        const inner = p?.proof;
        if (inner?.CommitmentProof_Exist?.exist) return inner.CommitmentProof_Exist.exist;
      }
      return undefined;
    };

    let proofClientStateTypeUrl = connectionOpenAckOperator.counterpartyClientStateTypeUrl;
    const proofClientExist = firstExist(connectionOpenAckOperator.proofClient as any);
    if (proofClientExist?.value) {
      try {
        const proofClientAny = Any.decode(Buffer.from(proofClientExist.value, 'hex'));
        if (proofClientAny.type_url) {
          proofClientStateTypeUrl = proofClientAny.type_url;
        }
      } catch (error) {
        this.logger.warn(`[DEBUG] ConnOpenAck failed to decode proof client Any type_url: ${error}`);
      }
    }

    const mithrilClientState: MithrilClientState = getMithrilClientStateForVerifyProofRedeemer(
      connectionOpenAckOperator.counterpartyClientState,
    );
    const mithrilClientStateAny: Any = {
      type_url: proofClientStateTypeUrl,
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
      const expectedConnValueBuf = Buffer.from(expectedConnValue);
      const expectedClientValueBuf = Buffer.from(expectedClientValue);

      const tryExist = firstExist(connectionOpenAckOperator.proofTry as any);
      if (tryExist?.key && tryExist?.value) {
        const keyUtf8 = Buffer.from(tryExist.key, 'hex').toString('utf8');
        const valueBytes = Buffer.from(tryExist.value, 'hex');
        const decoded = ConnectionEnd.decode(valueBytes);
        this.logger.log(
          `[DEBUG] ConnOpenAck proof_try: key='${keyUtf8}', expected='${expectedConnKeyUtf8}', value_len=${valueBytes.length}, expected_len=${expectedConnValue.length}, decoded_state=${decoded.state}`,
        );
        this.logger.log(
          `[DEBUG] ConnOpenAck proof_try_value_matches_expected=${valueBytes.equals(expectedConnValueBuf)}`,
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
        this.logger.log(
          `[DEBUG] ConnOpenAck proof_client_value_matches_expected=${valueBytes.equals(expectedClientValueBuf)}`,
        );
      }
    } catch (e) {
      this.logger.warn(`[DEBUG] ConnOpenAck proof debug failed: ${e}`);
    }

    const delayBlockPeriod = getBlockDelay(updatedConnectionDatum.state.delay_period);
    this.logger.log(
      `[DEBUG] ConnOpenAck delay_period(ns)=${updatedConnectionDatum.state.delay_period} delay_block_period=${delayBlockPeriod} proof_height=${connectionOpenAckOperator.proofHeight.revisionNumber}/${connectionOpenAckOperator.proofHeight.revisionHeight}`,
    );

    const verifyProofRedeemer: VerifyProofRedeemer = {
      BatchVerifyMembership: [
        [
          {
            cs: clientDatum.state.clientState,
            cons_state: consensusState,
            height: connectionOpenAckOperator.proofHeight,
            delay_time_period: updatedConnectionDatum.state.delay_period,
            delay_block_period: delayBlockPeriod,
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
            delay_block_period: delayBlockPeriod,
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
    this.logger.log(
      `[DEBUG] ConnOpenAck encoded_verify_proof_redeemer head=${encodedVerifyProofRedeemer.substring(0, 16)} len=${encodedVerifyProofRedeemer.length}`,
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
    return {
      unsignedTx,
      clientId,
      counterpartyClientId,
      hostStateUtxo,
      connectionUtxo,
      clientUtxo,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
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
    pendingTreeUpdate: PendingTreeUpdate;
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
    const { newRoot, connectionSiblings, commit } = this.computeRootWithCreateConnectionUpdate(
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
    return {
      unsignedTx,
      clientId,
      counterpartyClientId,
      counterpartyConnectionId,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
  }
}
