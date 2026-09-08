import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MetricsService } from '../../../health/metrics.service';
import { HealthModule } from '../../../health/health.module';
import * as Lucid from '@lucid-evolution/lucid';
import { QueryModule } from '../../../query/query.module';
import { QueryService } from '../../../query/services/query.service';
import { ChannelService as QueryChannelService } from '../../../query/services/channel.service';
import { ConnectionService as QueryConnectionService } from '../../../query/services/connection.service';
import { PacketService as QueryPacketService } from '../../../query/services/packet.service';
import { YaciHistoryService } from '../../../query/services/yaci-history.service';
import { TxModule } from '../../../tx/tx.module';
import { ClientService } from '../../../tx/client.service';
import { ChannelService } from '../../../tx/channel.service';
import { ConnectionService } from '../../../tx/connection.service';
import { PacketService } from '../../../tx/packet.service';
import { SubmissionService } from '../../../tx/submission.service';
import { HostStateHeartbeatService } from '../../../tx/host-state-heartbeat.service';
import { IbcTreeStateStore } from '../../helpers/ibc-state-root';
import { ICS23MerkleTree } from '../../helpers/ics23-merkle-tree';
import { IbcTreeCacheService } from '../../services/ibc-tree-cache.service';
import { TreeInitService } from '../../services/tree-init.service';
import { KupoService } from '../kupo/kupo.service';
import { LucidService } from '../lucid/lucid.service';
import { LucidModule } from '../lucid/lucid.module';
import { LUCID_CLIENT, LUCID_IMPORTER } from '../lucid/lucid.provider';
import { IbcTreeModule } from './ibc-tree.module';

@Module({
  providers: [{ provide: MetricsService, useValue: { setCacheEntries: jest.fn() } }],
  exports: [MetricsService],
})
class TestHealthModule {}

async function createContext(policyByte: string) {
  const deployment = { hostStateNFT: { policyId: policyByte.repeat(28), name: '01' } };
  const kupo = {
    queryAllClientUtxos: jest.fn(async () => []),
    queryAllConnectionUtxos: jest.fn(async () => []),
    queryAllChannelUtxos: jest.fn(async () => []),
  };
  const lucid = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: jest.fn(async () => undefined),
    decodeDatum: jest.fn(),
  };
  const cache = {
    ensureSchema: jest.fn(),
    load: jest.fn(async () => null),
    saveAliases: jest.fn(),
  };
  const context = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), IbcTreeModule, QueryModule, TxModule, LucidModule],
    providers: [TreeInitService],
  })
    .overrideModule(HealthModule).useModule(TestHealthModule)
    .overrideProvider(ConfigService).useValue(new ConfigService({ cardanoNetwork: 'Custom', deployment }))
    .overrideProvider(KupoService).useValue(kupo)
    .overrideProvider(LucidService).useValue(lucid)
    .overrideProvider(LUCID_CLIENT).useValue({})
    .overrideProvider(LUCID_IMPORTER).useValue(Lucid)
    .overrideProvider(IbcTreeCacheService).useValue(cache)
    .overrideProvider(YaciHistoryService).useValue({})
    .overrideProvider(MetricsService).useValue({ setCacheEntries: jest.fn() })
    .compile();
  return { context, store: context.get(IbcTreeStateStore), deployment, kupo, lucid, cache };
}

describe('Gateway IBC tree ownership', () => {
  it('injects one deployment store into startup, transaction, submission and query consumers', async () => {
    const { context, store } = await createContext('aa');
    try {
      for (const consumer of [
        TreeInitService,
        ClientService,
        ConnectionService,
        ChannelService,
        PacketService,
        SubmissionService,
        HostStateHeartbeatService,
        QueryService,
        QueryConnectionService,
        QueryChannelService,
        QueryPacketService,
      ]) {
        expect((context.get(consumer) as unknown as { ibcTreeStore: IbcTreeStateStore }).ibcTreeStore).toBe(store);
      }
      expect(context.select(QueryModule).get(IbcTreeStateStore)).toBe(store);
      expect(context.select(TxModule).get(IbcTreeStateStore)).toBe(store);
    } finally {
      await context.close();
    }
  });

  it('keeps trees and their deployment identity separate across Nest contexts', async () => {
    const first = await createContext('aa');
    const second = await createContext('bb');
    try {
      expect(first.store).not.toBe(second.store);
      expect(first.store.deployment.hostStateNFT.policyId).toBe('aa'.repeat(28));
      expect(second.store.deployment.hostStateNFT.policyId).toBe('bb'.repeat(28));
      const firstTree = new ICS23MerkleTree();
      firstTree.set('clients/first/clientState', Buffer.from('first'));
      first.lucid.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'aa'.repeat(32), outputIndex: 0, datum: 'host-state-datum' } as never);
      first.lucid.decodeDatum.mockResolvedValue({ state: { ibc_state_root: firstTree.getRoot() } });
      await first.store.restoreTreeFromCache(firstTree);
      expect(first.store.getCurrentTree().get('clients/first/clientState')).toEqual(Buffer.from('first'));
      expect(second.store.getCurrentTree().get('clients/first/clientState')).toBeUndefined();
      second.store.resetTreeState();
      expect(first.store.getCurrentTree().toJSON()).toEqual(firstTree.toJSON());
      expect(second.store.deployment.hostStateNFT.policyId).toBe('bb'.repeat(28));
    } finally {
      await first.context.close();
      await second.context.close();
    }
  });

  it('loads a verified startup cache into the same store used by queries and submission', async () => {
    const fixture = await createContext('aa');
    const cachedTree = new ICS23MerkleTree();
    cachedTree.set('clients/cached/clientState', Buffer.from('cached'));
    const root = cachedTree.getRoot();
    fixture.cache.load.mockResolvedValue({ tree: cachedTree, root } as never);
    fixture.lucid.findUtxoAtHostStateNFT.mockResolvedValue({ txHash: 'aa'.repeat(32), outputIndex: 0, datum: 'host-state-datum' } as never);
    fixture.lucid.decodeDatum.mockResolvedValue({ state: { ibc_state_root: root } });
    const previousCacheSetting = process.env.IBC_TREE_CACHE_ENABLED;
    process.env.IBC_TREE_CACHE_ENABLED = 'true';
    try {
      await fixture.context.get(TreeInitService).onModuleInit();
      expect(fixture.store.getCurrentTree().toJSON()).toEqual(cachedTree.toJSON());
      expect(fixture.kupo.queryAllClientUtxos).not.toHaveBeenCalled();
    } finally {
      if (previousCacheSetting === undefined) delete process.env.IBC_TREE_CACHE_ENABLED;
      else process.env.IBC_TREE_CACHE_ENABLED = previousCacheSetting;
      await fixture.context.close();
    }
  });
});
