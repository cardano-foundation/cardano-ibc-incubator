import * as LucidImporter from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

describe('LucidService transfer lifecycle codecs', () => {
  const service: any = Object.create(LucidService.prototype);
  service.LucidImporter = LucidImporter;

  it('round-trips explicit escrow principal and module lifecycle accounting', async () => {
    const escrowDatum = {
      channel_id: '6368616e6e656c2d31',
      denom: '6c6f76656c616365',
      escrowed_amount: 42n,
    };
    const moduleDatum = {
      escrow_shard_registry_root: '00'.repeat(32),
      live_escrow_shard_count: 3n,
      voucher_supply: 11n,
    };

    const encodedEscrow = await service.encode(escrowDatum, 'transferEscrow');
    const encodedModule = await service.encode(moduleDatum, 'transferModule');

    await expect(service.decodeDatum(encodedEscrow, 'transferEscrow')).resolves.toEqual(escrowDatum);
    await expect(service.decodeDatum(encodedModule, 'transferModule')).resolves.toEqual(moduleDatum);
  });

  it('preserves V1 and appends V2/retire shard redeemer constructors', async () => {
    const packetData = {
      denom: '01',
      amount: '31',
      sender: '02',
      receiver: '03',
      memo: '',
    };
    const createV1 = await service.encode(
      {
        CreateEscrowShard: {
          channel_id: '00',
          denom: '01',
          data: packetData,
          registry_siblings: [],
        },
      },
      'transferEscrowShardRedeemer',
    );
    const createV2 = await service.encode(
      {
        CreateEscrowShardV2: {
          channel_id: '00',
          denom: '01',
          data: packetData,
          registry_siblings: [],
          old_channel_live_escrow_shard_count: 0n,
          channel_live_escrow_shard_count_siblings: [],
        },
      },
      'transferEscrowShardRedeemer',
    );
    const retire = await service.encode(
      {
        RetireEscrowShard: {
          channel_id: '00',
          denom: '01',
          registry_siblings: [],
          old_channel_live_escrow_shard_count: 1n,
          channel_live_escrow_shard_count_siblings: [],
          transfer_port_token: { policy_id: '11'.repeat(28), name: 'aa' },
        },
      },
      'transferEscrowShardRedeemer',
    );

    expect(createV1).toMatch(/^d87984/);
    expect(createV2).toMatch(/^d87a86/);
    expect(retire).toMatch(/^d87b86/);
  });

  it('appends ReclaimEscrowShard after existing transfer operators', async () => {
    const encoded = await service.encode(
      {
        Operator: [
          {
            ModuleOperatorV1: [
              {
                ReclaimEscrowShard: {
                  channel_id: '6368616e6e656c2d31',
                  denom: '6c6f76656c616365',
                },
              },
            ],
          },
        ],
      },
      'transferIBCModuleRedeemer',
    );

    // TransferModuleRedeemer constructor index 2 is encoded as tag 123 (`d87b`).
    expect(encoded).toContain('d87b82');
  });

  it('appends module lifecycle operations without shifting HostState constructors', async () => {
    const reclaim = await service.encode(
      { ReclaimHostState: { reclaim_to: 'aa' } },
      'host_state_redeemer',
    );
    const updateModule = await service.encode(
      { UpdateModuleState: { port_id: 'bb' } },
      'host_state_redeemer',
    );
    const reclaimModule = await service.encode(
      { ReclaimModule: { port_id: 'cc' } },
      'host_state_redeemer',
    );

    expect(reclaim).toMatch(/^d9050b81/);
    expect(updateModule).toMatch(/^d9050c81/);
    expect(reclaimModule).toMatch(/^d9050d81/);
  });
});
