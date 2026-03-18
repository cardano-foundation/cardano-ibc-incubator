import { UtxoDto } from '../dtos/utxo.dto';
import { TxDto } from '../dtos/tx.dto';

export const HISTORY_SERVICE = Symbol('HISTORY_SERVICE');

export type HistoryService = {
  findUtxosByPolicyIdAndPrefixTokenName(policyId: string, prefixTokenName: string): Promise<UtxoDto[]>;
  findUtxosByBlockNo(height: number): Promise<UtxoDto[]>;
  findHostStateUtxoAtOrBeforeBlockNo(height: bigint): Promise<UtxoDto>;
  findUtxoClientOrAuthHandler(height: number): Promise<UtxoDto[]>;
  checkExistPoolUpdateByBlockNo(height: number): Promise<boolean>;
  checkExistPoolRetireByBlockNo(height: number): Promise<boolean>;
  findTxByHash(hash: string): Promise<TxDto>;
};
