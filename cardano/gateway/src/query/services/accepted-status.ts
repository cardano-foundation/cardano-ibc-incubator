import { Logger } from '@nestjs/common';
import { HistoryService } from './history.service';
import { latestPacketProofAnchor } from './settled-proof-height';
import { StaleIbcTreeStateError } from '../../shared/helpers/ibc-state-root';
import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';

export async function acceptedStatus(history: HistoryService, logger: Logger) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readAcceptedStatus(history, logger);
    } catch (error) {
      if (attempt >= 3 || !(error instanceof YaciRestHistoryChangedError || error instanceof StaleIbcTreeStateError))
        throw error;
      logger.warn?.('Canonical history changed during accepted-status read, retrying from a fresh anchor');
    }
  }
}

async function readAcceptedStatus(history: HistoryService, logger: Logger) {
  const anchor = await latestPacketProofAnchor(history, logger);
  const block = await history.findBlockByHeight(anchor.proofHeight);
  const descendant = await history.findBlockByHeight(BigInt(anchor.lastDescendant.height));
  if (block?.hash !== anchor.anchorBlockHash || descendant?.hash !== anchor.lastDescendant.hash) {
    throw new StaleIbcTreeStateError('Canonical chain changed while resolving accepted status');
  }
  if (typeof block.timestampUnixNs !== 'bigint' || block.timestampUnixNs <= 0n)
    throw new Error('Accepted block timestamp is unavailable');
  return { height: anchor.proofHeight, timestampUnixNs: block.timestampUnixNs };
}
