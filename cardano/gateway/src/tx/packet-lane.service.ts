import { PacketInputsBusyError } from './tx-input-reservations';
import { consensusHistoryWitnessSchema } from '../shared/types/consensus-state-datum';
import { HISTORY_SERVICE, type HistoryService } from '../query/services/history.service';
import { PacketStateService } from '../query/services/packet-state.service';
import { DenomTraceService } from '../query/services/denom-trace.service';
import { buildVoucherCip68Metadata, encodeVoucherCip68MetadataDatum } from '../shared/helpers/cip68-voucher-metadata';
import {
  buildIbcDenomHashFromFullDenom,
  buildVoucherDenomHashFromFullDenom,
  buildVoucherReferenceTokenNameFromFullDenom,
} from '../shared/helpers/voucher-asset';
import { splitFullDenomTrace } from '../shared/helpers/denom-trace';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Constr, Data, Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import {
  buildTransferIntent,
  buildPacketSendBatch,
  buildPacketBalanceCompaction,
  buildPacketLaneInitialization,
  buildPacketPrune,
  usableTransferIntent,
  selectPacketLiquidity,
  buildPacketAcknowledgement,
  buildPacketTimeout,
  buildPacketTimeoutOnClose,
  buildPacketRejection,
  buildPacketReceive,
  record,
  variant,
  encode,
  localAssetUnit,
  voucherTokenName,
  type PacketLaneDeployment,
} from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import type { Packet } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import type {
  MsgTransfer,
  MsgRecvPacket,
  MsgAcknowledgement,
  MsgTimeout,
  MsgTimeoutOnClose,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import type { Height } from '@cardano-ibc/proto-types/build/ibc/core/client/v1/client';
import type { DeploymentConfig } from '../config/bridge-manifest';
import type { ChannelDatum } from '../shared/types/channel/channel-datum';
import type { ConnectionDatum } from '../shared/types/connection/connection-datum';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { parseClientSequence, parseConnectionSequence } from '../shared/helpers/sequence';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { TRANSACTION_TIME_TO_LIVE } from '../config/constant.config';
import { TxOperationRunnerService } from './tx-operation-runner.service';
import { validateAndFormatSendPacketParams } from './helper/packet.validate';

export type BuildPacketBatchRequest = { signer: string; port_id: string; channel_id: string; intent_tx_hash?: string };
export type BuildPacketBatchResponse = {
  stage: string;
  unsigned_tx?: { type_url: string; value: Uint8Array };
  intent_tx_hashes: string[];
  included_tx_hash?: string;
};

@Injectable()
export class PacketLaneService {
  private readonly logger = new Logger(PacketLaneService.name);
  private readonly deferredIntents = new Map<string, number>();
  private readonly intentCursor = new Map<string, Pick<UTxO, 'txHash' | 'outputIndex'>>();
  constructor(
    private readonly config: ConfigService,
    private readonly lucid: LucidService,
    private readonly runner: TxOperationRunnerService,
    private readonly traces: DenomTraceService,
    private readonly packetState: PacketStateService,
    @Inject(HISTORY_SERVICE) private readonly history: HistoryService,
  ) {}

  async deployment(channelId: string): Promise<PacketLaneDeployment> {
    if (!/^channel-(0|[1-9][0-9]*)$/.test(channelId)) throw new Error('Invalid channel identifier');
    const manifest = this.config.getOrThrow<DeploymentConfig>('deployment');
    const config = manifest.packetState;
    const channel = await this.lucid.findUtxoByUnit(
      this.lucid.getChannelTokenUnit(BigInt(channelId.slice(8))).join(''),
    );
    const datum = await this.lucid.decodeDatum<ChannelDatum>(channel.datum!, 'channel');
    const connection = await this.lucid.findUtxoByUnit(
      this.lucid
        .getConnectionTokenUnit(
          parseConnectionSequence(this.lucid.LucidImporter.toText(datum.state.channel.connection_hops[0])),
        )
        .join(''),
    );
    const connectionDatum = await this.lucid.decodeDatum<ConnectionDatum>(connection.datum!, 'connection');
    const client = await this.lucid.findUtxoByUnit(
      this.lucid.getClientTokenUnit(
        parseClientSequence(this.lucid.LucidImporter.toText(connectionDatum.state.client_id)),
      ),
    );
    const scripts = await this.lucid.lucid.utxosByOutRef([
      config.state.refUtxo,
      config.batch.refUtxo,
      config.guard.refUtxo,
      manifest.validators.mintVoucher.refUtxo,
    ]);
    if (scripts.length !== 4) throw new Error('Packet script references unavailable');
    scripts.push(await this.lucid.findUtxoByUnit(config.configToken.policyId + config.configToken.name));
    scripts.push(await this.lucid.findUtxoByUnit(manifest.hostStateNFT.policyId + manifest.hostStateNFT.name));
    const operations: PacketLaneDeployment['operations'] = {};
    const operationRefs = await this.lucid.lucid.utxosByOutRef(Object.values(config.operations).map((v) => v.refUtxo));
    for (const [name, validator] of Object.entries(config.operations)) {
      const reference = operationRefs.find(
        (u) => u.txHash === validator.refUtxo.txHash && u.outputIndex === validator.refUtxo.outputIndex,
      );
      if (!reference) throw new Error(`Missing packet operation reference: ${name}`);
      operations[name] = { policy: validator.scriptHash, reference };
    }
    const verifier = manifest.validators.verifyProof;
    const [proofReference] = await this.lucid.lucid.utxosByOutRef([verifier.refUtxo]);
    if (!proofReference) throw new Error('Missing packet proof verifier reference');
    return {
      operations,
      proofVerifier: { policy: verifier.scriptHash, reference: proofReference },
      voucherPolicy: manifest.validators.mintVoucher.scriptHash,
      batchPolicy: config.batch.scriptHash,
      batchAddress: config.batch.address!,
      guardAddress: config.guard.address!,
      statePolicy: config.state.scriptHash,
      laneCount: config.laneCount,
      channel,
      connection,
      client,
      scripts,
    };
  }

  private async complete(
    signer: string,
    name: string,
    build: (from: number, to: number) => Promise<TxBuilder | { tx: TxBuilder; inputs?: UTxO[]; input?: UTxO }>,
  ) {
    if (!signer) throw new Error('Signer address required');
    const network = this.config.getOrThrow<Network>('cardanoNetwork');
    const clock = this.lucid.LucidImporter.SLOT_CONFIG_NETWORK[network];
    const window = await computeLedgerAnchoredValidityWindow(
      this.config.getOrThrow('ogmiosEndpoint'),
      clock,
      TRANSACTION_TIME_TO_LIVE,
    );
    // Build and complete under the same wallet lock. Concurrent admissions must
    // never inherit another request's wallet selection.
    const result = await this.runner.runChain({
      operationName: name,
      ...(name !== 'transferIntent'
        ? { reservation: { now: window.validFromTime, expiresAt: window.validToTime } }
        : {}),
      wallet: { mode: 'refresh_from_address', address: signer, context: name },
      build: async (scope) => {
        const built = await build(window.validFromTime, window.validToTime);
        return scope.complete({
          operationName: name,
          requireWalletInput: true,
          unsignedTx: 'tx' in built ? built.tx : built,
          spendingInputs: 'tx' in built ? (built.inputs ?? (built.input ? [built.input] : undefined)) : undefined,
          validity: { apply: (tx) => tx.validFrom(window.validFromTime).validTo(window.validToTime) },
        });
      },
    });
    return { type_url: '', value: result.value.unsignedTxBytes };
  }

  async admit(request: MsgTransfer) {
    const operator = validateAndFormatSendPacketParams(request);
    if (
      operator.sourcePort !== 'transfer' ||
      operator.timeoutHeight.revisionHeight !== 0n ||
      operator.timeoutHeight.revisionNumber !== 0n
    ) {
      throw new Error('Transfer intents require transfer port and timestamp timeout');
    }
    const deployment = await this.deployment(operator.sourceChannel);
    let denom = operator.token.denom;
    if (denom.startsWith('ibc/')) {
      const trace = await this.traces.findByIbcDenomHash(denom.slice(4));
      if (!trace) throw new Error('Unknown IBC denomination');
      denom = trace.path ? `${trace.path}/${trace.base_denom}` : trace.base_denom;
    } else if (deployment.voucherPolicy && denom.startsWith(deployment.voucherPolicy)) {
      const trace = await this.traces.findByHash(denom.slice(64));
      if (!trace) throw new Error('Unknown voucher denomination');
      denom = trace.path ? `${trace.path}/${trace.base_denom}` : trace.base_denom;
    }
    if (denom === 'lovelace') denom = this.lucid.LucidImporter.fromText(denom);
    const unsigned_tx = await this.complete(operator.signer, 'transferIntent', async () =>
      buildTransferIntent(this.lucid.lucid, deployment, {
        amount: operator.token.amount,
        assetUnit: localAssetUnit(denom, deployment),
        fullDenom: denom,
        receiver: operator.receiver,
        timeoutTimestamp: operator.timeoutTimestamp,
        memo: operator.memo,
      }),
    );
    return { result: 0, unsigned_tx };
  }

  private async initialize(request: Pick<BuildPacketBatchRequest, 'signer' | 'channel_id'>) {
    const config = this.config.getOrThrow<DeploymentConfig>('deployment').packetState;
    const { Data } = this.lucid.LucidImporter;
    const registry = await this.lucid.findUtxoByUnit(
      config.state.scriptHash + this.lucid.LucidImporter.fromText('ibc_packet_registry'),
    );
    const nextChannel = (Data.from(registry.datum!) as Constr<Data>).fields[0] as bigint;
    const requestedChannel = BigInt(request.channel_id.slice(8));
    if (nextChannel <= requestedChannel) {
      const pending = await this.deployment(`channel-${nextChannel}`);
      const configuration = await this.lucid.findUtxoByUnit(config.configToken.policyId + config.configToken.name);
      return await this.complete(request.signer, 'initializePacketLanes', async () =>
        buildPacketLaneInitialization(
          this.lucid.lucid,
          {
            ...pending,
            scripts: pending.scripts.filter(
              (u) => u.txHash !== configuration.txHash || u.outputIndex !== configuration.outputIndex,
            ),
          },
          configuration,
          config.state.address!,
        ),
      );
    }
    return undefined;
  }

  async intentStatus(channelId: string, hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid intent transaction hash');
    const deployment = await this.deployment(channelId);
    const pending = (await this.lucid.lucid.utxosAt(deployment.guardAddress)).some((u) => u.txHash === hash);
    if (pending) return { stage: 'funded' as const };
    const consuming = await this.history.findIntentSpendingTransaction(hash, deployment.guardAddress);
    if (!consuming) return { stage: 'pending' as const };
    const events = await this.packetState.events(consuming.txHash);
    const event = events.find(
      (event) =>
        event.type === 'send_packet' &&
        event.event_attribute.some((attribute) => attribute.key === 'intent_tx_hash' && attribute.value === hash),
    );
    if (!event) return { stage: 'cancelled' as const };
    return {
      stage: 'sent' as const,
      packetTxHash: consuming.txHash,
      packetSequence: event.event_attribute.find((attribute) => attribute.key === 'packet_sequence')!.value,
    };
  }

  async batch(request: BuildPacketBatchRequest): Promise<BuildPacketBatchResponse> {
    if (request.port_id !== 'transfer') throw new Error('Expected transfer port');
    const deployment = await this.deployment(request.channel_id);
    const { Data, Constr, fromText } = this.lucid.LucidImporter;
    const now = Date.now();
    for (const [ref, until] of this.deferredIntents) if (until <= now) this.deferredIntents.delete(ref);
    const ref = (input: UTxO) => `${input.txHash}#${input.outputIndex}`;
    const pending = (await this.lucid.lucid.utxosAt(deployment.guardAddress))
      .filter((input) => {
        if (!input.datum) return false;
        let datum: Data;
        try {
          datum = Data.from(input.datum);
        } catch {
          return false;
        }
        return (
          datum instanceof Constr &&
          datum.index === 0 &&
          datum.fields.length === 5 &&
          datum.fields[0] === fromText(request.port_id) &&
          datum.fields[1] === fromText(request.channel_id)
        );
      })
      .filter((input) => usableTransferIntent(input, deployment, 0))
      .sort((a, b) => a.txHash.localeCompare(b.txHash) || a.outputIndex - b.outputIndex);
    if (request.intent_tx_hash && !pending.some((input) => input.txHash === request.intent_tx_hash)) {
      const consuming = await this.history.findIntentSpendingTransaction(
        request.intent_tx_hash,
        deployment.guardAddress,
      );
      if (!consuming)
        throw new Error(
          'Funded intent is not available in canonical indexed state. Retry after inclusion or rollback recovery',
        );
      const events = await this.packetState.events(consuming.txHash);
      if (!events.some((event) => event.type === 'send_packet'))
        throw new Error('Funded intent was cancelled without sending a packet');
      return { stage: 'included', intent_tx_hashes: [request.intent_tx_hash], included_tx_hash: consuming.txHash };
    }
    if (!request.intent_tx_hash) {
      const cursor = this.intentCursor.get(request.channel_id);
      if (cursor) {
        const next = pending.findIndex(
          (input) =>
            input.txHash.localeCompare(cursor.txHash) > 0 ||
            (input.txHash === cursor.txHash && input.outputIndex > cursor.outputIndex),
        );
        if (next > 0) pending.push(...pending.splice(0, next));
      }
    }
    // Always include the caller's funded request. The signer binds authorization
    // to this input even when another builder selected earlier requests.
    if (request.intent_tx_hash)
      pending.sort((a, b) => Number(b.txHash === request.intent_tx_hash) - Number(a.txHash === request.intent_tx_hash));
    if (!pending.length) {
      this.intentCursor.delete(request.channel_id);
      return { stage: 'idle', intent_tx_hashes: [] };
    }
    const initialization = await this.initialize(request);
    if (initialization)
      return { stage: 'initialize', intent_tx_hashes: [pending[0].txHash], unsigned_tx: initialization };
    let intents: UTxO[] = [];
    let noWork = false;
    // Populated lanes or large payloads can make a two-intent transaction exceed
    // ledger limits. Evaluate it, then retry a single funded request if needed.
    const build = (limit: number) =>
      this.complete(request.signer, 'packetBatch', async (from, to) => {
        intents = pending
          .filter(
            (input) =>
              (request.intent_tx_hash || !this.deferredIntents.has(ref(input))) &&
              usableTransferIntent(input, deployment, to),
          )
          .slice(0, limit);
        noWork = !intents.length;
        if (
          !intents.length ||
          (request.intent_tx_hash && !intents.some((input) => input.txHash === request.intent_tx_hash))
        ) {
          throw new Error('Requested intent is expired or cannot fund its declared transfer');
        }
        return await buildPacketSendBatch(this.lucid.lucid, deployment, intents, from, to);
      });
    // A well-shaped datum can still be unusable against current lane state.
    // Bound evaluation work, defer a failing single request, and try the next
    // candidate so an attacker cannot pin the head of a channel's queue.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        let unsigned_tx;
        try {
          unsigned_tx = await build(2);
        } catch (error) {
          if (error instanceof PacketInputsBusyError || intents.length < 2) throw error;
          unsigned_tx = await build(1);
        }
        if (!request.intent_tx_hash) this.intentCursor.set(request.channel_id, intents[intents.length - 1]);
        return { stage: 'send', intent_tx_hashes: intents.map((u) => u.txHash), unsigned_tx };
      } catch (error) {
        if (request.intent_tx_hash || error instanceof PacketInputsBusyError) throw error;
        if (noWork) return { stage: 'idle', intent_tx_hashes: [] };
        if (!intents.length || !/(script|validator|capacity|exceeds|budget|invalid intent)/i.test(String(error)))
          throw error;
        this.intentCursor.set(request.channel_id, intents[0]);
        this.logger.warn(`Deferring intent ${ref(intents[0])}: ${String(error).slice(0, 300)}`);
        this.deferredIntents.set(ref(intents[0]), Date.now() + 30_000);
      }
    }
    return { stage: 'idle', intent_tx_hashes: [] };
  }

  private packet(packet: Packet): Constr<Data> {
    const { fromText, toHex } = this.lucid.LucidImporter;
    return record(
      packet.sequence,
      ...[packet.source_port, packet.source_channel, packet.destination_port, packet.destination_channel].map(fromText),
      toHex(packet.data),
      record(packet.timeout_height?.revision_number ?? 0n, packet.timeout_height?.revision_height ?? 0n),
      packet.timeout_timestamp,
    );
  }

  private proof(bytes: Uint8Array): Constr<Data> {
    const proof = MerkleProof.decode(bytes);
    const hex = (value?: Uint8Array) => Buffer.from(value ?? []).toString('hex');
    const existence = (value: (typeof proof.proofs)[number]['exist']) =>
      record(
        hex(value?.key),
        hex(value?.value),
        record(
          BigInt(value?.leaf?.hash ?? 0),
          BigInt(value?.leaf?.prehash_key ?? 0),
          BigInt(value?.leaf?.prehash_value ?? 0),
          BigInt(value?.leaf?.length ?? 0),
          hex(value?.leaf?.prefix),
        ),
        (value?.path ?? []).map((step) => record(BigInt(step.hash), hex(step.prefix), hex(step.suffix))),
      );
    return record(
      proof.proofs.map((p) =>
        record(
          p.exist
            ? variant(0, existence(p.exist))
            : p.nonexist
              ? variant(1, record(hex(p.nonexist.key), existence(p.nonexist.left), existence(p.nonexist.right)))
              : (() => {
                  throw new Error('Unsupported commitment proof');
                })(),
        ),
      ),
    );
  }

  async compactBalances(
    request: import('@cardano-ibc/proto-types/build/ibc/cardano/v1/tx').CompactPacketBalancesRequest,
  ) {
    const leftDenoms = request.left_denoms ?? [];
    if (request.port_id !== 'transfer' || leftDenoms.length > 8)
      throw new Error('Invalid packet accounting compaction request');
    const deployment = await this.deployment(request.channel_id);
    return {
      unsigned_tx: await this.complete(
        request.signer,
        'compactPacketBalances',
        async () =>
          await buildPacketBalanceCompaction(
            this.lucid.lucid,
            deployment,
            request.left_lane ?? 0,
            request.right_lane ?? 0,
            leftDenoms.length ? leftDenoms : undefined,
          ),
      ),
    };
  }

  private async liquidity(
    deployment: PacketLaneDeployment,
    port: string,
    channel: string,
    denom: string,
    amount: bigint,
    sequence: bigint,
  ) {
    return selectPacketLiquidity(
      await this.lucid.lucid.utxosAt(deployment.batchAddress),
      deployment,
      port,
      channel,
      denom,
      amount,
      sequence,
    );
  }

  async prune(request: import('@cardano-ibc/proto-types/build/ibc/cardano/v1/tx').MsgPrunePacketHistory) {
    if (request.port_id !== 'transfer' || request.sequence < 1n || !request.proof_height)
      throw new Error('Invalid packet pruning request');
    const deployment = await this.deployment(request.channel_id);
    const height = request.proof_height;
    const resolved = await this.lucid.resolveClientAtHeights(deployment.client, [
      { revisionNumber: height.revision_number, revisionHeight: height.revision_height },
    ]);
    deployment.client = resolved.clientUtxo;
    if (resolved.historyWitnesses[0]) {
      const { Data } = this.lucid.LucidImporter;
      deployment.historyWitness = Data.from(
        Data.to(
          resolved.historyWitnesses[0] as never,
          consensusHistoryWitnessSchema(this.lucid.LucidImporter) as never,
        ),
      );
    }
    return {
      unsigned_tx: await this.complete(
        request.signer,
        'prunePacketLane',
        async (from, to) =>
          await buildPacketPrune(
            this.lucid.lucid,
            deployment,
            request.sequence,
            record(height.revision_number, height.revision_height),
            this.proof(request.proof_commitment_absence),
            from,
            to,
          ),
      ),
    };
  }

  async settle(
    request: MsgRecvPacket | MsgAcknowledgement | MsgTimeout | MsgTimeoutOnClose,
    kind: 'receive' | 'acknowledge' | 'timeout',
  ) {
    const p = request.packet;
    const incoming = kind === 'receive';
    const channel = incoming ? p.destination_channel : p.source_channel;
    const port = incoming ? p.destination_port : p.source_port;
    if (incoming) {
      const initialization = await this.initialize({ signer: request.signer, channel_id: channel });
      if (initialization)
        return { result: 0, unsigned_tx: { ...initialization, type_url: '/ibc.cardano.v1.InitializePacketLanes' } };
    }
    const deployment = await this.deployment(channel);
    const packet = this.packet(p);
    const proofHeight = request.proof_height as Height;
    const resolved = await this.lucid.resolveClientAtHeights(deployment.client, [
      { revisionNumber: proofHeight.revision_number, revisionHeight: proofHeight.revision_height },
    ]);
    deployment.client = resolved.clientUtxo;
    if (resolved.historyWitnesses[0]) {
      const { Data } = this.lucid.LucidImporter;
      deployment.historyWitness = Data.from(
        Data.to(
          resolved.historyWitnesses[0] as never,
          consensusHistoryWitnessSchema(this.lucid.LucidImporter) as never,
        ),
      );
    }
    const height = record(proofHeight.revision_number, proofHeight.revision_height);
    const proof = this.proof(
      kind === 'receive'
        ? (request as MsgRecvPacket).proof_commitment
        : kind === 'timeout'
          ? (request as MsgTimeout).proof_unreceived
          : (request as MsgAcknowledgement).proof_acked,
    );
    const data = JSON.parse(Buffer.from(p.data).toString('utf8'));
    const ack =
      kind === 'acknowledge'
        ? JSON.parse(Buffer.from((request as MsgAcknowledgement).acknowledgement).toString('utf8'))
        : undefined;
    const prefix = `${p.source_port}/${p.source_channel}/`;
    const denom = incoming && data.denom.startsWith(prefix) ? data.denom.slice(prefix.length) : data.denom;
    const voucherDenom =
      incoming && !data.denom.startsWith(prefix)
        ? `${port}/${channel}/${data.denom}`
        : !incoming && (kind === 'timeout' || ack?.error) && data.denom.startsWith(`${port}/${channel}/`)
          ? data.denom
          : undefined;
    const liquidity =
      !voucherDenom && (kind !== 'acknowledge' || ack?.error)
        ? await this.liquidity(deployment, port, channel, denom, BigInt(data.amount), p.sequence)
        : [];
    const unsigned_tx = await this.complete(request.signer, `packet${kind}`, async (from, to) => {
      let built: Awaited<ReturnType<typeof buildPacketAcknowledgement>>;
      if (kind === 'receive')
        built = await buildPacketReceive(this.lucid.lucid, deployment, packet, height, proof, liquidity, from, to);
      else if (kind === 'timeout' && 'proof_close' in request)
        built = await buildPacketTimeoutOnClose(
          this.lucid.lucid,
          deployment,
          packet,
          height,
          proof,
          this.proof(request.proof_close),
          liquidity,
          from,
          to,
        );
      else if (kind === 'timeout')
        built = await buildPacketTimeout(this.lucid.lucid, deployment, packet, height, proof, liquidity, from, to);
      else if (ack?.error)
        built = await buildPacketRejection(
          this.lucid.lucid,
          deployment,
          packet,
          height,
          proof,
          liquidity,
          ack.error,
          from,
          to,
        );
      else {
        if (ack?.result !== 'AQ==') throw new Error('Unsupported transfer acknowledgement');
        built = await buildPacketAcknowledgement(this.lucid.lucid, deployment, packet, height, proof, from, to);
      }
      const tx = built.tx;
      if (voucherDenom) {
        const update = await this.traces.prepareOnChainInsert(
          buildVoucherDenomHashFromFullDenom(voucherDenom),
          voucherDenom,
        );
        this.lucid.applyTraceRegistryUpdate(tx, { traceRegistryUpdate: update });
        if (update.kind !== 'existing') {
          const trace = splitFullDenomTrace(voucherDenom);
          const metadata = buildVoucherCip68Metadata({
            path: trace.path,
            baseDenom: trace.baseDenom,
            fullDenom: voucherDenom,
            voucherTokenName: voucherTokenName(voucherDenom),
            voucherPolicyId: deployment.voucherPolicy!,
            ibcDenomHash: buildIbcDenomHashFromFullDenom(voucherDenom),
          });
          const unit = deployment.voucherPolicy! + buildVoucherReferenceTokenNameFromFullDenom(voucherDenom);
          const address = this.config.getOrThrow<DeploymentConfig>('deployment').validators.voucherMetadata!.address;
          tx.mintAssets({ [unit]: 1n }, encode(variant(4))).pay.ToContract(
            address,
            { kind: 'inline', value: encodeVoucherCip68MetadataDatum(metadata, this.lucid.LucidImporter) },
            { [unit]: 1n },
          );
        }
      }
      return { tx, inputs: [built.input, ...liquidity] };
    });
    return { result: 0, unsigned_tx };
  }
}
