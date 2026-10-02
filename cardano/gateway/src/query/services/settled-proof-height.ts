import { Logger } from '@nestjs/common';
import type { HistoryService } from './history.service';
import { loadStakeWeightedStabilityEvidenceByHeight } from './stability-evidence';
import { getStabilityPolicy, getStabilityLookaheadDepth } from './stability-scoring';
import { GrpcNotFoundException } from '../../exception/grpc_exceptions';

export async function latestPacketProofHeight(historyService: HistoryService, logger: Logger): Promise<bigint> {
  const tip = await historyService.findLatestBlock();
  if (!tip) throw new Error('Cardano history is unavailable');
  const policy = getStabilityPolicy();
  const first = BigInt(tip.height) - policy.threshold_depth;
  const last = BigInt(Math.max(1, tip.height - getStabilityLookaheadDepth(policy)));
  for (let height = first; height >= last; height--) {
    try {
      const evidence = await loadStakeWeightedStabilityEvidenceByHeight({ historyService, logger, height });
      return evidence.anchorHeight;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('HEIGHT_NOT_ACCEPTED') &&
        !message.includes('stability thresholds not met') &&
        !message.includes('crosses epoch boundary') &&
        !message.includes('crosses trusted epoch slot bounds')
      )
        throw error;
    }
  }
  throw new GrpcNotFoundException('No settled packet proof height in the available stability window');
}
