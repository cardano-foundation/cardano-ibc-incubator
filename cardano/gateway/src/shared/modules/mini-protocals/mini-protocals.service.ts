import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cbor, LazyCborArray } from '@harmoniclabs/cbor';
import { blake2b } from '@noble/hashes/blake2b';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { YaciRestClient } from '../../helpers/yaci-rest';
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
    if (blocks.length === 0) return [];
    const rest = new YaciRestClient(this.configService.get<string>('yaciStoreEndpoint'));
    const results: Buffer[] = [];
    for (const block of blocks) results.push(await rest.blockCbor(block.hash));
    return results;
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
