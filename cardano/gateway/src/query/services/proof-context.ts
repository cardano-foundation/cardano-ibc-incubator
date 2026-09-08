import { Logger } from "@nestjs/common";
import { LucidService } from "@shared/modules/lucid/lucid.service";
import { HostStateDatum } from "../../shared/types/host-state-datum";
import {
  GrpcInternalException,
  GrpcNotFoundException,
} from "~@/exception/grpc_exceptions";
import { MithrilService } from "../../shared/modules/mithril/mithril.service";
import { HistoryService } from "./history.service";
import { loadStakeWeightedStabilityEvidenceForTxHash } from "./stability-evidence";
import {
  ibcTreeCacheIdForHeight,
  ibcTreeCacheIdForRoot,
  IbcTreeCacheService,
} from "../../shared/services/ibc-tree-cache.service";
import {
  IbcTreeStateStore,
  StaleIbcTreeStateError,
  type IbcTreeSnapshot,
} from "../../shared/helpers/ibc-state-root";

type ProofContextDeps = {
  logger: Logger;
  lucidService: LucidService;
  mithrilService: MithrilService;
  historyService: HistoryService;
  context: string;
  lightClientMode?: "mithril" | "stake-weighted-stability";
  maxAttempts?: number;
  delayMs?: number;
  targetSnapshot?: Pick<IbcTreeSnapshot, "root" | "hostState">;
};

type HistoricalProofContextDeps = ProofContextDeps & {
  ibcTreeCacheService: IbcTreeCacheService;
  requestedHeight?: bigint;
  ibcTreeStore: IbcTreeStateStore;
};

type ProofQueryContext = IbcTreeSnapshot & {
  historical: boolean;
  proofHeight: bigint;
};

export async function assertProofContextHostState(
  proofContext: Pick<ProofQueryContext, "proofHeight" | "hostState" | "root">,
  historyService: HistoryService,
  lucidService: LucidService,
): Promise<void> {
  const { proofHeight, hostState: capturedHostState, root } = proofContext;
  const hostState = await historyService.findHostStateUtxoAtOrBeforeBlockNo(proofHeight);
  if (
    hostState.txHash !== capturedHostState.txHash ||
    hostState.outputIndex !== capturedHostState.outputIndex
  ) {
    throw new StaleIbcTreeStateError(
      `HostState at proof height ${proofHeight} no longer identifies the captured output`,
    );
  }
  if (!hostState.datum) {
    throw new GrpcInternalException(`HostState at proof height ${proofHeight} is missing datum`);
  }
  const datum = await lucidService.decodeDatum<HostStateDatum>(hostState.datum, "host_state");
  if (datum.state.ibc_state_root.toLowerCase() !== root.toLowerCase()) {
    throw new StaleIbcTreeStateError(
      `HostState root at proof height ${proofHeight} does not match the captured tree`,
    );
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isMissingCurrentLiveHostStateEvidence(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "Historical tx evidence unavailable for current live HostState tx",
  );
}
export async function resolveCurrentLiveHostStateTxHeight({
  lucidService,
  historyService,
}: Pick<ProofContextDeps, "lucidService" | "historyService">): Promise<bigint> {
  const liveHostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  const txEvidence = await historyService.findTransactionEvidenceByHash(
    liveHostStateUtxo.txHash,
  );
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

// A proof's accepted height must identify the same HostState output as its captured tree.
export async function resolveProofHeightForCurrentRoot({
  logger,
  lucidService,
  mithrilService,
  historyService,
  context,
  lightClientMode = "stake-weighted-stability",
  maxAttempts = 10,
  delayMs = 1500,
  targetSnapshot,
}: ProofContextDeps): Promise<bigint> {
  const proofHeight = lightClientMode === "stake-weighted-stability"
    ? await resolveStabilityAcceptedProofHeightForCurrentRoot({
      logger,
      lucidService,
      historyService,
      context,
      maxAttempts,
      delayMs,
      targetSnapshot,
    })
    : await resolveCertifiedProofHeightForCurrentRoot({
      logger,
      lucidService,
      mithrilService,
      historyService,
      context,
      maxAttempts,
      delayMs,
      targetSnapshot,
    });
  if (targetSnapshot) {
    await assertProofContextHostState({ ...targetSnapshot, proofHeight }, historyService, lucidService);
  }
  return proofHeight;
}

export async function resolveProofContextForQuery({
  requestedHeight,
  ibcTreeCacheService,
  ibcTreeStore,
  ...deps
}: HistoricalProofContextDeps): Promise<ProofQueryContext> {
  if (requestedHeight === undefined || requestedHeight === 0n) {
    const snapshot = await ibcTreeStore.getAlignedSnapshot();
    const proofHeight = await resolveProofHeightForCurrentRoot({ ...deps, targetSnapshot: snapshot });
    return {
      ...snapshot,
      historical: false,
      proofHeight,
    };
  }

  const latestAcceptedHeight = await resolveProofHeightForCurrentRoot(deps);
  if (requestedHeight > latestAcceptedHeight) {
    throw new GrpcNotFoundException(
      `Not found: requested proof height ${requestedHeight.toString()} is newer than latest accepted proof height ${latestAcceptedHeight.toString()}`,
    );
  }

  const hostStateUtxo = await deps.historyService
    .findHostStateUtxoAtOrBeforeBlockNo(requestedHeight);
  if (!hostStateUtxo.datum) {
    throw new GrpcInternalException(
      `Historical HostState UTxO ${hostStateUtxo.txHash}#${hostStateUtxo.outputIndex} at or before height ${requestedHeight.toString()} is missing datum`,
    );
  }

  const hostStateDatum = await deps.lucidService.decodeDatum<HostStateDatum>(
    hostStateUtxo.datum,
    "host_state",
  );
  const root = hostStateDatum.state.ibc_state_root.toLowerCase();

  const cached =
    (await ibcTreeCacheService.load(ibcTreeCacheIdForRoot(root))) ??
      (await ibcTreeCacheService.load(
        ibcTreeCacheIdForHeight(requestedHeight),
      ));

  if (!cached) {
    throw new GrpcNotFoundException(
      `Not found: no cached IBC state tree for proof height ${requestedHeight.toString()} and root ${
        root.substring(0, 16)
      }...`,
    );
  }

  if (cached.root.toLowerCase() !== root) {
    throw new GrpcInternalException(
      `Cached IBC state tree root mismatch for proof height ${requestedHeight.toString()}: expected ${root}, got ${cached.root}`,
    );
  }

  return {
    historical: true,
    proofHeight: requestedHeight,
    root,
    hostState: { txHash: hostStateUtxo.txHash, outputIndex: hostStateUtxo.outputIndex },
    tree: cached.tree.clone(),
  };
}

async function resolveCertifiedProofHeightForCurrentRoot({
  logger,
  lucidService,
  mithrilService,
  historyService,
  context,
  maxAttempts = 10,
  delayMs = 1500,
  targetSnapshot,
}: ProofContextDeps): Promise<bigint> {
  let captured = targetSnapshot;
  if (!captured) {
    const liveHostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
    if (!liveHostStateUtxo?.datum) {
      throw new GrpcInternalException("IBC infrastructure error: HostState UTxO missing datum");
    }
    const liveHostStateDatum = await lucidService.decodeDatum<HostStateDatum>(liveHostStateUtxo.datum, "host_state");
    captured = { hostState: liveHostStateUtxo, root: liveHostStateDatum.state.ibc_state_root };
  }
  const liveHostStateUtxo = captured.hostState;
  const liveRoot = captured.root;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snapshots = await mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshot = snapshots?.[0];
    if (!latestSnapshot) {
      if (attempt + 1 === maxAttempts) {
        throw new GrpcInternalException(
          "Mithril transaction snapshots unavailable for proof_height",
        );
      }
      await sleep(delayMs);
      continue;
    }

    const certifiedHostStateUtxo = await historyService
      .findHostStateUtxoAtOrBeforeBlockNo(
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
          ` at block ${latestSnapshot.block_number} lags current root ${
            liveRoot.substring(0, 16)
          }...` +
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
  targetSnapshot,
}: Omit<ProofContextDeps, "mithrilService" | "lightClientMode">): Promise<
  bigint
> {
  const liveHostStateUtxo = targetSnapshot?.hostState ?? await lucidService.findUtxoAtHostStateNFT();

  let lastStabilityError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stabilityEvidence =
        await loadStakeWeightedStabilityEvidenceForTxHash({
          historyService,
          txHash: liveHostStateUtxo.txHash,
          logger,
          missingTxEvidenceMessage:
            `HostState tx evidence unavailable for proof generation (${context})`,
          missingAnchorBlockMessage:
            `Cardano history block for HostState tx ${liveHostStateUtxo.txHash} unavailable for stability proof generation (${context})`,
        });
      return stabilityEvidence.anchorHeight;
    } catch (error) {
      lastStabilityError = error;
      if (
        attempt + 1 < maxAttempts &&
        isMissingCurrentLiveHostStateEvidence(error)
      ) {
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

  const detail = lastStabilityError instanceof Error
    ? `: ${lastStabilityError.message}`
    : "";
  throw new GrpcInternalException(
    `Current HostState root is not yet stability-accepted for proof generation (${context})${detail}`,
  );
}
