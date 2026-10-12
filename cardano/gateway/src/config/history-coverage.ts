import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import { requireHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/historyBootstrap';
import { validateHistoryBootstrap } from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import type { BridgeManifest } from './bridge-manifest';
import { decodeHostStateDatum } from '../shared/types/host-state-datum';

export class HistoryConfigurationError extends Error {}

export async function verifyHistoryCoverage(
  source: YaciRestHistory,
  manifest: BridgeManifest,
  liveHost?: { txHash: string; outputIndex: number },
): Promise<void> {
  const h = requireHistoryBootstrap(manifest.history, manifest.cardano.network_magic);
  await source.snapshot('latest', async () => {
    const start = h.start === 'origin' ? 0 : h.start.block_height;
    if (h.start !== 'origin') {
      const first = await source.api.block(start);
      const next = await source.api.block(start + 1);
      if (first && (first.hash !== h.start.block_hash || first.slot !== h.start.slot))
        throw new HistoryConfigurationError('Bridge history checkpoint belongs to another chain or fork');
      if (!next) throw new Error('Yaci REST does not retain the checkpoint successor');
      if (next.previous_block !== h.start.block_hash || next.slot <= h.start.slot)
        throw new HistoryConfigurationError('Bridge history checkpoint successor belongs to another chain or fork');
    }
    const refs = new Map<string, { tx_hash: string; output_index: number }>();
    const collect = (value: any) => {
      if (!value || typeof value !== 'object') return;
      if (value.ref_utxo) refs.set(`${value.ref_utxo.tx_hash}#${value.ref_utxo.output_index}`, value.ref_utxo);
      Object.values(value).forEach(collect);
    };
    collect(manifest.validators);
    const anchor = h.host_state_nft_mint;
    refs.set(`${anchor.tx_hash}#${anchor.output_index}`, anchor);
    if (liveHost)
      refs.set(`${liveHost.txHash}#${liveHost.outputIndex}`, {
        tx_hash: liveHost.txHash,
        output_index: liveHost.outputIndex,
      });
    for (const ref of refs.values()) {
      const tx = await source.transaction(ref.tx_hash);
      const output = tx?.outputs.find((candidate) => candidate.output_index === ref.output_index);
      if (!tx?.valid || !output)
        throw new Error(`Yaci REST is missing accepted deployment output ${ref.tx_hash}#${ref.output_index}`);
      if (tx.block.number <= start)
        throw new HistoryConfigurationError('Bridge history checkpoint does not precede all deployment outputs');
      if (ref.tx_hash === anchor.tx_hash && ref.output_index === anchor.output_index) {
        const token = { policyId: manifest.host_state_nft.policy_id, name: manifest.host_state_nft.token_name };
        if (
          !output.inline_datum ||
          !output.amounts.some((amount) => amount.unit === token.policyId + token.name && amount.quantity === '1')
        )
          throw new HistoryConfigurationError('HostState creation anchor lacks the NFT or datum');
        const datum = await decodeHostStateDatum(output.inline_datum, await import('@lucid-evolution/lucid'));
        if (datum.state.version !== 0n || datum.nft_policy !== token.policyId)
          throw new HistoryConfigurationError('Anchor is not the initial HostState output');
        try {
          validateHistoryBootstrap(
            {
              txHash: tx.hash,
              blockHash: tx.block.hash,
              blockHeight: tx.block.number,
              slot: tx.block.slot,
              transactionIndex: tx.index,
              cbor: tx.bodyCborHex,
              valid: true,
            },
            token,
            ref.output_index,
          );
        } catch (error) {
          throw new HistoryConfigurationError(
            `HostState creation anchor lacks hash-checked NFT mint evidence: ${error}`,
          );
        }
      }
    }
  });
}
