import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { PacketService } from '../packet.service';

const channelDatum = (state = 'Close') => ({
  port: Buffer.from('transfer').toString('hex'),
  lifecycle: 'ChannelActive',
  state: {
    channel: { state },
    packet_commitment: new Map(),
    packet_receipt: new Map(),
    packet_acknowledgement: new Map(),
  },
});

function createService(state = 'Close') {
  const transferPortId = Buffer.from('transfer').toString('hex');
  const portToken = { policy_id: '44'.repeat(28), name: 'aa' };
  const moduleToken = { policy_id: '55'.repeat(28), name: 'bb' };
  const hostDatum = {
    state: {
      version: 4n,
      ibc_state_root: '11'.repeat(32),
      next_client_sequence: 2n,
      next_connection_sequence: 3n,
      next_channel_sequence: 4n,
      bound_port: new Map([
        [
          transferPortId,
          {
            module_script_hash: 'transfer-script',
            port_token: portToken,
            module_token: moduleToken,
          },
        ],
      ]),
      last_update_time: 900n,
      live_client_count: 1n,
      live_connection_count: 1n,
      live_channel_count: 1n,
    },
    nft_policy: '22'.repeat(28),
    deployer: '33'.repeat(28),
    shutdown: 'Active',
  };
  const channelUtxo = {
    txHash: 'channel',
    outputIndex: 0,
    datum: 'channel-datum',
    assets: {},
  };
  const hostStateUtxo = {
    txHash: 'host',
    outputIndex: 0,
    datum: 'host-datum',
    assets: {},
  };
  const unsignedTx = { kind: 'retire-tx' };
  const lucidService = {
    getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy', 'channel-name']),
    findUtxoByUnit: jest.fn().mockResolvedValue(channelUtxo),
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue(hostStateUtxo),
    decodeDatum: jest.fn().mockImplementation(async (_datum: string, codec: string) =>
      codec === 'host_state' ? hostDatum : channelDatum(state)
    ),
    encode: jest.fn().mockImplementation(async (_value: unknown, codec: string) =>
      `encoded:${codec}`
    ),
    createUnsignedRetireTransferEscrowShardTx: jest.fn().mockReturnValue(unsignedTx),
  };
  const service = new PacketService(
    { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger,
    {
      get: jest.fn().mockReturnValue({
        validators: { spendTransferModule: { scriptHash: 'transfer-script' } },
      }),
    } as unknown as ConfigService,
    lucidService as unknown as LucidService,
    {} as DenomTraceService,
    {} as any,
    {} as any,
    {} as any,
  );
  (service as any).computeTxValidityWindow = jest.fn().mockResolvedValue({
    currentLedgerTime: 1_000,
    validFromTime: 1_000,
    validToTime: 2_000,
  });
  jest.spyOn(service, 'prepareTransferEscrowShardRetirement').mockResolvedValue({
    transferModuleUtxo: {
      txHash: 'module',
      outputIndex: 0,
      assets: {
        [portToken.policy_id + portToken.name]: 1n,
        [moduleToken.policy_id + moduleToken.name]: 1n,
      },
    } as any,
    shardUtxo: { txHash: 'shard', outputIndex: 0, datum: 'shard-datum', assets: {} } as any,
    shardTokenUnit: 'shard-unit',
    registrySiblings: ['11'],
    oldChannelLiveEscrowShardCount: 1n,
    channelLiveEscrowShardCountSiblings: ['22'],
    encodedUpdatedTransferModuleDatum: 'updated-module',
    encodedShardDatum: 'shard-datum',
  });
  return { service, lucidService, channelUtxo, hostStateUtxo, unsignedTx, hostDatum, portToken };
}

describe('PacketService escrow shard retirement builder', () => {
  it('uses UpdateModuleState and exact retirement/count witnesses', async () => {
    const { service, lucidService, unsignedTx, hostDatum, portToken } = createService();

    const result = await service.buildUnsignedRetireTransferEscrowShardTx({
      channelId: 'channel-7',
      denom: Buffer.from('lovelace').toString('hex'),
      signer: 'addr_test1operator',
    });

    expect(result).toEqual({
      unsignedTx,
      validFromTime: 1_000,
      validToTime: 2_000,
    });
    expect(lucidService.encode).toHaveBeenCalledWith(
      {
        UpdateModuleState: {
          port_id: Buffer.from('transfer').toString('hex'),
        },
      },
      'host_state_redeemer',
    );
    expect(lucidService.encode).toHaveBeenCalledWith(
      {
        ...hostDatum,
        state: {
          ...hostDatum.state,
          version: 5n,
          last_update_time: 1_000n,
        },
      },
      'host_state',
    );
    expect(lucidService.encode).toHaveBeenCalledWith(
      expect.objectContaining({
        RetireEscrowShard: expect.objectContaining({
          registry_siblings: ['11'],
          old_channel_live_escrow_shard_count: 1n,
          channel_live_escrow_shard_count_siblings: ['22'],
          transfer_port_token: portToken,
        }),
      }),
      'transferEscrowShardRedeemer',
    );
    expect(lucidService.createUnsignedRetireTransferEscrowShardTx).toHaveBeenCalledWith(
      expect.objectContaining({
        encodedUpdatedHostStateDatum: 'encoded:host_state',
        encodedUpdatedTransferModuleDatum: 'updated-module',
        transferEscrowShardTokenUnit: 'shard-unit',
      }),
    );
  });

  it('rejects a non-terminal channel before preparing the registry transition', async () => {
    const { service } = createService('Open');
    await expect(
      service.buildUnsignedRetireTransferEscrowShardTx({
        channelId: 'channel-7',
        denom: 'lovelace',
        signer: 'addr_test1operator',
      }),
    ).rejects.toThrow(/not terminal, drained, and reclaimable/);
    expect(service.prepareTransferEscrowShardRetirement).not.toHaveBeenCalled();
  });
});
