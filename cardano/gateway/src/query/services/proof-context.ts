import { Logger } from '@nestjs/common';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { HostStateDatum } from '../../shared/types/host-state-datum';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HistoryService } from './history.service';

type ProofContextDeps = {
  logger: Logger;
  lucidService: LucidService;
  mithrilService: MithrilService;
  historyService: HistoryService;
  context: string;
  maxAttempts?: number;
  delayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Proof-serving endpoints build ICS-23 proofs from the latest live IBC tree, so they can only
// advertise a proof height once Mithril has certified the same HostState UTxO/root.
export async function resolveCertifiedProofHeightForCurrentRoot({
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
