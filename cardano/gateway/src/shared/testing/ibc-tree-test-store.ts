import * as Lucid from '@lucid-evolution/lucid';
import { IbcTreeHostStateRef, IbcTreeKupoService, IbcTreeLucidService, IbcTreeStateStore, StateRootResult } from '../helpers/ibc-state-root';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';

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

export function createTestTreeContext() {
  let sequence = 0;
  let live = { txHash: '00'.repeat(32), outputIndex: 0, datum: '0'.repeat(64), assets: {} };
  const lucid = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: async () => ({ ...live }),
    decodeDatum: async <T>(datum: string): Promise<T> => ({
      state: { ibc_state_root: datum },
      control: { port_registry: new Map() },
    }) as T,
  };
  const store = createTestTreeStore(undefined, lucid);
  const setLiveRoot = (root: string, ref?: IbcTreeHostStateRef) => {
    const hostState = ref ?? { txHash: (++sequence).toString(16).padStart(64, '0'), outputIndex: 0 };
    live = { ...hostState, datum: root, assets: {} };
    return hostState;
  };
  return {
    store,
    setLiveRoot,
    restore: async (tree: ICS23MerkleTree, ref?: IbcTreeHostStateRef) => {
      setLiveRoot(tree.getRoot(), ref);
      return store.restoreTreeFromCache(tree);
    },
    commit: async (update: StateRootResult, ref?: IbcTreeHostStateRef) => {
      const hostState = setLiveRoot(update.newRoot, ref);
      return update.commit(hostState);
    },
  };
}
