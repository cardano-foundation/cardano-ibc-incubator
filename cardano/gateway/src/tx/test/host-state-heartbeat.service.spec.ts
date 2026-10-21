import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HOST_STATE_HEARTBEAT_INTERVAL_MS as INTERVAL } from '../../config/constant.config';
import { IbcTreeStateStore } from '../../shared/helpers/ibc-state-root';
import { HostStateHeartbeatService } from '../host-state-heartbeat.service';

describe('HostStateHeartbeatService', () => {
  const now = 100_000_000;
  const hostStateUtxo = { txHash: 'host-state-tx', outputIndex: 0, datum: 'host-state-datum' } as any;
  const hostStateDatum = {
    state: {
      version: 4n,
      ibc_state_root: '11'.repeat(32),
      next_client_sequence: 2n,
      next_connection_sequence: 3n,
      next_channel_sequence: 4n,
      bound_port: [],
      last_update_time: 1_000n,
    },
    nft_policy: '22'.repeat(28),
    deployer: '33'.repeat(28),
    control: {
      port_registry: new Map([
        [
          '7472616e73666572',
          {
            module_script_hash: '44'.repeat(28),
            port_token: { policy_id: '55'.repeat(28), name: '01' },
            module_token: { policy_id: '66'.repeat(28), name: '02' },
          },
        ],
      ]),
      shutdown: 'Active',
      live_clients: 0n,
      live_connections: 0n,
      live_channels: 0n,
      last_heartbeat_time: 0n,
    },
  } as const;

  let lucidService: any;
  let historyService: any;
  let runner: any;
  let service: HostStateHeartbeatService;
  let validity: { validFromTime: number; validToTime: number; currentLedgerTime: number };

  beforeEach(() => {
    lucidService = {
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostStateUtxo),
      decodeDatum: jest.fn().mockResolvedValue(hostStateDatum),
      getPublicKeyHash: jest.fn().mockReturnValue('99'.repeat(28)),
      encode: jest.fn(async (_value: unknown, type: string) => type),
      createUnsignedHostStateHeartbeatTransaction: jest.fn(),
    };
    historyService = {
      findLatestBlock: jest.fn().mockResolvedValue({ epochNo: 8, timestampUnixNs: BigInt(now) * 1_000_000n }),
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue({ blockNo: 100 }),
      findBlockByHeight: jest
        .fn()
        .mockResolvedValue({ epochNo: 8, timestampUnixNs: BigInt(now - INTERVAL - 1) * 1_000_000n }),
    };
    runner = { run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2, 3]) }) };
    service = new HostStateHeartbeatService(new Logger(), {} as ConfigService, lucidService, historyService, runner, {
      getAlignedSnapshot: jest
        .fn()
        .mockResolvedValue({ root: hostStateDatum.state.ibc_state_root, hostState: hostStateUtxo }),
      computeRootWithHeartbeatUpdate: jest.fn().mockReturnValue({ commit: jest.fn() }),
    } as unknown as IbcTreeStateStore);
    validity = { currentLedgerTime: now, validFromTime: now, validToTime: now + 120_000 };
    jest.spyOn(service as any, 'computeTxValidityWindow').mockImplementation(async () => validity);
  });

  it('lets an independent funded signer heartbeat within the same epoch', async () => {
    const response = await service.buildHeartbeat({ signer: 'addr_test1relayer' });
    expect(response.heartbeat_required).toBe(true);
    expect(response.next_check_delay_ms).toBe(INTERVAL + 120_000);
    const encoded = lucidService.encode.mock.calls.find(([, type]: any[]) => type === 'host_state')[0];
    expect(encoded).toEqual({
      ...hostStateDatum,
      state: { ...hostStateDatum.state, version: 5n, last_update_time: BigInt(validity.validToTime) },
      control: { ...hostStateDatum.control, last_heartbeat_time: BigInt(validity.validToTime) },
    });
    const plan = runner.run.mock.calls[0][0];
    await plan.unsignedTx();
    expect(lucidService.createUnsignedHostStateHeartbeatTransaction).toHaveBeenCalledWith(
      hostStateUtxo,
      'host_state_redeemer',
      'host_state',
      '99'.repeat(28),
    );
    expect(plan.wallet.address).toBe('addr_test1relayer');
  });

  it('suppresses heartbeats after recent ordinary HostState activity', async () => {
    historyService.findBlockByHeight.mockResolvedValue({
      epochNo: 8,
      timestampUnixNs: BigInt(now - 1_000) * 1_000_000n,
    });
    const result = await service.buildHeartbeat({ signer: 'addr_test1relayer' });
    expect(result.heartbeat_required).toBe(false);
    expect(result.next_check_delay_ms).toBe(INTERVAL - 1_000);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('waits for the protected clock even when the monitoring timestamp is old', async () => {
    lucidService.decodeDatum.mockResolvedValue({
      ...hostStateDatum,
      control: { ...hostStateDatum.control, last_heartbeat_time: BigInt(now - 1_000) },
    });
    expect((await service.buildHeartbeat({ signer: 'addr_test1relayer' })).next_check_delay_ms).toBe(INTERVAL - 1_000);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('allows a heartbeat at the exact cooldown boundary', async () => {
    lucidService.decodeDatum.mockResolvedValue({
      ...hostStateDatum,
      control: { ...hostStateDatum.control, last_heartbeat_time: BigInt(now - INTERVAL) },
    });
    expect((await service.buildHeartbeat({ signer: 'addr_test1relayer' })).heartbeat_required).toBe(true);
  });

  it('ignores a caller-written future monitoring timestamp', async () => {
    lucidService.decodeDatum.mockResolvedValue({
      ...hostStateDatum,
      state: { ...hostStateDatum.state, last_update_time: 999_999_999_999n },
    });
    expect((await service.buildHeartbeat({ signer: 'addr_test1relayer' })).heartbeat_required).toBe(true);
  });

  it('rejects a signer without a payment key', async () => {
    lucidService.getPublicKeyHash.mockReturnValue(undefined);
    await expect(service.buildHeartbeat({ signer: 'addr_test1script' })).rejects.toThrow();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails closed when the current HostState transaction is not indexed', async () => {
    historyService.findTransactionEvidenceByHash.mockResolvedValue(null);
    await expect(service.buildHeartbeat({ signer: 'addr_test1relayer' })).rejects.toThrow();
  });

  it('rejects heartbeats during shutdown', async () => {
    lucidService.decodeDatum.mockResolvedValue({
      ...hostStateDatum,
      control: { ...hostStateDatum.control, shutdown: { ShuttingDown: { initiated_at: 1n, grace_period_end: 2n } } },
    });
    await expect(service.buildHeartbeat({ signer: 'addr_test1relayer' })).rejects.toThrow();
    expect(runner.run).not.toHaveBeenCalled();
  });
});
