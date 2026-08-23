import * as LucidImporter from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

describe('LucidService HostState lifecycle codecs', () => {
  const service: any = Object.create(LucidService.prototype);
  service.LucidImporter = LucidImporter;

  it('appends infrastructure lifecycle variants without changing preceding HostState constructor indexes', async () => {
    const updateModule = await service.encode(
      { UpdateModuleState: { port_id: Buffer.from('transfer').toString('hex') } },
      'host_state_redeemer',
    );
    const reclaimModule = await service.encode(
      { ReclaimModule: { port_id: Buffer.from('transfer').toString('hex') } },
      'host_state_redeemer',
    );
    const registerReferences = await service.encode(
      {
        RegisterReferenceScripts: {
          target_count: 28n,
          target_root: '44'.repeat(32),
          batch_out_refs: [{ transaction_id: '66'.repeat(32), output_index: 7n }],
        },
      },
      'host_state_redeemer',
    );
    const reclaimReferences = await service.encode(
      { ReclaimReferenceScripts: { predecessor_root: '55'.repeat(32) } },
      'host_state_redeemer',
    );
    const finalizeReferences = await service.encode('FinalizeReferenceScriptRegistration', 'host_state_redeemer');

    // Constructor 19 uses the compact Plutus alternative tag 1292 (0xd9050c).
    expect(updateModule).toMatch(/^d9050c81487472616e73666572$/);
    // Constructor 20 is appended at compact Plutus alternative tag 1293.
    expect(reclaimModule).toMatch(/^d9050d81487472616e73666572$/);
    // Constructors 21 and 22 are appended after every existing operation.
    expect(registerReferences).toBe(`d9050e83181c5820${'44'.repeat(32)}81d879825820${'66'.repeat(32)}07`);
    expect(reclaimReferences).toBe(`d9050f815820${'55'.repeat(32)}`);
    // Constructor 23 remains the final, nullary registration transition.
    expect(finalizeReferences).toBe('d9051080');
  });

  it('round-trips registered and unregistered reference-script counts', async () => {
    const datum = {
      state: {
        version: 1n,
        ibc_state_root: '11'.repeat(32),
        next_client_sequence: 0n,
        next_connection_sequence: 0n,
        next_channel_sequence: 0n,
        bound_port: new Map(),
        last_update_time: 2n,
        live_client_count: 0n,
        live_connection_count: 0n,
        live_channel_count: 0n,
      },
      nft_policy: '22'.repeat(28),
      deployer: '33'.repeat(28),
      shutdown: 'Active',
      live_reference_script_count: 28n,
      reference_script_inventory_root: '44'.repeat(32),
      reference_script_registration: {
        target_count: 28n,
        target_root: '44'.repeat(32),
        last_out_ref: {
          transaction_id: '55'.repeat(32),
          output_index: 3n,
        },
      },
    } as const;

    for (const liveReferenceScriptCount of [28n, null]) {
      const expected =
        liveReferenceScriptCount === null
          ? {
              ...datum,
              live_reference_script_count: null,
              reference_script_inventory_root: '00'.repeat(32),
              reference_script_registration: null,
            }
          : datum;
      const encoded = await service.encode(expected, 'host_state');
      await expect(service.decodeDatum(encoded, 'host_state')).resolves.toEqual(expected);
    }
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
      service.encode({ AuthorizeTransferChannelReclaim: target }, 'lifecycleReclamationMarkerRedeemer'),
    ).resolves.toMatch(/^d87a83/);
    await expect(
      service.encode({ AuthorizeTransferModuleReclaim: target }, 'lifecycleReclamationMarkerRedeemer'),
    ).resolves.toMatch(/^d87b83/);
  });
});
