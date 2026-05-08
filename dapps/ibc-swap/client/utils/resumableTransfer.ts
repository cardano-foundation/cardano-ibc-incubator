import type { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import type { TransferTokenItemProps } from '@/components/TransferTokenItem/TransferTokenItem';

const RESUMABLE_TRANSFER_STORAGE_KEY = 'ibc-swap:resumable-transfer:v1';

export type ResumableTransferRecord = {
  version: 1;
  sourceTxHash: string;
  sourceChainId: string;
  destinationChainId: string;
  sourceWalletAddress?: string;
  destinationAddress?: string;
  sendAmount?: string;
  estReceiveAmount?: string;
  estTime?: string;
  estFee?: string;
  fromNetwork?: NetworkItemProps;
  toNetwork?: NetworkItemProps;
  selectedToken?: TransferTokenItemProps;
  createdAt: string;
};

const canUseBrowserStorage = (): boolean => typeof window !== 'undefined';

const readStoredRecord = (): ResumableTransferRecord | null => {
  if (!canUseBrowserStorage()) return null;
  try {
    const value = window.localStorage.getItem(RESUMABLE_TRANSFER_STORAGE_KEY);
    if (!value) return null;
    const record = JSON.parse(value) as Partial<ResumableTransferRecord>;
    if (
      record.version !== 1 ||
      !record.sourceTxHash ||
      !record.sourceChainId ||
      !record.destinationChainId
    ) {
      return null;
    }
    return record as ResumableTransferRecord;
  } catch {
    return null;
  }
};

type ResumableTransferUrlRecord = Pick<
  ResumableTransferRecord,
  'version' | 'sourceTxHash' | 'sourceChainId' | 'destinationChainId'
>;

const readUrlRecord = (): ResumableTransferUrlRecord | null => {
  if (!canUseBrowserStorage()) return null;
  const params = new URLSearchParams(window.location.search);
  const sourceTxHash = params.get('sourceTxHash')?.trim();
  const sourceChainId = params.get('sourceChainId')?.trim();
  const destinationChainId = params.get('destinationChainId')?.trim();
  if (!sourceTxHash || !sourceChainId || !destinationChainId) return null;
  return {
    version: 1,
    sourceTxHash,
    sourceChainId,
    destinationChainId,
  };
};

export const readResumableTransfer = (): ResumableTransferRecord | null => {
  const urlRecord = readUrlRecord();
  const storedRecord = readStoredRecord();
  if (!urlRecord) return storedRecord;
  if (storedRecord?.sourceTxHash === urlRecord.sourceTxHash) {
    return {
      ...storedRecord,
      ...urlRecord,
      version: 1,
    };
  }
  return {
    version: 1,
    sourceTxHash: urlRecord.sourceTxHash,
    sourceChainId: urlRecord.sourceChainId,
    destinationChainId: urlRecord.destinationChainId,
    createdAt: new Date().toISOString(),
  };
};

export const persistResumableTransfer = (
  record: ResumableTransferRecord,
): void => {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(
    RESUMABLE_TRANSFER_STORAGE_KEY,
    JSON.stringify(record),
  );

  // Keep the source tx in the URL so a hard refresh can resume polling.
  const url = new URL(window.location.href);
  url.searchParams.set('sourceTxHash', record.sourceTxHash);
  url.searchParams.set('sourceChainId', record.sourceChainId);
  url.searchParams.set('destinationChainId', record.destinationChainId);
  window.history.replaceState(null, '', url.toString());
};

export const clearResumableTransfer = (): void => {
  if (!canUseBrowserStorage()) return;
  window.localStorage.removeItem(RESUMABLE_TRANSFER_STORAGE_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete('sourceTxHash');
  url.searchParams.delete('sourceChainId');
  url.searchParams.delete('destinationChainId');
  window.history.replaceState(null, '', url.toString());
};
