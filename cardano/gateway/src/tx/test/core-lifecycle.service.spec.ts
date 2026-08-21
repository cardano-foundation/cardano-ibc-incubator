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
      validToTime: 3_000,
    });
  });

  it('uses the fixed delay and deployer signer for connection retirement', async () => {
    await expect(
      service.beginConnectionRetirement({
        signer: 'addr_test1deployer',
        connection_id: 'connection-0',
      }),
    ).resolves.toEqual({ unsigned_tx: { type_url: '', value: new Uint8Array([1, 2, 3]) } });

    const builderDto = lucidService.createUnsignedBeginConnectionRetirementTransaction.mock.calls[0][0];
    expect(builderDto.signerKeyHash).toBe(signerHash);
    expect(builderDto.encodedConnectionRedeemer).toContain('604801900');
    expect(builderDto.encodedUpdatedConnectionDatum).toContain('604801900');
    const encodedHost = lucidService.encode.mock.calls.find(([, type]: [unknown, string]) => type === 'host_state')[0];
    expect(encodedHost.state.version).toBe(8n);
    expect(encodedHost.state.ibc_state_root).toBe(hostDatum.state.ibc_state_root);
    expect(runner.run.mock.calls[0][0].pendingTreeUpdate.expectedNewRoot).toBe(hostDatum.state.ibc_state_root);
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
