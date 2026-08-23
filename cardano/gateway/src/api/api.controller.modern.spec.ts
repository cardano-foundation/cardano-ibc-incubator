jest.mock('~@/tx/packet.service', () => ({
  PacketService: class PacketService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ApiController } from './api.controller';
import { ChannelService } from '~@/query/services/channel.service';
import { PacketService } from '~@/tx/packet.service';
import { MsgTransfer } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { CheqdIcqService } from './cheqd-icq.service';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { TransferPlannerService } from './transfer-planner.service';
import { BridgeManifestService } from '~@/query/services/bridge-manifest.service';
import { QueryService } from '~@/query/services/query.service';
import { CoreLifecycleService } from '~@/tx/core-lifecycle.service';

describe('ApiController (modern)', () => {
  let controller: ApiController;
  let channelServiceMock: {
    queryChannels: jest.Mock;
    listCurrentChannelEnds: jest.Mock;
    getChannelHealth: jest.Mock;
  };
  let packetServiceMock: {
    sendPacket: jest.Mock;
    prunePacketHistory: jest.Mock;
    retireTransferEscrowShard: jest.Mock;
  };
  let denomTraceServiceMock: {
    findByHash: jest.Mock;
    findAll: jest.Mock;
  };
  let swapPlannerServiceMock: {
    getSwapOptions: jest.Mock;
    estimateSwap: jest.Mock;
  };
  let cheqdIcqServiceMock: {
    buildDidDocQuery: jest.Mock;
    decodeDidDocAcknowledgement: jest.Mock;
    findResult: jest.Mock;
  };
  let transferPlannerServiceMock: {
    planTransferRoute: jest.Mock;
  };
  let bridgeManifestServiceMock: {
    getBridgeManifest: jest.Mock;
  };
  let queryServiceMock: {
    queryPacketEventsByTxHash: jest.Mock;
    queryPacketEventsByPacket: jest.Mock;
  };
  let coreLifecycleServiceMock: Record<string, jest.Mock>;

  beforeEach(async () => {
    // API controller tests assert request/response shaping only.
    // Channel/packet services are mocked so external IBC logic is out of scope here.
    channelServiceMock = {
      queryChannels: jest.fn(),
      listCurrentChannelEnds: jest.fn(),
      getChannelHealth: jest.fn(),
    };
    packetServiceMock = {
      sendPacket: jest.fn(),
      prunePacketHistory: jest.fn(),
      retireTransferEscrowShard: jest.fn(),
    };
    denomTraceServiceMock = {
      findByHash: jest.fn(),
      findAll: jest.fn(),
    };
    swapPlannerServiceMock = {
      getSwapOptions: jest.fn(),
      estimateSwap: jest.fn(),
    };
    cheqdIcqServiceMock = {
      buildDidDocQuery: jest.fn(),
      decodeDidDocAcknowledgement: jest.fn(),
      findResult: jest.fn(),
    };
    transferPlannerServiceMock = {
      planTransferRoute: jest.fn(),
    };
    bridgeManifestServiceMock = {
      getBridgeManifest: jest.fn(),
    };
    queryServiceMock = {
      queryPacketEventsByTxHash: jest.fn(),
      queryPacketEventsByPacket: jest.fn(),
    };
    coreLifecycleServiceMock = {
      pruneTerminalClient: jest.fn(),
      reclaimClient: jest.fn(),
      beginConnectionRetirement: jest.fn(),
      reclaimConnection: jest.fn(),
      beginChannelAbandonment: jest.fn(),
      reclaimChannel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: packetServiceMock },
        { provide: DenomTraceService, useValue: denomTraceServiceMock },
        { provide: LocalOsmosisSwapPlannerService, useValue: swapPlannerServiceMock },
        { provide: CheqdIcqService, useValue: cheqdIcqServiceMock },
        { provide: TransferPlannerService, useValue: transferPlannerServiceMock },
        { provide: BridgeManifestService, useValue: bridgeManifestServiceMock },
        { provide: QueryService, useValue: queryServiceMock },
        { provide: CoreLifecycleService, useValue: coreLifecycleServiceMock },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  it('delegates getChannels to ChannelService and maps pagination/height to strings', async () => {
    // Public API contract uses stringified bigint fields and base64 for bytes.
    channelServiceMock.queryChannels.mockResolvedValue({
      channels: [],
      pagination: { next_key: Buffer.from('next'), total: 10n },
      height: { revision_height: 123n, revision_number: 7n },
    });

    const response = await controller.getChannels('', 0, 50, true, false);

    expect(channelServiceMock.queryChannels).toHaveBeenCalledWith(expect.anything());
    expect(response).toEqual({
      channels: [],
      pagination: {
        next_key: Buffer.from('next').toString('base64'),
        total: '10',
      },
      height: {
        revision_height: '123',
        revision_number: '7',
      },
    });
  });

  it('lists current Cardano channel ends without computing or returning a proof height', async () => {
    channelServiceMock.listCurrentChannelEnds.mockResolvedValue({
      channels: [
        {
          state: 3,
          ordering: 1,
          counterparty: { port_id: 'transfer', channel_id: 'channel-2' },
          connection_hops: ['connection-0'],
          version: 'ics20-1',
          port_id: 'transfer',
          channel_id: 'channel-8',
        },
      ],
      pagination: { next_key: Buffer.from('next'), total: 1n },
    });

    const response = await controller.getCardanoChannelEnds('', 0, 50, true, false);

    expect(channelServiceMock.listCurrentChannelEnds).toHaveBeenCalledWith(expect.anything());
    expect(channelServiceMock.queryChannels).not.toHaveBeenCalled();
    expect(response).toEqual({
      channels: [
        {
          state: 'STATE_OPEN',
          ordering: 'ORDER_UNORDERED',
          counterparty: { port_id: 'transfer', channel_id: 'channel-2' },
          connection_hops: ['connection-0'],
          version: 'ics20-1',
          port_id: 'transfer',
          channel_id: 'channel-8',
        },
      ],
      pagination: {
        next_key: Buffer.from('next').toString('base64'),
        total: '1',
      },
    });
    expect(response).not.toHaveProperty('height');
  });

  it('delegates Cardano channel health lookups to ChannelService', async () => {
    const expected = {
      port_id: 'transfer',
      channel_id: 'channel-0',
      status: 'available',
    };
    channelServiceMock.getChannelHealth.mockResolvedValue(expected);

    await expect(controller.getCardanoChannelHealth('channel-0', 'transfer')).resolves.toBe(expected);
    expect(channelServiceMock.getChannelHealth).toHaveBeenCalledWith('channel-0', 'transfer');
  });

  it('delegates buildTransferMsg to PacketService and base64-encodes unsigned tx bytes', async () => {
    // DTO -> MsgTransfer mapping should preserve transfer semantics while normalizing output bytes.
    packetServiceMock.sendPacket.mockResolvedValue({
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      },
    });

    const dto = {
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom: 'stake', amount: '1000' },
      sender: 'cosmos1sender',
      receiver: 'cosmos1receiver',
      timeout_height: { revision_number: '0', revision_height: '0' },
      timeout_timestamp: '0',
      memo: '',
    } as any;

    const response = await controller.buildTransferMsg(dto);

    expect(packetServiceMock.sendPacket).toHaveBeenCalledWith(expect.anything());
    const forwarded = packetServiceMock.sendPacket.mock.calls[0][0] as MsgTransfer;
    expect(forwarded.source_port).toBe('transfer');
    expect(forwarded.source_channel).toBe('channel-0');
    expect(forwarded.token?.denom).toBe('stake');
    expect(response).toEqual({
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'),
      },
    });
  });

  it('builds a permissionless prune request and preserves unsigned transaction bytes', async () => {
    packetServiceMock.prunePacketHistory.mockResolvedValue({
      unsigned_tx: { type_url: '', value: Buffer.from('deadbeef', 'utf8') },
    });

    const response = await controller.buildPrunePacketHistory({
      signer: 'addr_test1signer',
      port_id: 'transfer',
      channel_id: 'channel-7',
      sequence: '9',
      proof_commitment_absence: Buffer.from([0x0a, 0x00]).toString('base64'),
      proof_height: { revision_number: '0', revision_height: '55' },
    });

    expect(packetServiceMock.prunePacketHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: 'addr_test1signer',
        portId: 'transfer',
        channelId: 'channel-7',
        sequence: 9n,
        proofHeight: { revisionNumber: 0n, revisionHeight: 55n },
      }),
    );
    expect(response).toEqual({
      result: undefined,
      unsigned_tx: {
        type_url: '',
        value: Buffer.from('deadbeef', 'utf8').toString('base64'),
      },
    });
  });

  it.each([
    ['pruneTerminalClient', { signer: 'addr_test1signer', client_id: '07-tendermint-1' }],
    ['reclaimClient', { signer: 'addr_test1signer', client_id: '07-tendermint-1' }],
    ['beginConnectionRetirement', { signer: 'addr_test1signer', connection_id: 'connection-1' }],
    ['reclaimConnection', { signer: 'addr_test1signer', connection_id: 'connection-1' }],
    ['beginChannelAbandonment', { signer: 'addr_test1signer', port_id: 'transfer', channel_id: 'channel-1' }],
    ['reclaimChannel', { signer: 'addr_test1signer', port_id: 'transfer', channel_id: 'channel-1' }],
  ])('exposes lifecycle builder %s through HTTP', async (method, request) => {
    coreLifecycleServiceMock[method].mockResolvedValue({
      unsigned_tx: { type_url: '', value: new Uint8Array([1, 2, 3]) },
    });

    const response = await (controller as any)[method](request);

    expect(coreLifecycleServiceMock[method]).toHaveBeenCalledWith(request);
    expect(response.unsigned_tx.value).toBe(Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('exposes transfer escrow shard retirement through HTTP', async () => {
    packetServiceMock.retireTransferEscrowShard.mockResolvedValue({
      unsigned_tx: { type_url: '', value: new Uint8Array([4, 5, 6]) },
    });
    const response = await controller.retireTransferEscrowShard({
      signer: 'addr_test1signer',
      channel_id: 'channel-7',
      denom: '6c6f76656c616365',
    });

    expect(packetServiceMock.retireTransferEscrowShard).toHaveBeenCalledWith({
      signer: 'addr_test1signer',
      channelId: 'channel-7',
      denom: '6c6f76656c616365',
    });
    expect(response.unsigned_tx.value).toBe(
      Buffer.from([4, 5, 6]).toString('base64'),
    );
  });

  it('delegates cheqd DidDoc ICQ tx building to CheqdIcqService', async () => {
    cheqdIcqServiceMock.buildDidDocQuery.mockResolvedValue({
      query_path: '/cheqd.did.v2.Query/DidDoc',
      source_port: 'icqhost',
      source_channel: 'channel-9',
      packet_sequence: '7',
      packet_data_hex: 'deadbeef',
      tx: {
        result: 1,
        unsigned_tx: {
          type_url: '/ibc.core.channel.v1.MsgTransfer',
          value: Buffer.from([1, 2, 3]),
        },
      },
    });

    await expect(
      controller.buildCheqdDidDocIcq({
        source_channel: 'channel-9',
        signer: 'addr_test1q...',
        id: 'did:cheqd:testnet:abc123',
      } as any),
    ).resolves.toEqual({
      query_path: '/cheqd.did.v2.Query/DidDoc',
      source_port: 'icqhost',
      source_channel: 'channel-9',
      packet_sequence: '7',
      packet_data_hex: 'deadbeef',
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([1, 2, 3]).toString('base64'),
      },
    });
  });

  it('delegates cheqd DidDoc acknowledgement decoding to CheqdIcqService', async () => {
    cheqdIcqServiceMock.decodeDidDocAcknowledgement.mockReturnValue({
      status: 'success',
      response: { value: { did_doc: { id: 'did:cheqd:testnet:abc123' } } },
    });

    await expect(
      controller.decodeCheqdDidDocIcq({
        acknowledgement_hex: '7b22726573756c74223a2241513d3d227d',
      } as any),
    ).resolves.toEqual({
      status: 'success',
      response: { value: { did_doc: { id: 'did:cheqd:testnet:abc123' } } },
    });
  });

  it('delegates cheqd ICQ result polling to CheqdIcqService', async () => {
    cheqdIcqServiceMock.findResult.mockResolvedValue({
      status: 'completed',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '118',
      completed_height: '118',
      packet_sequence: '7',
      acknowledgement_hex: 'bead',
      acknowledgement: {
        status: 'success',
        response: { value: { did_doc: { id: 'did:cheqd:testnet:abc123' } } },
      },
    });

    await expect(
      controller.getCheqdIcqResult({
        tx_hash: 'deadbeef',
        query_path: '/cheqd.did.v2.Query/DidDoc',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'completed',
      tx_hash: 'deadbeef',
      query_path: '/cheqd.did.v2.Query/DidDoc',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '118',
      completed_height: '118',
      packet_sequence: '7',
      acknowledgement_hex: 'bead',
      acknowledgement: {
        status: 'success',
        response: { value: { did_doc: { id: 'did:cheqd:testnet:abc123' } } },
      },
    });
  });

  it('delegates transfer route planning to TransferPlannerService', async () => {
    transferPlannerServiceMock.planTransferRoute.mockResolvedValue({
      foundRoute: false,
      mode: null,
      chains: ['localosmosis', 'cardano-devnet'],
      routes: [],
      tokenTrace: null,
      failureCode: 'no-route-found',
    });

    await expect(
      controller.planTransferRoute({
        from_chain_id: 'localosmosis',
        to_chain_id: 'cardano-devnet',
        token_denom: 'ibc/ABC',
      }),
    ).resolves.toEqual({
      foundRoute: false,
      mode: null,
      chains: ['localosmosis', 'cardano-devnet'],
      routes: [],
      tokenTrace: null,
      failureCode: 'no-route-found',
    });

    expect(transferPlannerServiceMock.planTransferRoute).toHaveBeenCalledWith({
      fromChainId: 'localosmosis',
      toChainId: 'cardano-devnet',
      tokenDenom: 'ibc/ABC',
    });
  });

  it('returns the public bridge manifest', async () => {
    bridgeManifestServiceMock.getBridgeManifest.mockReturnValue({
      schema_version: 6,
      deployment_id: 'cardano-devnet:policy.token',
    });

    await expect(controller.getBridgeManifest()).resolves.toEqual({
      schema_version: 6,
      deployment_id: 'cardano-devnet:policy.token',
    });
    expect(bridgeManifestServiceMock.getBridgeManifest).toHaveBeenCalledWith();
  });

  it('propagates buildTransferMsg errors from PacketService', async () => {
    packetServiceMock.sendPacket.mockRejectedValue(new Error('Invalid denom'));

    const dto = {
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom: 'bad-denom', amount: '1' },
      sender: 'cosmos1sender',
      receiver: 'cosmos1receiver',
      timeout_height: { revision_number: '0', revision_height: '0' },
      timeout_timestamp: '0',
      memo: '',
    } as any;

    await expect(controller.buildTransferMsg(dto)).rejects.toThrow('Invalid denom');
  });

  it('returns a synthetic native trace for lovelace', async () => {
    const response = await controller.getCardanoAssetDenomTrace('lovelace');

    expect(denomTraceServiceMock.findByHash).not.toHaveBeenCalled();
    expect(response).toEqual({
      asset_id: 'lovelace',
      kind: 'native',
      path: '',
      base_denom: Buffer.from('lovelace', 'utf8').toString('hex'),
      full_denom: 'lovelace',
      voucher_token_name: null,
      cip68_reference_asset_id: null,
      voucher_policy_id: null,
      ibc_denom_hash: null,
      display_name: 'ADA',
      display_symbol: 'ADA',
      display_description: 'Cardano native asset lovelace',
      description: null,
      ticker: null,
      decimals: null,
      url: null,
      logo: null,
      metadata_version: null,
    });
  });

  it('returns a persisted voucher trace when policy id and voucher token match', async () => {
    const voucherPolicyId = 'a'.repeat(56);
    const voucherTokenName = `0014df10${'b'.repeat(56)}`;
    denomTraceServiceMock.findByHash.mockResolvedValue({
      hash: 'b'.repeat(56),
      path: 'transfer/channel-7',
      base_denom: 'uatom',
      full_denom: 'transfer/channel-7/uatom',
      voucher_token_name: voucherTokenName,
      voucher_reference_token_name: `000643b0${'b'.repeat(56)}`,
      voucher_policy_id: voucherPolicyId.toUpperCase(),
      ibc_denom_hash: 'c'.repeat(64),
      cip68_reference_asset_id: `${voucherPolicyId}${`000643b0${'b'.repeat(56)}`}`,
      name: 'uatom',
      description: 'IBC voucher for transfer/channel-7/uatom',
      ticker: 'uatom',
    });

    const response = await controller.getCardanoAssetDenomTrace(`${voucherPolicyId}${voucherTokenName}`);

    expect(denomTraceServiceMock.findByHash).toHaveBeenCalledWith(voucherTokenName);
    expect(response).toEqual({
      asset_id: `${voucherPolicyId}${voucherTokenName}`,
      kind: 'ibc_voucher',
      path: 'transfer/channel-7',
      base_denom: 'uatom',
      full_denom: 'transfer/channel-7/uatom',
      voucher_token_name: voucherTokenName,
      cip68_reference_asset_id: `${voucherPolicyId}${`000643b0${'b'.repeat(56)}`}`,
      voucher_policy_id: voucherPolicyId.toUpperCase(),
      ibc_denom_hash: 'c'.repeat(64),
      display_name: 'uatom',
      display_symbol: 'uatom',
      display_description: 'IBC voucher for transfer/channel-7/uatom',
      description: 'IBC voucher for transfer/channel-7/uatom',
      ticker: 'uatom',
      decimals: null,
      url: null,
      logo: null,
      metadata_version: null,
    });
  });

  it('falls back to a native asset response when the asset unit is not a stored voucher', async () => {
    const nativeAssetId = `${'d'.repeat(56)}${'ab'.repeat(4)}`;
    denomTraceServiceMock.findByHash.mockResolvedValue(null);

    const response = await controller.getCardanoAssetDenomTrace(nativeAssetId);

    expect(response).toEqual({
      asset_id: nativeAssetId,
      kind: 'native',
      path: '',
      base_denom: nativeAssetId,
      full_denom: nativeAssetId,
      voucher_token_name: null,
      cip68_reference_asset_id: null,
      voucher_policy_id: null,
      ibc_denom_hash: null,
      display_name: nativeAssetId,
      display_symbol: nativeAssetId,
      display_description: `Cardano native asset ${nativeAssetId}`,
      description: null,
      ticker: null,
      decimals: null,
      url: null,
      logo: null,
      metadata_version: null,
    });
  });

  it('rejects malformed cardano asset ids', async () => {
    await expect(controller.getCardanoAssetDenomTrace('not-hex')).rejects.toThrow('"assetId"');
    expect(denomTraceServiceMock.findByHash).not.toHaveBeenCalled();
  });

  it('lists persisted ibc voucher assets through the http api', async () => {
    denomTraceServiceMock.findAll.mockResolvedValue([
      {
        hash: 'e'.repeat(56),
        path: 'transfer/channel-3',
        base_denom: 'gamm/pool/1',
        full_denom: 'transfer/channel-3/gamm/pool/1',
        voucher_token_name: `0014df10${'e'.repeat(56)}`,
        voucher_reference_token_name: `000643b0${'e'.repeat(56)}`,
        voucher_policy_id: 'f'.repeat(56),
        ibc_denom_hash: '1'.repeat(64),
        cip68_reference_asset_id: `${'f'.repeat(56)}${`000643b0${'e'.repeat(56)}`}`,
        name: '1',
        description: 'IBC voucher for transfer/channel-3/gamm/pool/1',
        ticker: '1',
      },
    ]);

    const response = await controller.listCardanoIbcAssets();

    expect(denomTraceServiceMock.findAll).toHaveBeenCalled();
    expect(response).toEqual([
      {
        asset_id: `${'f'.repeat(56)}${`0014df10${'e'.repeat(56)}`}`,
        kind: 'ibc_voucher',
        path: 'transfer/channel-3',
        base_denom: 'gamm/pool/1',
        full_denom: 'transfer/channel-3/gamm/pool/1',
        voucher_token_name: `0014df10${'e'.repeat(56)}`,
        cip68_reference_asset_id: `${'f'.repeat(56)}${`000643b0${'e'.repeat(56)}`}`,
        voucher_policy_id: 'f'.repeat(56),
        ibc_denom_hash: '1'.repeat(64),
        display_name: '1',
        display_symbol: '1',
        display_description: 'IBC voucher for transfer/channel-3/gamm/pool/1',
        description: 'IBC voucher for transfer/channel-3/gamm/pool/1',
        ticker: '1',
        decimals: null,
        url: null,
        logo: null,
        metadata_version: null,
      },
    ]);
  });

  it('delegates local Osmosis swap options to LocalOsmosisSwapPlannerService', async () => {
    swapPlannerServiceMock.getSwapOptions.mockResolvedValue({
      from_chain_id: 'cardano-devnet',
      from_chain_name: 'Cardano',
      to_chain_id: 'localosmosis',
      to_chain_name: 'Local Osmosis',
      to_tokens: [{ token_id: 'uosmo', token_name: 'uosmo', token_logo: null }],
    });

    await expect(controller.getLocalOsmosisSwapOptions()).resolves.toEqual({
      from_chain_id: 'cardano-devnet',
      from_chain_name: 'Cardano',
      to_chain_id: 'localosmosis',
      to_chain_name: 'Local Osmosis',
      to_tokens: [{ token_id: 'uosmo', token_name: 'uosmo', token_logo: null }],
    });
    expect(swapPlannerServiceMock.getSwapOptions).toHaveBeenCalled();
  });

  it('delegates Cardano tx packet-event lookups to QueryService', async () => {
    queryServiceMock.queryPacketEventsByTxHash.mockResolvedValue({
      tx_hash: 'abc',
      height: '123',
      indexed: true,
      events: [],
    });

    await expect(controller.getCardanoTxPacketEvents('abc')).resolves.toEqual({
      tx_hash: 'abc',
      height: '123',
      indexed: true,
      events: [],
    });
    expect(queryServiceMock.queryPacketEventsByTxHash).toHaveBeenCalledWith('abc');
  });

  it('delegates Cardano packet-event searches to QueryService', async () => {
    queryServiceMock.queryPacketEventsByPacket.mockResolvedValue({ events: [] });

    await expect(
      controller.getCardanoPacketEvents('channel-1', 'channel-2', '7', 'acknowledge_packet'),
    ).resolves.toEqual({ events: [] });
    expect(queryServiceMock.queryPacketEventsByPacket).toHaveBeenCalledWith({
      sourceChannel: 'channel-1',
      destinationChannel: 'channel-2',
      sequence: '7',
      eventType: 'acknowledge_packet',
    });
  });

  it('delegates local Osmosis swap estimates to LocalOsmosisSwapPlannerService', async () => {
    swapPlannerServiceMock.estimateSwap.mockResolvedValue({
      message: 'Direct Cardano-to-target IBC routes are not implemented yet.',
      tokenOutAmount: '0',
      tokenOutTransferBackAmount: '0',
      tokenSwapAmount: '0',
      outToken: null,
      transferRoutes: [],
      transferBackRoutes: [],
      transferChains: [],
    });

    const response = await controller.estimateLocalOsmosisSwap({
      from_chain_id: 'cardano-devnet',
      token_in_denom: 'lovelace',
      token_in_amount: '100',
      to_chain_id: 'localosmosis',
      token_out_denom: 'uosmo',
    });

    expect(swapPlannerServiceMock.estimateSwap).toHaveBeenCalledWith({
      fromChainId: 'cardano-devnet',
      tokenInDenom: 'lovelace',
      tokenInAmount: '100',
      toChainId: 'localosmosis',
      tokenOutDenom: 'uosmo',
    });
    expect(response).toEqual({
      message: 'Direct Cardano-to-target IBC routes are not implemented yet.',
      tokenOutAmount: '0',
      tokenOutTransferBackAmount: '0',
      tokenSwapAmount: '0',
      outToken: null,
      transferRoutes: [],
      transferBackRoutes: [],
      transferChains: [],
    });
  });
});
