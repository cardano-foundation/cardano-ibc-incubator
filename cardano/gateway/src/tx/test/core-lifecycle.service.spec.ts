import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CoreLifecycleService } from '../core-lifecycle.service';

describe('CoreLifecycleService', () => {
  const signerHash = '11'.repeat(28);
  const hostDatum = {
    state: {
      version: 7n,
      ibc_state_root: '22'.repeat(32),
      next_client_sequence: 2n,
      next_connection_sequence: 3n,
      next_channel_sequence: 4n,
      bound_port: new Map(),
      last_update_time: 1_000n,
      live_client_count: 1n,
      live_connection_count: 1n,
      live_channel_count: 0n,
    },
    nft_policy: '33'.repeat(28),
    deployer: signerHash,
    shutdown: 'Active',
    live_reference_script_count: 28n,
    reference_script_inventory_root: '44'.repeat(32),
    reference_script_registration: {
      target_count: 28n,
      target_root: '44'.repeat(32),
      last_out_ref: { transaction_id: '55'.repeat(32), output_index: 0n },
    },
  } as const;
  const connectionDatum = {
    state: {
      client_id: Buffer.from('07-tendermint-0').toString('hex'),
      versions: [],
      state: 'Open',
      counterparty: { client_id: '', connection_id: '', prefix: { key_prefix: '' } },
      delay_period: 0n,
    },
    token: { policyId: 'aa'.repeat(28), name: 'bb'.repeat(32) },
    live_channel_count: 0n,
    lifecycle: 'ConnectionActive',
  } as const;

  let lucidService: any;
  let runner: any;
  let service: CoreLifecycleService;

  beforeEach(() => {
    const hostUtxo = { txHash: 'host', outputIndex: 0, datum: 'host-datum', assets: {} };
    const connectionUtxo = {
      txHash: 'connection',
      outputIndex: 0,
      datum: 'connection-datum',
      assets: { [connectionDatum.token.policyId + connectionDatum.token.name]: 1n },
    };
    lucidService = {
      getPaymentCredential: jest.fn().mockReturnValue({ type: 'Key', hash: signerHash }),
      getConnectionTokenUnit: jest.fn().mockReturnValue([connectionDatum.token.policyId, connectionDatum.token.name]),
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostUtxo),
      findUtxoByUnit: jest.fn().mockResolvedValue(connectionUtxo),
      decodeDatum: jest.fn(async (datum: string) => (datum === 'host-datum' ? hostDatum : connectionDatum)),
      encode: jest.fn(
        async (value: unknown, type: string) =>
          `${type}:${JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item))}`,
      ),
      createUnsignedBeginConnectionRetirementTransaction: jest.fn().mockReturnValue({ id: 'tx-builder' }),
      LucidImporter: { SLOT_CONFIG_NETWORK: { Preprod: { slotLength: 1_000 } } },
    };
    runner = {
      run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2, 3]) }),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'ogmiosEndpoint') return 'ws://ogmios';
        if (key === 'cardanoNetwork') return 'Preprod';
        return undefined;
      }),
    };
    service = new CoreLifecycleService(
      new Logger(),
      configService as unknown as ConfigService,
      lucidService,
      runner,
      {} as any,
    );
    jest.spyOn(service as any, 'computeValidityWindow').mockResolvedValue({
      currentLedgerTime: 2_000,
      validFromTime: 1_900,
      validToSlot: 3,
      ledgerValidToTime: 3_000,
      validToTime: 3_999,
    });
  });

  it("uses the ledger upper bound, not Lucid's enclosing-slot timestamp, for connection retirement", async () => {
    await expect(
      service.beginConnectionRetirement({
        signer: 'addr_test1deployer',
        connection_id: 'connection-0',
      }),
    ).resolves.toEqual({ unsigned_tx: { type_url: '', value: new Uint8Array([1, 2, 3]) } });

    const builderDto = lucidService.createUnsignedBeginConnectionRetirementTransaction.mock.calls[0][0];
    expect(builderDto.signerKeyHash).toBe(signerHash);
    expect(builderDto.encodedConnectionRedeemer).toContain('604803000');
    expect(builderDto.encodedUpdatedConnectionDatum).toContain('604803000');
    const encodedHost = lucidService.encode.mock.calls.find(([, type]: [unknown, string]) => type === 'host_state')[0];
    expect(encodedHost.state.version).toBe(8n);
    expect(encodedHost.state.ibc_state_root).toBe(hostDatum.state.ibc_state_root);
    expect(runner.run.mock.calls[0][0].pendingTreeUpdate.expectedNewRoot).toBe(hostDatum.state.ibc_state_root);
  });

  it('anchors channel abandonment to the upper validity bound', async () => {
    const channelDatum = {
      state: {
        channel: {
          state: 'Init',
          ordering: 'Unordered',
          counterparty: { port_id: '', channel_id: '' },
          connection_hops: [],
          version: '',
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      },
      port: Buffer.from('transfer').toString('hex'),
      token: { policyId: 'cc'.repeat(28), name: 'dd'.repeat(32) },
      lifecycle: 'ChannelActive',
      voucher_supply: 0n,
    } as const;
    const channelTokenUnit = channelDatum.token.policyId + channelDatum.token.name;
    lucidService.getChannelTokenUnit = jest
      .fn()
      .mockReturnValue([channelDatum.token.policyId, channelDatum.token.name]);
    lucidService.findUtxoByUnit.mockResolvedValue({
      txHash: 'channel',
      outputIndex: 0,
      datum: 'channel-datum',
      assets: { [channelTokenUnit]: 1n },
    });
    lucidService.decodeDatum.mockImplementation(async (datum: string) =>
      datum === 'host-datum' ? hostDatum : channelDatum,
    );
    lucidService.createUnsignedBeginChannelAbandonmentTransaction = jest.fn().mockReturnValue({ id: 'tx-builder' });

    await expect(
      service.beginChannelAbandonment({
        signer: 'addr_test1deployer',
        port_id: 'transfer',
        channel_id: 'channel-0',
      }),
    ).resolves.toEqual({ unsigned_tx: { type_url: '', value: new Uint8Array([1, 2, 3]) } });

    const builderDto = lucidService.createUnsignedBeginChannelAbandonmentTransaction.mock.calls[0][0];
    expect(builderDto.signerKeyHash).toBe(signerHash);
    expect(builderDto.encodedChannelRedeemer).toContain('604803000');
    expect(builderDto.encodedUpdatedChannelDatum).toContain('604803000');
  });

  it('rejects retirement when the signer is not the HostState deployer', async () => {
    lucidService.getPaymentCredential.mockReturnValue({ type: 'Key', hash: '44'.repeat(28) });

    await expect(
      service.beginConnectionRetirement({
        signer: 'addr_test1other',
        connection_id: 'connection-0',
      }),
    ).rejects.toThrow(/deployer authority/i);
    expect(lucidService.createUnsignedBeginConnectionRetirementTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [1n, /outstanding voucher units/i],
    [0n, /exactly one connection hop/i],
  ])(
    'uses this channel liability for reclaim eligibility (voucher_supply=%s)',
    async (voucherSupply, expectedError) => {
      const liveHostDatum = {
        ...hostDatum,
        state: { ...hostDatum.state, live_channel_count: 1n },
      };
      const channelDatum = {
        state: {
          channel: {
            state: 'Close',
            ordering: 'Unordered',
            counterparty: { port_id: '', channel_id: '' },
            connection_hops: [],
            version: '',
          },
          next_sequence_send: 1n,
          next_sequence_recv: 1n,
          next_sequence_ack: 1n,
          packet_commitment: new Map(),
          packet_receipt: new Map(),
          packet_acknowledgement: new Map(),
          minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
          maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        },
        port: Buffer.from('transfer').toString('hex'),
        token: { policyId: 'cc'.repeat(28), name: 'dd'.repeat(32) },
        lifecycle: 'ChannelActive',
        voucher_supply: voucherSupply,
      } as const;
      const channelTokenUnit = channelDatum.token.policyId + channelDatum.token.name;
      lucidService.getChannelTokenUnit = jest
        .fn()
        .mockReturnValue([channelDatum.token.policyId, channelDatum.token.name]);
      lucidService.findUtxoByUnit.mockResolvedValue({
        txHash: 'channel',
        outputIndex: 0,
        datum: 'channel-datum',
        assets: { [channelTokenUnit]: 1n },
      });
      lucidService.decodeDatum.mockImplementation(async (datum: string) =>
        datum === 'host-datum' ? liveHostDatum : channelDatum,
      );
      jest.spyOn(service as any, 'ensureTreeAligned').mockResolvedValue(undefined);

      await expect(
        service.reclaimChannel({
          signer: 'addr_test1deployer',
          port_id: 'transfer',
          channel_id: 'channel-0',
        }),
      ).rejects.toThrow(expectedError);
    },
  );

  it('fails closed when the indexed object does not carry its datum auth token', async () => {
    lucidService.findUtxoByUnit.mockResolvedValue({
      txHash: 'connection',
      outputIndex: 0,
      datum: 'connection-datum',
      assets: {},
    });

    await expect(
      service.beginConnectionRetirement({
        signer: 'addr_test1deployer',
        connection_id: 'connection-0',
      }),
    ).rejects.toThrow(/auth token does not match/i);
    expect(lucidService.createUnsignedBeginConnectionRetirementTransaction).not.toHaveBeenCalled();
  });

  it('rejects an identifier whose sequence has leading zeroes before looking up a UTxO', async () => {
    await expect(
      service.beginConnectionRetirement({
        signer: 'addr_test1deployer',
        connection_id: 'connection-00',
      }),
    ).rejects.toThrow(/invalid connection_id/i);
    expect(lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
    expect(lucidService.findUtxoByUnit).not.toHaveBeenCalled();
  });

  it('treats a client as expired at the exact on-chain expiration boundary', () => {
    const datum = {
      state: {
        clientState: {
          frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
          trustingPeriod: 10n,
        },
      },
    };

    expect(() => (service as any).assertTerminalClient(datum, 999_990n, 1)).not.toThrow();
  });
});
