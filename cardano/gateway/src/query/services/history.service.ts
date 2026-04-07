import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';

export const HISTORY_SERVICE = Symbol('HISTORY_SERVICE');

export type HistoryTxRedeemer = {
  type: string;
  data: string;
  index: number;
};

export type HistoryTxEvidence = {
  txHash: string;
  blockNo: number;
  blockHash?: string | null;
  slotNo?: bigint | null;
  txIndex: number;
  txCborHex: string;
  txBodyCborHex: string;
  redeemers: HistoryTxRedeemer[];
  hostStateOutputIndex?: number | null;
  hostStateDatum?: string | null;
  hostStateDatumHash?: string | null;
  hostStateRoot?: string | null;
  gasFee?: number | null;
  txSize?: number | null;
};

export type HistoryBlock = {
  height: number;
  hash: string;
  prevHash: string;
  slotNo: bigint;
  epochNo: number;
  timestampUnixNs: bigint;
  slotLeader: string;
};

export type HistoryStakeDistributionEntry = {
  poolId: string;
  stake: bigint;
};

export type HistoryService = {
  findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]>;
  findUtxosByBlockNo(height: number): Promise<UtxoDto[]>;
  findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto>;
  findLatestBlock(): Promise<HistoryBlock | null>;
  findBlockByHeight(height: bigint): Promise<HistoryBlock | null>;
  findDescendantBlocks(anchorHeight: bigint, limit: number): Promise<HistoryBlock[]>;
  findEpochStakeDistribution(epoch: number): Promise<HistoryStakeDistributionEntry[]>;
  findUtxoClientOrAuthHandler(height: number): Promise<UtxoDto[]>;
  checkExistPoolUpdateByBlockNo(height: number): Promise<boolean>;
  checkExistPoolRetireByBlockNo(height: number): Promise<boolean>;
  findTxByHash(hash: string): Promise<TxDto>;
  findTransactionEvidenceByHash(hash: string): Promise<HistoryTxEvidence | null>;
};
