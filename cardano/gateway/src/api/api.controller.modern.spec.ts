jest.mock('~@/tx/packet.service', () => ({
  PacketService: class PacketService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ApiController } from './api.controller';
import { ChannelService } from '~@/query/services/channel.service';
import { PacketService } from '~@/tx/packet.service';
import { MsgTransfer } from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { CheqdIcqService } from './cheqd-icq.service';
import { VesseloracleIcqService } from './vesseloracle-icq.service';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { TransferPlannerService } from './transfer-planner.service';
import { BridgeManifestService } from '~@/query/services/bridge-manifest.service';

describe('ApiController (modern)', () => {
  let controller: ApiController;
  let channelServiceMock: {
    queryChannels: jest.Mock;
  };
  let packetServiceMock: {
    sendPacket: jest.Mock;
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
  let vesseloracleIcqServiceMock: {
    buildConsolidatedDataReportQuery: jest.Mock;
    decodeConsolidatedDataReportAcknowledgement: jest.Mock;
    findResult: jest.Mock;
  };
  let transferPlannerServiceMock: {
    planTransferRoute: jest.Mock;
  };
  let bridgeManifestServiceMock: {
    getBridgeManifest: jest.Mock;
  };

  beforeEach(async () => {
    // API controller tests assert request/response shaping only.
    // Channel/packet services are mocked so external IBC logic is out of scope here.
    channelServiceMock = {
      queryChannels: jest.fn(),
    };
    packetServiceMock = {
      sendPacket: jest.fn(),
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
    vesseloracleIcqServiceMock = {
      buildConsolidatedDataReportQuery: jest.fn(),
      decodeConsolidatedDataReportAcknowledgement: jest.fn(),
      findResult: jest.fn(),
    };
    transferPlannerServiceMock = {
      planTransferRoute: jest.fn(),
    };
    bridgeManifestServiceMock = {
      getBridgeManifest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: packetServiceMock },
        { provide: DenomTraceService, useValue: denomTraceServiceMock },
        { provide: LocalOsmosisSwapPlannerService, useValue: swapPlannerServiceMock },
        { provide: CheqdIcqService, useValue: cheqdIcqServiceMock },
        { provide: VesseloracleIcqService, useValue: vesseloracleIcqServiceMock },
        { provide: TransferPlannerService, useValue: transferPlannerServiceMock },
        { provide: BridgeManifestService, useValue: bridgeManifestServiceMock },
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

  it('delegates cheqd DidDoc ICQ tx building to CheqdIcqService', async () => {
    cheqdIcqServiceMock.buildDidDocQuery.mockResolvedValue({
      query_path: '/cheqd.did.v2.Query/DidDoc',
      source_port: 'icqhost',
      source_channel: 'channel-9',
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

  it('delegates vesseloracle consolidated-data-report ICQ tx building to VesseloracleIcqService', async () => {
    vesseloracleIcqServiceMock.buildConsolidatedDataReportQuery.mockResolvedValue({
      query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
      source_port: 'icqhost',
      source_channel: 'channel-4',
      packet_data_hex: 'beadfeed',
      tx: {
        result: 1,
        unsigned_tx: {
          type_url: '/ibc.core.channel.v1.MsgTransfer',
          value: Buffer.from([4, 5, 6]),
        },
      },
    });

    await expect(
      controller.buildVesseloracleConsolidatedDataReportIcq({
        source_channel: 'channel-4',
        signer: 'addr_test1q...',
        imo: '9525338',
        ts: '1713110400',
      } as any),
    ).resolves.toEqual({
      query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
      source_port: 'icqhost',
      source_channel: 'channel-4',
      packet_data_hex: 'beadfeed',
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([4, 5, 6]).toString('base64'),
      },
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

  it('delegates vesseloracle ICQ result polling to VesseloracleIcqService', async () => {
    vesseloracleIcqServiceMock.findResult.mockResolvedValue({
      status: 'completed',
      tx_hash: 'deadbeef',
      query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '118',
      completed_height: '118',
      packet_sequence: '7',
      acknowledgement_hex: 'bead',
      acknowledgement: {
        status: 'success',
        response: { consolidatedDataReport: { imo: '9525338', ts: '1713110400' } },
      },
    });

    await expect(
      controller.getVesseloracleIcqResult({
        tx_hash: 'deadbeef',
        query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
        packet_data_hex: 'c0ffee',
      } as any),
    ).resolves.toEqual({
      status: 'completed',
      tx_hash: 'deadbeef',
      query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
      packet_data_hex: 'c0ffee',
      current_height: '120',
      next_search_from_height: '118',
      completed_height: '118',
      packet_sequence: '7',
      acknowledgement_hex: 'bead',
      acknowledgement: {
        status: 'success',
        response: { consolidatedDataReport: { imo: '9525338', ts: '1713110400' } },
      },
    });
  });

  it('delegates transfer route planning to TransferPlannerService', async () => {
    transferPlannerServiceMock.planTransferRoute.mockResolvedValue({
      foundRoute: true,
      mode: 'unwind',
      chains: ['localosmosis', 'entrypoint'],
      routes: ['transfer/channel-0'],
      tokenTrace: {
        kind: 'ibc_voucher',
        path: 'transfer/channel-0',
        baseDenom: 'stake',
        fullDenom: 'transfer/channel-0/stake',
      },
    });

    await expect(
      controller.planTransferRoute({
        from_chain_id: 'localosmosis',
        to_chain_id: 'entrypoint',
        token_denom: 'ibc/ABC',
      }),
    ).resolves.toEqual({
      foundRoute: true,
      mode: 'unwind',
      chains: ['localosmosis', 'entrypoint'],
      routes: ['transfer/channel-0'],
      tokenTrace: {
        kind: 'ibc_voucher',
        path: 'transfer/channel-0',
        baseDenom: 'stake',
        fullDenom: 'transfer/channel-0/stake',
      },
    });

    expect(transferPlannerServiceMock.planTransferRoute).toHaveBeenCalledWith({
      fromChainId: 'localosmosis',
      toChainId: 'entrypoint',
      tokenDenom: 'ibc/ABC',
    });
  });

  it('returns the public bridge manifest', async () => {
    bridgeManifestServiceMock.getBridgeManifest.mockReturnValue({
      schema_version: 2,
      deployment_id: 'cardano-devnet:policy.token',
    });

    await expect(controller.getBridgeManifest()).resolves.toEqual({
      schema_version: 2,
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
      voucher_policy_id: null,
      ibc_denom_hash: null,
      display_name: 'ADA',
      display_symbol: 'ADA',
      display_description: 'Cardano native asset lovelace',
    });
  });

  it('returns a persisted voucher trace when policy id and voucher token match', async () => {
    const voucherPolicyId = 'a'.repeat(56);
    const voucherTokenName = 'b'.repeat(64);
    denomTraceServiceMock.findByHash.mockResolvedValue({
      hash: voucherTokenName,
      path: 'transfer/channel-7',
      base_denom: 'uatom',
      voucher_policy_id: voucherPolicyId.toUpperCase(),
      ibc_denom_hash: 'c'.repeat(64),
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
      voucher_policy_id: voucherPolicyId.toUpperCase(),
      ibc_denom_hash: 'c'.repeat(64),
      display_name: 'ATOM (IBC)',
      display_symbol: 'ATOM',
      display_description: 'IBC voucher for transfer/channel-7/uatom',
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
      voucher_policy_id: null,
      ibc_denom_hash: null,
      display_name: nativeAssetId,
      display_symbol: nativeAssetId,
      display_description: `Cardano native asset ${nativeAssetId}`,
    });
  });

  it('rejects malformed cardano asset ids', async () => {
    await expect(controller.getCardanoAssetDenomTrace('not-hex')).rejects.toThrow('"assetId"');
    expect(denomTraceServiceMock.findByHash).not.toHaveBeenCalled();
  });

  it('lists persisted ibc voucher assets through the http api', async () => {
    denomTraceServiceMock.findAll.mockResolvedValue([
      {
        hash: 'e'.repeat(64),
        path: 'transfer/channel-3',
        base_denom: 'gamm/pool/1',
        voucher_policy_id: 'f'.repeat(56),
        ibc_denom_hash: '1'.repeat(64),
      },
    ]);

    const response = await controller.listCardanoIbcAssets();

    expect(denomTraceServiceMock.findAll).toHaveBeenCalled();
    expect(response).toEqual([
      {
        asset_id: `${'f'.repeat(56)}${'e'.repeat(64)}`,
        kind: 'ibc_voucher',
        path: 'transfer/channel-3',
        base_denom: 'gamm/pool/1',
        full_denom: 'transfer/channel-3/gamm/pool/1',
        voucher_token_name: 'e'.repeat(64),
        voucher_policy_id: 'f'.repeat(56),
        ibc_denom_hash: '1'.repeat(64),
        display_name: '1 (IBC)',
        display_symbol: '1',
        display_description: 'IBC voucher for transfer/channel-3/gamm/pool/1',
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

  it('delegates local Osmosis swap estimates to LocalOsmosisSwapPlannerService', async () => {
    swapPlannerServiceMock.estimateSwap.mockResolvedValue({
      message: '',
      tokenOutAmount: '123',
      tokenOutTransferBackAmount: '120',
      tokenSwapAmount: '100',
      outToken: 'uosmo',
      transferRoutes: ['transfer/channel-0'],
      transferBackRoutes: ['transfer/channel-1'],
      transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
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
      message: '',
      tokenOutAmount: '123',
      tokenOutTransferBackAmount: '120',
      tokenSwapAmount: '100',
      outToken: 'uosmo',
      transferRoutes: ['transfer/channel-0'],
      transferBackRoutes: ['transfer/channel-1'],
      transferChains: ['cardano-devnet', 'entrypoint', 'localosmosis'],
    });
  });
});
