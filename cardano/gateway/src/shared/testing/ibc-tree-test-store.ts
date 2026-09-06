import * as Lucid from '@lucid-evolution/lucid';
import { IbcTreeKupoService, IbcTreeLucidService, IbcTreeStateStore } from '../helpers/ibc-state-root';

export function createTestTreeStore(
  kupoService: IbcTreeKupoService = {
    queryAllClientUtxos: async () => [],
    queryAllConnectionUtxos: async () => [],
    queryAllChannelUtxos: async () => [],
  },
  lucidService: IbcTreeLucidService = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: async () => undefined,
    decodeDatum: async () => { throw new Error('Unexpected datum read in tree test'); },
  },
): IbcTreeStateStore {
  return new IbcTreeStateStore(
    { network: 'Custom', hostStateNFT: { policyId: 'aa'.repeat(28), name: '01' } },
    kupoService,
    lucidService,
  );
}
