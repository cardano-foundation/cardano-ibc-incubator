import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from '../../../query/services/history.service';

@Injectable()
export class MiniProtocalsService {
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
    return evidence;
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

    const host = this.configService.get<string>('cardanoChainHost');
    const port = this.configService.get<number>('cardanoChainPort');
    const networkMagic = this.configService.get<number>('cardanoChainNetworkMagic');

    if (!host || !port || !networkMagic) {
      throw new Error('Cardano chain host, port, and network magic must be configured for block witness fetch');
    }

    const multiplexer = new Multiplexer({
      protocolType: 'node-to-node',
      connect: () => createConnection({ host, port }),
    });
    const handshake = new HandshakeClient(multiplexer);
    const blockFetchClient = new BlockFetchClient(multiplexer);

    try {
      await handshake.propose(networkMagic);

      const from = this.toChainPoint(blocks[0]);
      const to = this.toChainPoint(blocks[blocks.length - 1]);
      const response =
        blocks.length === 1 ? await blockFetchClient.request(from) : await blockFetchClient.requestRange(from, to);

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
      this.logger.error(`Failed to fetch Cardano block witness data: ${error.message}`);
      throw error;
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
}
