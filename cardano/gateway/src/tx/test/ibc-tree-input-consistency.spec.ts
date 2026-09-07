import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { IbcTreeStateStore, StaleIbcTreeStateError, type IbcTreeHostStateRef } from '../../shared/helpers/ibc-state-root';
import { createTestTreeContext } from '../../shared/testing/ibc-tree-test-store';

describe('transaction HostState input consistency', () => {
  for (const Service of [ClientService, ConnectionService, ChannelService, PacketService]) {
    it(`${Service.name} rejects a replaced input even when a heartbeat preserves the tree root`, async () => {
      const context = createTestTreeContext();
      const tree = new ICS23MerkleTree();
      tree.set('clients/first/clientState', Buffer.from('first'));
      const first = { txHash: 'aa'.repeat(32), outputIndex: 0 };
      const heartbeat = { txHash: 'bb'.repeat(32), outputIndex: 1 };
      await context.restore(tree, first);
      const service = Object.assign(Object.create(Service.prototype), { ibcTreeStore: context.store }) as {
        ibcTreeStore: IbcTreeStateStore;
        ensureTreeAligned: (root: string, hostState: IbcTreeHostStateRef) => Promise<void>;
      };
      await expect(service.ensureTreeAligned(tree.getRoot(), first)).resolves.toBeUndefined();

      await context.restore(tree, heartbeat);
      await expect(service.ensureTreeAligned(tree.getRoot(), first)).rejects.toThrow(StaleIbcTreeStateError);
      await expect(service.ensureTreeAligned(tree.getRoot(), heartbeat)).resolves.toBeUndefined();
      await expect(service.ensureTreeAligned('cc'.repeat(32), heartbeat)).rejects.toThrow(StaleIbcTreeStateError);
      expect(context.store.getSnapshot().hostState).toEqual(heartbeat);
    });
  }
});
