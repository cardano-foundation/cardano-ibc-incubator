export class UtxoDto {
  txHash: string;
  txId: number;
  outputIndex: number;
  address: string;
  assetsPolicy: string;
  assetsName: string;
  datumHash?: string;
  datum?: string | null;
  blockNo: number;
  index: number;
}
