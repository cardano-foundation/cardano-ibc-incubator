import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isTreeAligned } from '../../shared/helpers/ibc-state-root';
import { HostStateHeartbeatService } from '../host-state-heartbeat.service';

jest.mock('../../shared/helpers/ibc-state-root', () => ({
  alignTreeWithChain: jest.fn(),
  isTreeAligned: jest.fn(),
}));

describe('HostStateHeartbeatService', () => {
  const hostStateUtxo = {
    txHash: 'host-state-tx',
    outputIndex: 0,
    datum: 'host-state-datum',
  } as any;
  const hostStateDatum = {
    state: {
      version: 4n,
      ibc_state_root: '11'.repeat(32),
      next_client_sequence: 2n,
      next_connection_sequence: 3n,
      next_channel_sequence: 4n,
      bound_port: new Map([['7472616e73666572', {
        module_script_hash: '44'.repeat(28),
        port_token: { policy_id: '55'.repeat(28), name: '01' },
        module_token: { policy_id: '66'.repeat(28), name: '02' },
      }]]),
      last_update_time: 1_000n,
    },
    nft_policy: '22'.repeat(28),
    deployer: '33'.repeat(28),
    shutdown: 'Active',
    live_reference_script_count: 28n,
    reference_script_inventory_root: '44'.repeat(32),
    reference_script_registration: {
      target_count: 28n,
      target_root: '44'.repeat(32),
      last_out_ref: { transaction_id: '55'.repeat(32), output_index: 0n },
    },
  } as const;

  let lucidService: any;
  let historyService: any;
  let txOperationRunner: any;
  let service: HostStateHeartbeatService;

  beforeEach(() => {
    lucidService = {
      findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostStateUtxo),
      decodeDatum: jest.fn().mockResolvedValue(hostStateDatum),
      getPublicKeyHash: jest.fn().mockReturnValue(hostStateDatum.deployer),
      encode: jest.fn(async (_value: unknown, type: string) =>
        type === 'host_state_redeemer' ? 'encoded-heartbeat' : 'encoded-host-state',
      ),
      createUnsignedHostStateHeartbeatTransaction: jest.fn().mockReturnValue({ id: 'builder' }),
      LucidImporter: {
        SLOT_CONFIG_NETWORK: {
          Preprod: { zeroTime: 0, zeroSlot: 0, slotLength: 1_000 },
        },
      },
    };
    historyService = {
      findLatestBlock: jest.fn().mockResolvedValue({ epochNo: 8 }),
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue({ blockNo: 100 }),
      findBlockByHeight: jest.fn().mockResolvedValue({ epochNo: 7 }),
    };
    txOperationRunner = {
      run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2, 3]) }),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'ogmiosEndpoint') return 'ws://ogmios';
        if (key === 'cardanoNetwork') return 'Preprod';
        return undefined;
      }),
    };
    service = new HostStateHeartbeatService(
      new Logger(),
      configService as unknown as ConfigService,
      lucidService,
      historyService,
      txOperationRunner,
    );
    jest.spyOn(service as any, 'computeTxValidityWindow').mockResolvedValue({
      currentLedgerTime: 2_000,
      validFromTime: 1_900,
      validToTime: 3_000,
    });
    (isTreeAligned as jest.Mock).mockReturnValue(true);
  });

  it('does not build a heartbeat when HostState already has an anchor in the current epoch', async () => {
    historyService.findBlockByHeight.mockResolvedValue({ epochNo: 8 });

    await expect(service.buildHeartbeat({ signer: 'addr_test1signer' })).resolves.toEqual({
      heartbeat_required: false,
      current_epoch: 8,
      host_state_epoch: 8,
    });
    expect(lucidService.createUnsignedHostStateHeartbeatTransaction).not.toHaveBeenCalled();
    expect(txOperationRunner.run).not.toHaveBeenCalled();
  });

  it('builds a root-preserving, version-incrementing heartbeat for a missing epoch anchor', async () => {
    const response = await service.buildHeartbeat({ signer: 'addr_test1signer' });

    expect(response).toEqual({
      heartbeat_required: true,
      current_epoch: 8,
      host_state_epoch: 7,
      unsigned_tx: { type_url: '', value: new Uint8Array([1, 2, 3]) },
    });
    expect(lucidService.encode).toHaveBeenCalledWith('Heartbeat', 'host_state_redeemer');

    const encodedDatumCall = lucidService.encode.mock.calls.find(
      ([, type]: [unknown, string]) => type === 'host_state',
    );
    expect(encodedDatumCall[0]).toEqual({
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: 5n,
        last_update_time: 2_000n,
      },
    });

    const runnerPlan = txOperationRunner.run.mock.calls[0][0];
    expect(runnerPlan.wallet).toEqual({
      mode: 'refresh_from_address',
      address: 'addr_test1signer',
      context: 'hostStateHeartbeat',
    });
    expect(runnerPlan.pendingTreeUpdate.expectedNewRoot).toBe(
      hostStateDatum.state.ibc_state_root,
    );
  });

  it('fails closed while the current HostState transaction is not indexed', async () => {
    historyService.findTransactionEvidenceByHash.mockResolvedValue(null);

    await expect(
      service.buildHeartbeat({ signer: 'addr_test1signer' }),
    ).rejects.toThrow();
    expect(txOperationRunner.run).not.toHaveBeenCalled();
  });

  it('does not build heartbeats after shutdown begins', async () => {
    lucidService.decodeDatum.mockResolvedValue({
      ...hostStateDatum,
      shutdown: {
        ShuttingDown: { initiated_at: 1_000n, grace_period_end: 2_000n },
      },
    });

    await expect(
      service.buildHeartbeat({ signer: 'addr_test1signer' }),
    ).rejects.toThrow();
    expect(txOperationRunner.run).not.toHaveBeenCalled();
  });

  it('rejects a heartbeat signer that is not the deployment authority', async () => {
    lucidService.getPublicKeyHash.mockReturnValue('44'.repeat(28));

    await expect(
      service.buildHeartbeat({ signer: 'addr_test1other' }),
    ).rejects.toThrow();
    expect(txOperationRunner.run).not.toHaveBeenCalled();
  });
});
