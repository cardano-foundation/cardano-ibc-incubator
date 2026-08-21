import * as LucidImporter from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

describe('LucidService HostState lifecycle codecs', () => {
  const service: any = Object.create(LucidService.prototype);
  service.LucidImporter = LucidImporter;

  it('appends module lifecycle variants without changing preceding HostState constructor indexes', async () => {
    const updateModule = await service.encode(
      { UpdateModuleState: { port_id: Buffer.from('transfer').toString('hex') } },
      'host_state_redeemer',
    );
    const reclaimModule = await service.encode(
      { ReclaimModule: { port_id: Buffer.from('transfer').toString('hex') } },
      'host_state_redeemer',
    );

    // Constructor 19 uses the compact Plutus alternative tag 1292 (0xd9050c).
    expect(updateModule).toMatch(/^d9050c81487472616e73666572$/);
    // Constructor 20 is appended at compact Plutus alternative tag 1293.
    expect(reclaimModule).toMatch(/^d9050d81487472616e73666572$/);
  });

  it('encodes every core cleanup Host/object/mint redeemer', async () => {
    const token = { policyId: '11'.repeat(28), name: '22'.repeat(32) };
    const reclaimTo = '33'.repeat(28);
    const hostRedeemers = [
      { PruneTerminalClient: { removed_consensus_state_siblings: [[]] } },
      'BeginConnectionRetirement',
      'BeginChannelAbandonment',
      {
        ReclaimClient: {
          reclaim_to: reclaimTo,
          client_state_siblings: [],
          consensus_state_siblings: [],
          client_connection_count_siblings: [],
        },
      },
      {
        ReclaimConnection: {
          reclaim_to: reclaimTo,
          connection_siblings: [],
          client_connection_count: 1n,
          client_connection_count_siblings: [],
        },
      },
      {
        ReclaimChannel: {
          reclaim_to: reclaimTo,
          channel_siblings: [],
          next_sequence_send_siblings: [],
          next_sequence_recv_siblings: [],
          next_sequence_ack_siblings: [],
        },
      },
    ];
    for (const redeemer of hostRedeemers) {
      await expect(service.encode(redeemer, 'host_state_redeemer')).resolves.toMatch(/^[0-9a-f]+$/);
    }

    await expect(service.encode('PruneTerminalConsensusStates', 'spendClientRedeemer')).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(service.encode({ ReclaimClient: { reclaim_to: reclaimTo } }, 'spendClientRedeemer')).resolves.toMatch(
      /^[0-9a-f]+$/,
    );
    await expect(
      service.encode({ BurnClient: { token, reclaim_to: reclaimTo } }, 'mintClientRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ BeginConnectionRetirement: { not_before: 10n } }, 'spendConnectionRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ ReclaimConnection: { reclaim_to: reclaimTo } }, 'spendConnectionRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ BurnConnection: { token, reclaim_to: reclaimTo } }, 'mintConnectionRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ BeginChannelAbandonment: { not_before: 10n } }, 'spendChannelRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ ReclaimChannel: { reclaim_to: reclaimTo } }, 'spendChannelRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
    await expect(
      service.encode({ BurnChannel: { token, reclaim_to: reclaimTo } }, 'mintChannelRedeemer'),
    ).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it('encodes creation, generic cleanup, and transfer-target receipt redeemers', async () => {
    const target = {
      port_id: Buffer.from('transfer').toString('hex'),
      port_token: { policy_id: '11'.repeat(28), name: 'aa' },
      module_token: { policy_id: '22'.repeat(28), name: 'bb' },
    };

    await expect(service.encode('AuthorizeCreation', 'lifecycleCreationMarkerRedeemer')).resolves.toBe('d87980');
    await expect(service.encode('AuthorizeOperation', 'lifecycleOperationalMarkerRedeemer')).resolves.toBe('d87980');
    await expect(service.encode('AuthorizePacket', 'lifecyclePacketMarkerRedeemer')).resolves.toBe('d87980');
    await expect(service.encode('AuthorizeLifecycle', 'lifecycleReclamationMarkerRedeemer')).resolves.toBe('d87980');
    await expect(
      service.encode(
        { AuthorizeTransferChannelReclaim: target },
        'lifecycleReclamationMarkerRedeemer',
      ),
    ).resolves.toMatch(/^d87a83/);
    await expect(
      service.encode(
        { AuthorizeTransferModuleReclaim: target },
        'lifecycleReclamationMarkerRedeemer',
      ),
    ).resolves.toMatch(/^d87b83/);
  });
});
