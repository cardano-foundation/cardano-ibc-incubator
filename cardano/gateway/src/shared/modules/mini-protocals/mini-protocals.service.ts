import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import {
  BlockFetchClient,
  BlockFetchNoBlocks,
  ChainPoint,
  HandshakeClient,
  Multiplexer,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { createConnection } from 'net';
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

    const multiplexer = new Multiplexer({
      protocolType: 'node-to-node',
      connect: () => {
        const socket = createConnection({ host, port });
        // Prevent raw socket errors from surfacing as unhandled process-level events.
        socket.on('error', () => undefined);
        return socket;
      },
    });
    const handshake = new HandshakeClient(multiplexer);
    const blockFetchClient = new BlockFetchClient(multiplexer);

    try {
      await this.runWithMultiplexerError(multiplexer, () => handshake.propose(networkMagic));

      const from = this.toChainPoint(blocks[0]);
      const to = this.toChainPoint(blocks[blocks.length - 1]);
      const response =
        blocks.length === 1
          ? await this.runWithMultiplexerError(multiplexer, () => blockFetchClient.request(from))
          : await this.runWithMultiplexerError(multiplexer, () => blockFetchClient.requestRange(from, to));

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

      return fetchedBlocks.map((fetchedBlock) => Buffer.from(fetchedBlock.getBlockBytes()));
    } catch (error) {
      const normalizedError = this.normalizeFetchError(error);
      this.logger.error(`Failed to fetch Cardano block witness data: ${normalizedError.message}`);
      throw normalizedError;
    } finally {
      handshake.terminate();
      multiplexer.close();
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

      multiplexer.on('error', onError);
      operation().then(settleResolve, settleReject);
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

        const bytes = this.normalizeYaciBlockCbor(Buffer.from(await response.arrayBuffer()));
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

  private normalizeYaciBlockCbor(bytes: Buffer): Buffer {
    if (bytes.length < 3) {
      return bytes;
    }

    // Yaci's /blocks/{hash}/cbor endpoint can return a two-element CBOR envelope:
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
