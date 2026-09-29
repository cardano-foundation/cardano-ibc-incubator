import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cbor, LazyCborArray } from '@harmoniclabs/cbor';
import { blake2b } from '@noble/hashes/blake2b';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import {
  BlockFetchClient,
  BlockFetchNoBlocks,
  ChainPoint,
  HandshakeAcceptVersion,
  HandshakeClient,
  Multiplexer,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import type { SocketLike } from '@harmoniclabs/ouroboros-miniprotocols-ts/dist/multiplexer/SocketLike';
import { createConnection, Socket } from 'net';
import {
  HISTORY_SERVICE,
  HistoryBlock,
  HistoryService,
  HistoryTxEvidence,
  HistoryTxRedeemer,
} from '../../../query/services/history.service';
import { REDEEMER_TYPE } from '../../../constant';

@Injectable()
export class MiniProtocalsService {
  private static readonly BLOCK_FETCH_MAX_ATTEMPTS = 3;
  private static readonly BLOCK_FETCH_RETRY_DELAY_MS = 250;
  private static readonly BLOCK_FETCH_TIMEOUT_MS = 30_000;

  constructor(
    @Inject(HISTORY_SERVICE) private readonly historyService: HistoryService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  async fetchTransactionEvidence(txHash: string): Promise<HistoryTxEvidence> {
    const evidence = await this.historyService.findTransactionEvidenceByHash(txHash);
    if (!evidence) {
      this.logger.error(`Historical tx evidence not found for tx ${txHash}`);
      throw new Error(`Historical tx evidence unavailable for tx ${txHash}`);
    }
    return this.hydrateTransactionEvidenceFromBlockWitness(evidence);
  }

  async fetchTransactionCborHex(txHash: string): Promise<string> {
    const evidence = await this.fetchTransactionEvidence(txHash);
    return evidence.txCborHex;
  }

  async fetchTransactionBodyCbor(txHash: string): Promise<Buffer> {
    const evidence = await this.fetchTransactionEvidence(txHash);
    return Buffer.from(evidence.txBodyCborHex, 'hex');
  }

  async fetchBlockCbor(block: Pick<HistoryBlock, 'hash' | 'slotNo'>): Promise<Buffer> {
    const [result] = await this.fetchBlocksCbor([block]);
    return result;
  }

  extractBlockHeaderCbor(blockCbor: Uint8Array, expectedBlockHash: string): Buffer {
    try {
      const { parsed, offset } = Cbor.parseLazyWithOffset(blockCbor);
      if (!(parsed instanceof LazyCborArray) || parsed.array.length !== 5 || offset !== blockCbor.length) {
        throw new Error('expected one complete five-field Cardano block');
      }

      const headerCbor = Buffer.from(parsed.array[0]);
      const actualBlockHash = Buffer.from(blake2b(headerCbor, { dkLen: 32 })).toString('hex');
      if (actualBlockHash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
        throw new Error(`header hash ${actualBlockHash} does not match requested block ${expectedBlockHash}`);
      }
      return headerCbor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract authenticated Cardano block header: ${message}`);
    }
  }

  async fetchBlocksCbor(blocks: Array<Pick<HistoryBlock, 'hash' | 'slotNo'>>): Promise<Buffer[]> {
    if (blocks.length === 0) {
      return [];
    }

    let lastError: Error | null = null;
    for (
      let attempt = 1;
      attempt <= MiniProtocalsService.BLOCK_FETCH_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.fetchBlocksCborOnce(blocks);
      } catch (error) {
        const normalizedError = this.normalizeFetchError(error);
        lastError = normalizedError;

        if (
          attempt >= MiniProtocalsService.BLOCK_FETCH_MAX_ATTEMPTS ||
          !this.isRetryableFetchError(normalizedError)
        ) {
          throw normalizedError;
        }

        this.logger.warn(
          `Cardano block witness fetch attempt ${attempt}/${MiniProtocalsService.BLOCK_FETCH_MAX_ATTEMPTS} failed (${normalizedError.message}); retrying`,
        );
        await this.sleep(MiniProtocalsService.BLOCK_FETCH_RETRY_DELAY_MS * attempt);
      }
    }

    throw lastError ?? new Error('Cardano block witness fetch failed');
  }

  private async fetchBlocksCborOnce(blocks: Array<Pick<HistoryBlock, 'hash' | 'slotNo'>>): Promise<Buffer[]> {
    const yaciBlocks = await this.tryFetchBlocksCborFromYaci(blocks);
    if (yaciBlocks) {
      return yaciBlocks;
    }

    const host = this.configService.get<string>('cardanoChainHost');
    const port = this.configService.get<number>('cardanoChainPort');
    const networkMagic = this.configService.get<number>('cardanoChainNetworkMagic');

    if (!host || !port || !networkMagic) {
      throw new Error('Cardano chain host, port, and network magic must be configured for block witness fetch');
    }

    const sockets = new Set<Socket>();
    const multiplexer = new Multiplexer({
      protocolType: 'node-to-node',
      connect: () => {
        const socket = createConnection({ host, port });
        sockets.add(socket);
        // Prevent raw socket errors from surfacing as unhandled process-level events.
        socket.on('error', () => undefined);
        // The library's NodeSocketLike declaration predates Node's `address(): string`
        // overload, but a TCP Socket satisfies the runtime contract used by Multiplexer.
        return socket as unknown as SocketLike;
      },
    });
    const handshake = new HandshakeClient(multiplexer);
    const blockFetchClient = new BlockFetchClient(multiplexer);
    let rejectProtocol: (error: Error) => void;
    const protocolFailure = new Promise<never>((_resolve, reject) => { rejectProtocol = reject; });
    // Keep errors handled between the handshake and block-fetch awaits too.
    void protocolFailure.catch(() => undefined);
    const onProtocolError = (error: unknown) => rejectProtocol(this.normalizeFetchError(error));
    handshake.on('error', onProtocolError);
    blockFetchClient.on('error', onProtocolError);

    try {
      // The library defaults query=true, which only requests a version table
      // and does not establish a connection on which block fetch can run.
      const accepted = await this.runWithMultiplexerError(multiplexer, () =>
        Promise.race([handshake.propose({ networkMagic, query: false }), protocolFailure]),
      );
      if (!(accepted instanceof HandshakeAcceptVersion) ||
          accepted.versionData.networkMagic !== networkMagic || accepted.versionData.query) {
        throw new Error('Cardano node did not accept the block witness handshake');
      }

      const from = this.toChainPoint(blocks[0]);
      const to = this.toChainPoint(blocks[blocks.length - 1]);
      const response =
        blocks.length === 1
          ? await this.runWithMultiplexerError(multiplexer, () => Promise.race([blockFetchClient.request(from), protocolFailure]))
          : await this.runWithMultiplexerError(multiplexer, () => Promise.race([blockFetchClient.requestRange(from, to), protocolFailure]));

      if (response instanceof BlockFetchNoBlocks) {
        throw new Error(
          `Cardano node returned no block witness data for requested range ${blocks[0].hash}..${blocks[blocks.length - 1].hash}`,
        );
      }

      const fetchedBlocks = Array.isArray(response) ? response : [response];
      if (fetchedBlocks.length !== blocks.length) {
        throw new Error(
          `Cardano node returned ${fetchedBlocks.length} block witnesses for ${blocks.length} requested blocks`,
        );
      }

      return fetchedBlocks.map((fetchedBlock) => this.normalizeBlockCbor(Buffer.from(fetchedBlock.getBlockBytes())));
    } catch (error) {
      const normalizedError = this.normalizeFetchError(error);
      this.logger.error(`Failed to fetch Cardano block witness data: ${normalizedError.message}`);
      throw normalizedError;
    } finally {
      try {
        handshake.terminate();
        multiplexer.close({ closeSocket: false });
      } finally {
        // Library close() only calls socket.end(); destroy also closes a
        // connecting or half-open peer after the deadline.
        for (const socket of sockets) socket.destroy();
        handshake.removeAllListeners();
        blockFetchClient.off('error', onProtocolError);
      }
    }
  }

  private toChainPoint(block: Pick<HistoryBlock, 'hash' | 'slotNo'>): ChainPoint {
    return new ChainPoint({
      blockHeader: {
        hash: Buffer.from(block.hash, 'hex'),
        slotNumber: block.slotNo,
      },
    });
  }

  private async runWithMultiplexerError<T>(
    multiplexer: Multiplexer,
    operation: () => Promise<T>,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        multiplexer.off('error', onError);
        clearTimeout(timer);
      };

      const settleResolve = (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(this.normalizeFetchError(error));
      };

      const onError = (error: unknown) => {
        settleReject(error);
      };

      const timer = setTimeout(
        () => settleReject(new Error('Cardano block witness transport timed out')),
        MiniProtocalsService.BLOCK_FETCH_TIMEOUT_MS,
      );
      multiplexer.on('error', onError);
      Promise.resolve().then(operation).then(settleResolve, settleReject);
    });
  }

  private normalizeFetchError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === 'string') {
      return new Error(error);
    }
    return new Error(`Unknown Cardano block witness fetch failure: ${String(error)}`);
  }

  private isRetryableFetchError(error: Error): boolean {
    const message = `${error.message} ${String((error as { data?: unknown }).data ?? '')}`.toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('socket error') ||
      message.includes('connection reset') ||
      message.includes('transport error') ||
      message.includes('broken pipe')
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async tryFetchBlocksCborFromYaci(
    blocks: Array<Pick<HistoryBlock, 'hash' | 'slotNo'>>,
  ): Promise<Buffer[] | null> {
    const yaciStoreEndpoint = this.configService.get<string>('yaciStoreEndpoint');
    if (!yaciStoreEndpoint) {
      return null;
    }

    const normalizedEndpoint = yaciStoreEndpoint.replace(/\/+$/, '');
    const results: Buffer[] = [];

    try {
      for (const block of blocks) {
        const response = await fetch(
          `${normalizedEndpoint}/api/v1/blocks/${block.hash}/cbor`,
          {
            headers: {
              accept: 'application/octet-stream',
            },
            signal: AbortSignal.timeout(MiniProtocalsService.BLOCK_FETCH_TIMEOUT_MS),
          },
        );

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          throw new Error(
            `Yaci block CBOR fetch failed for ${block.hash} with HTTP ${response.status}`,
          );
        }

        const bytes = this.normalizeBlockCbor(Buffer.from(await response.arrayBuffer()));
        if (bytes.length === 0) {
          return null;
        }

        results.push(bytes);
      }

      return results;
    } catch (error) {
      const normalizedError = this.normalizeFetchError(error);
      this.logger.warn(
        `Failed to fetch Cardano block witness data from Yaci Store (${normalizedError.message}); falling back to node-to-node block fetch`,
      );
      return null;
    }
  }

  private normalizeBlockCbor(bytes: Buffer): Buffer {
    if (bytes.length < 3) {
      return bytes;
    }

    // Both Yaci and node-to-node block fetch can return a two-element CBOR envelope:
    // [blockType, rawBlockCbor]. Downstream verifiers expect the raw block bytes only.
    if (bytes[0] === 0x82 && bytes[1] <= 0x17) {
      return bytes.subarray(2);
    }

    return bytes;
  }

  private async hydrateTransactionEvidenceFromBlockWitness(
    evidence: HistoryTxEvidence,
  ): Promise<HistoryTxEvidence> {
    if (
      evidence.redeemers.length > 0 ||
      !evidence.blockHash ||
      evidence.slotNo === null ||
      evidence.slotNo === undefined
    ) {
      return evidence;
    }

    try {
      const blockCbor = await this.fetchBlockCbor({
        hash: evidence.blockHash,
        slotNo: evidence.slotNo,
      });
      const block = CML.Block.from_cbor_bytes(blockCbor);
      const txIndex = evidence.txIndex;

      if (txIndex < 0 || txIndex >= block.transaction_bodies().len()) {
        this.logger.warn(
          `Historical block witness for tx ${evidence.txHash} does not contain tx index ${txIndex}`,
        );
        return evidence;
      }

      const txBody = block.transaction_bodies().get(txIndex);
      const txHash = CML.hash_transaction(txBody).to_hex().toLowerCase();
      if (txHash !== evidence.txHash.toLowerCase()) {
        this.logger.warn(
          `Historical block witness tx hash mismatch for ${evidence.txHash}: found ${txHash} at index ${txIndex}`,
        );
        return evidence;
      }

      const witnessSet = block.transaction_witness_sets().get(txIndex);
      const redeemers = witnessSet?.redeemers();
      if (!redeemers) {
        return {
          ...evidence,
          txBodyCborHex: txBody.to_cbor_hex().toLowerCase(),
        };
      }

      return {
        ...evidence,
        txBodyCborHex: txBody.to_cbor_hex().toLowerCase(),
        redeemers: this.decodeRedeemers(redeemers),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to hydrate redeemers for tx ${evidence.txHash} from block witness: ${message}`,
      );
      return evidence;
    }
  }

  private decodeRedeemers(redeemers: InstanceType<typeof CML.Redeemers>): HistoryTxRedeemer[] {
    const parsedRedeemers: HistoryTxRedeemer[] = [];

    const redeemerMap = redeemers.as_map_redeemer_key_to_redeemer_val();
    const keys = redeemerMap?.keys();
    if (redeemerMap && keys) {
      for (let index = 0; index < keys.len(); index += 1) {
        const key = keys.get(index);
        const value = redeemerMap.get(key);
        if (!value) continue;
        parsedRedeemers.push({
          type: this.redeemerTagToType(key.tag()),
          index: Number(key.index()),
          data: value.data().to_cbor_hex().toLowerCase(),
        });
      }
      return parsedRedeemers;
    }

    const legacyRedeemers = redeemers.as_arr_legacy_redeemer();
    if (!legacyRedeemers) {
      return parsedRedeemers;
    }

    for (let index = 0; index < legacyRedeemers.len(); index += 1) {
      const redeemer = legacyRedeemers.get(index);
      parsedRedeemers.push({
        type: this.redeemerTagToType(redeemer.tag()),
        index: Number(redeemer.index()),
        data: redeemer.data().to_cbor_hex().toLowerCase(),
      });
    }

    return parsedRedeemers;
  }

  private redeemerTagToType(tag: number): string {
    switch (tag) {
      case CML.RedeemerTag.Mint:
        return REDEEMER_TYPE.MINT;
      case CML.RedeemerTag.Spend:
        return REDEEMER_TYPE.SPEND;
      default:
        return `tag_${tag}`;
    }
  }
}
