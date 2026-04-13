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
  vrfKeyHash: string;
};

export type HistoryEpochVerificationContext = {
  epochNonce: string;
  slotsPerKesPeriod: number;
  currentEpochStartSlot: bigint;
  currentEpochEndSlotExclusive: bigint;
};

export type HistoryEpochContextAtBlock = {
  epoch: number;
  stakeDistribution: HistoryStakeDistributionEntry[];
  verificationContext: HistoryEpochVerificationContext;
};

export type HistoryService = {
  findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]>;
  findUtxosByBlockNo(height: number): Promise<UtxoDto[]>;
  findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto>;
  findLatestBlock(): Promise<HistoryBlock | null>;
  findBlockByHeight(height: bigint): Promise<HistoryBlock | null>;
  findBridgeBlocks(trustedHeight: bigint, anchorHeight: bigint): Promise<HistoryBlock[]>;
  findDescendantBlocks(anchorHeight: bigint, limit: number): Promise<HistoryBlock[]>;
  findEpochStakeDistribution(epoch: number): Promise<HistoryStakeDistributionEntry[]>;
  findEpochVerificationContext(epoch: number): Promise<HistoryEpochVerificationContext | null>;
  findEpochContextAtBlock(block: HistoryBlock): Promise<HistoryEpochContextAtBlock | null>;
  findUtxoClientOrAuthHandler(height: number): Promise<UtxoDto[]>;
  checkExistPoolUpdateByBlockNo(height: number): Promise<boolean>;
  checkExistPoolRetireByBlockNo(height: number): Promise<boolean>;
  findTxByHash(hash: string): Promise<TxDto>;
  findTransactionEvidenceByHash(hash: string): Promise<HistoryTxEvidence | null>;
};
