import { Logger } from '@nestjs/common';
import type { HistoryService } from './history.service';
import { loadStakeWeightedStabilityEvidenceByHeight } from './stability-evidence';
import { getStabilityPolicy, getStabilityLookaheadDepth } from './stability-scoring';
import { GrpcNotFoundException } from '../../exception/grpc_exceptions';
import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';

type PacketProofAnchor = {
  proofHeight: bigint;
  anchorBlockHash: string;
  lastDescendant: { height: number; hash: string };
};

export async function latestPacketProofHeight(historyService: HistoryService, logger: Logger): Promise<bigint> {
  return (await latestPacketProofAnchor(historyService, logger)).proofHeight;
}

export async function latestPacketProofAnchor(
  historyService: HistoryService,
  logger: Logger,
): Promise<PacketProofAnchor> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await findPacketProofAnchor(historyService, logger);
    } catch (error) {
      if (!(error instanceof YaciRestHistoryChangedError) || attempt >= 2) throw error;
    }
  }
}

async function findPacketProofAnchor(
  historyService: HistoryService, logger: Logger,
): Promise<PacketProofAnchor> {
  const tip = await historyService.findLatestBlock();
  if (!tip) throw new Error('Cardano history is unavailable');
  const policy = getStabilityPolicy();
  const first = BigInt(tip.height) - policy.threshold_depth;
  const last = BigInt(Math.max(1, tip.height - getStabilityLookaheadDepth(policy)));
  for (let height = first; height >= last; height--) {
    try {
      const evidence = await loadStakeWeightedStabilityEvidenceByHeight({ historyService, logger, height });
      const lastDescendant = evidence.descendantBlocks.at(-1);
      if (!lastDescendant) throw new Error('Accepted packet proof has no descendant evidence');
      return {
        proofHeight: evidence.anchorHeight,
        anchorBlockHash: evidence.anchorBlock.hash,
        lastDescendant: { height: lastDescendant.height, hash: lastDescendant.hash },
      };
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
