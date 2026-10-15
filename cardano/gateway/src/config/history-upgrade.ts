import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import { verifyHistoryCoverage } from './history-coverage';
import type { BridgeManifest } from './bridge-manifest';

export async function upgradeHistoryArtifact(
  source: YaciRestHistory,
  original: Record<string, any>,
  fallbackIdentity?: { network_magic: number; chain_id?: string },
) {
  const artifact = structuredClone(original);
  const cardano = artifact.cardano ?? fallbackIdentity;
  if (!cardano || ![1, 2, 764824073].includes(cardano.network_magic))
    throw new Error('Set CARDANO_CHAIN_NETWORK_MAGIC for a public-network handler');
  const token = artifact.host_state_nft ?? {
    policy_id: artifact.hostStateNFT?.policyId,
    token_name: artifact.hostStateNFT?.name,
  };
  return source.snapshot('latest', async (tip) => {
    const outputs = await source.outputs(
      { policy: token.policy_id, unit: token.policy_id + token.token_name, unspent: false },
      tip.number,
    );
    const anchor = outputs[0];
    if (!anchor) throw new Error('HostState creation history is unavailable through REST');
    const normalize = (value: any): any =>
      !value || typeof value !== 'object'
        ? value
        : Object.fromEntries(
            Object.entries(value).map(([key, child]: [string, any]) =>
              key === 'refUtxo'
                ? ['ref_utxo', { tx_hash: child.txHash, output_index: child.outputIndex }]
                : [key, normalize(child)],
            ),
          );
    const validators = normalize(artifact.validators);
    const hashes = new Set<string>([anchor.tx_hash]);
    const collect = (value: any) => {
      if (!value || typeof value !== 'object') return;
      if (value.ref_utxo) hashes.add(value.ref_utxo.tx_hash);
      Object.values(value).forEach(collect);
    };
    collect(validators);
    let epoch = Number.MAX_SAFE_INTEGER;
    for (const hash of hashes) {
      const tx = await source.transaction(hash);
      if (!tx?.valid) throw new Error('Deployment reference transaction is unavailable');
      epoch = Math.min(epoch, tx.block.epoch);
    }
    const last = await source.latestBlockInEpoch(epoch - 2);
    const start = last ? await source.api.block(last.number) : null;
    if (!start || start.number >= anchor.block)
      throw new Error('Yaci must retain at least two epochs before deployment');
    artifact.history = {
      format: 'cardano-history-v1',
      start: { slot: start.slot, block_hash: start.hash, block_height: start.number },
      host_state_nft_mint: { tx_hash: anchor.tx_hash, output_index: anchor.output_index },
    };
    await verifyHistoryCoverage(source, { ...artifact, cardano, validators, host_state_nft: token } as BridgeManifest);
    return artifact;
  });
}
