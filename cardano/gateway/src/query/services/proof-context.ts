import { Logger } from '@nestjs/common';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { HostStateDatum } from '../../shared/types/host-state-datum';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HistoryService } from './history.service';
import { loadStakeWeightedStabilityEvidenceForTxHash } from './stability-evidence';

type ProofContextDeps = {
  logger: Logger;
  lucidService: LucidService;
  mithrilService: MithrilService;
  historyService: HistoryService;
  context: string;
  lightClientMode?: 'mithril' | 'stake-weighted-stability';
  maxAttempts?: number;
  delayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isCurrentEpochOnlyStabilityLimitation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('stake-weighted stability currently supports only current-epoch anchors');
}

function isMissingCurrentLiveHostStateEvidence(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Historical tx evidence unavailable for current live HostState tx');
}

export async function resolveCurrentLiveHostStateTxHeight({
  lucidService,
  historyService,
}: Pick<ProofContextDeps, 'lucidService' | 'historyService'>): Promise<bigint> {
  const liveHostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  const txEvidence = await historyService.findTransactionEvidenceByHash(liveHostStateUtxo.txHash);
  if (txEvidence) {
    return BigInt(txEvidence.blockNo);
  }

  const tx = await historyService.findTxByHash(liveHostStateUtxo.txHash);
  if (tx?.height !== undefined && tx?.height !== null) {
    return BigInt(tx.height);
  }

  throw new GrpcInternalException(
    `Historical tx evidence unavailable for current live HostState tx ${liveHostStateUtxo.txHash}`,
  );
}

// Proof-serving endpoints build ICS-23 proofs from the latest live IBC tree, so they can only
// advertise a proof height once Mithril has certified the same HostState UTxO/root.
export async function resolveProofHeightForCurrentRoot({
  logger,
  lucidService,
  mithrilService,
  historyService,
  context,
  lightClientMode = 'stake-weighted-stability',
  maxAttempts = 10,
  delayMs = 1500,
}: ProofContextDeps): Promise<bigint> {
  if (lightClientMode === 'stake-weighted-stability') {
    return resolveStabilityAcceptedProofHeightForCurrentRoot({
      logger,
      lucidService,
      historyService,
      context,
      maxAttempts,
      delayMs,
    });
  }

  return resolveCertifiedProofHeightForCurrentRoot({
    logger,
    lucidService,
    mithrilService,
    historyService,
    context,
    maxAttempts,
    delayMs,
  });
}

async function resolveCertifiedProofHeightForCurrentRoot({
  logger,
  lucidService,
  mithrilService,
  historyService,
  context,
  maxAttempts = 10,
  delayMs = 1500,
}: ProofContextDeps): Promise<bigint> {
  const liveHostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  if (!liveHostStateUtxo?.datum) {
    throw new GrpcInternalException('IBC infrastructure error: HostState UTxO missing datum');
  }

  const liveHostStateDatum = await lucidService.decodeDatum<HostStateDatum>(liveHostStateUtxo.datum, 'host_state');
  const liveRoot = liveHostStateDatum.state.ibc_state_root;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshots = await mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshot = snapshots?.[0];
    if (!latestSnapshot) {
      if (attempt + 1 === maxAttempts) {
        throw new GrpcInternalException('Mithril transaction snapshots unavailable for proof_height');
      }
      await sleep(delayMs);
      continue;
    }

    const certifiedHostStateUtxo = await historyService.findHostStateUtxoAtOrBeforeBlockNo(
      BigInt(latestSnapshot.block_number),
    );

    const currentRootCertified =
      certifiedHostStateUtxo.txHash === liveHostStateUtxo.txHash &&
      certifiedHostStateUtxo.outputIndex === liveHostStateUtxo.outputIndex;

    if (currentRootCertified) {
      return BigInt(latestSnapshot.block_number);
    }

    if (attempt + 1 < maxAttempts) {
      logger.warn(
        `[${context}] Mithril-certified HostState ${certifiedHostStateUtxo.txHash}#${certifiedHostStateUtxo.outputIndex}` +
          ` at block ${latestSnapshot.block_number} lags current root ${liveRoot.substring(0, 16)}...` +
          ` (${liveHostStateUtxo.txHash}#${liveHostStateUtxo.outputIndex}); waiting for certification`,
      );
      await sleep(delayMs);
      continue;
    }
  }

  throw new GrpcInternalException(
    `Current HostState root is not yet Mithril-certified for proof generation (${context})`,
  );
}

async function resolveStabilityAcceptedProofHeightForCurrentRoot({
  logger,
  lucidService,
  historyService,
  context,
  maxAttempts = 10,
  delayMs = 1500,
}: Omit<ProofContextDeps, 'mithrilService' | 'lightClientMode'>): Promise<bigint> {
  const liveHostStateUtxo = await lucidService.findUtxoAtHostStateNFT();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stabilityEvidence = await loadStakeWeightedStabilityEvidenceForTxHash({
        historyService,
        txHash: liveHostStateUtxo.txHash,
        logger,
        missingTxEvidenceMessage: `HostState tx evidence unavailable for proof generation (${context})`,
        missingAnchorBlockMessage: `Cardano history block for HostState tx ${liveHostStateUtxo.txHash} unavailable for stability proof generation (${context})`,
      });
      return stabilityEvidence.anchorHeight;
    } catch (error) {
      if (isCurrentEpochOnlyStabilityLimitation(error)) {
        try {
          const liveHostStateTxHeight = await resolveCurrentLiveHostStateTxHeight({
            lucidService,
            historyService,
          });
          logger.warn(
            `[${context}] Current live HostState root was created in a prior epoch; reusing its tx height ${liveHostStateTxHeight.toString()} for proof serving until a new HostState root is created`,
          );
          return liveHostStateTxHeight;
        } catch (heightError) {
          if (attempt + 1 < maxAttempts && isMissingCurrentLiveHostStateEvidence(heightError)) {
            logger.warn(
              `[${context}] ${heightError.message}; waiting for Yaci history to catch up before serving proofs`,
            );
            await sleep(delayMs);
            continue;
          }
          throw heightError;
        }
      }

      if (attempt + 1 < maxAttempts && isMissingCurrentLiveHostStateEvidence(error)) {
        logger.warn(
          `[${context}] ${error.message}; waiting for Yaci history to catch up before serving proofs`,
        );
        await sleep(delayMs);
        continue;
      }

      if (attempt + 1 < maxAttempts) {
        logger.warn(
          `[${context}] ${error.message}; waiting for more stability before serving proofs`,
        );
        await sleep(delayMs);
        continue;
      }
    }
  }

  throw new GrpcInternalException(
    `Current HostState root is not yet stability-accepted for proof generation (${context})`,
  );
}
