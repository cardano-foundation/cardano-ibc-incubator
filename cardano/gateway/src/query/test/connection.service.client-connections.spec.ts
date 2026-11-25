import { createTestTreeStore } from '../../shared/testing/ibc-tree-test-store';
import { status } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryClientConnectionsResponse } from '@cardano-ibc/proto-types/build/ibc/core/connection/v1/query';
import {
  GATEWAY_GRPC_ERROR_CODE,
  GrpcInvalidArgumentException,
  GrpcNotFoundException,
  GrpcUnavailableException,
} from '../../exception/grpc_exceptions';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { IbcTreeCacheService } from '../../shared/services/ibc-tree-cache.service';
import { ConnectionService } from '../services/connection.service';
import { HistoryService } from '../services/history.service';
import { resolveProofHeightForCurrentRoot } from '../services/proof-context';
import { decodeConnectionDatum } from '../../shared/types/connection/connection-datum';

jest.mock('../../shared/types/connection/connection-datum', () => ({
  decodeConnectionDatum: jest.fn(),
}));

jest.mock('../../shared/helpers/connection', () => ({
  getConnectionIdByTokenName: jest.fn((tokenName: string) => tokenName.replace('connection-token-', '')),
}));

jest.mock('../services/proof-context', () => ({
  resolveProofHeightForCurrentRoot: jest.fn(),
}));

describe('ConnectionService ClientConnections query', () => {
  const proofHeight = {
    revision_number: 0n,
    revision_height: 4_992_646n,
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const lucidService = {
    getClientAuthTokenUnit: jest.fn((clientSequence: bigint) => `client-token-${clientSequence}`),
    findUtxoByUnit: jest.fn().mockResolvedValue({ datum: 'client-datum' }),
    generateTokenName: jest.fn(() => 'connection-token-prefix'),
  };
  const configService = {
    get: jest.fn(() => ({
      hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
      validators: {
        mintConnectionStt: { scriptHash: 'connection-policy' },
        spendConnection: { address: 'addr_test1connection' },
      },
    })),
  };
  const kupoService = {
    queryUtxosAtAddressByPolicyAndTokenPrefix: jest.fn().mockResolvedValue([]),
  };

  let service: ConnectionService;
  let queryConnections: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    lucidService.findUtxoByUnit.mockResolvedValue({ datum: 'client-datum' });

    service = new ConnectionService(
      logger,
      configService as unknown as ConfigService,
      lucidService as unknown as LucidService,
      kupoService as unknown as KupoService,
      {} as HistoryService,
      {} as IbcTreeCacheService,
      createTestTreeStore(),
    );
    queryConnections = jest.spyOn(service, 'queryConnections');
  });

  it('returns every connection path for a known client with canonical proof semantics', async () => {
    queryConnections.mockResolvedValue({
      connections: [
        { id: 'connection-0', client_id: '07-tendermint-3' },
        { id: 'connection-1', client_id: '07-tendermint-4' },
        { id: 'connection-2', client_id: '07-tendermint-3' },
      ],
      height: proofHeight,
    });

    const response = await service.queryClientConnections({ client_id: '07-tendermint-3' });

    expect(lucidService.getClientAuthTokenUnit).toHaveBeenCalledWith(3n);
    expect(lucidService.findUtxoByUnit).toHaveBeenCalledWith('client-token-3');
    expect(queryConnections).toHaveBeenCalledWith({
      pagination: {
        key: new Uint8Array(),
        offset: 0n,
        limit: 18_446_744_073_709_551_615n,
        count_total: false,
        reverse: false,
      },
    });
    expect(response.connection_paths).toEqual(['connection-0', 'connection-2']);
    expect(response.proof).toEqual(new Uint8Array());
    expect(response.proof_height).toBe(proofHeight);

    const decoded = QueryClientConnectionsResponse.decode(QueryClientConnectionsResponse.encode(response).finish());
    expect(decoded.connection_paths).toEqual(['connection-0', 'connection-2']);
    expect(decoded.proof).toEqual(new Uint8Array());
    expect(decoded.proof_height).toEqual(proofHeight);
  });

  it('returns an empty path list for a known client without connections', async () => {
    queryConnections.mockResolvedValue({
      connections: [{ id: 'connection-0', client_id: '07-tendermint-4' }],
      height: proofHeight,
    });

    const response = await service.queryClientConnections({ client_id: '07-tendermint-3' });

    expect(response).toEqual({
      connection_paths: [],
      proof: new Uint8Array(),
      proof_height: proofHeight,
    });
  });

  it.each([
    [{}, 'missing'],
    [{ client_id: '' }, 'empty'],
    [{ client_id: '08-cardano-probabilistic-3' }, 'unsupported prefix'],
    [{ client_id: '07-tendermint-not-a-number' }, 'non-numeric sequence'],
  ])('rejects a %s client identifier as invalid (%s)', async (request, _description) => {
    await expect(service.queryClientConnections(request as any)).rejects.toBeInstanceOf(GrpcInvalidArgumentException);

    expect(lucidService.findUtxoByUnit).not.toHaveBeenCalled();
    expect(queryConnections).not.toHaveBeenCalled();
  });

  it('returns not found for a well-formed client that is missing on-chain', async () => {
    lucidService.findUtxoByUnit.mockRejectedValue(new GrpcNotFoundException('missing client UTxO'));

    await expect(service.queryClientConnections({ client_id: '07-tendermint-9' })).rejects.toBeInstanceOf(
      GrpcNotFoundException,
    );

    expect(lucidService.getClientAuthTokenUnit).toHaveBeenCalledWith(9n);
    expect(queryConnections).not.toHaveBeenCalled();
  });

  it('rejects connection listings as unavailable when the height lookup fails', async () => {
    (resolveProofHeightForCurrentRoot as jest.Mock).mockRejectedValue(new Error('history service offline'));

    await expectQueryHeightUnavailable(
      service.queryConnections({
        pagination: { key: new Uint8Array(), offset: 0n, limit: 50n, count_total: false, reverse: false },
      }),
    );
    await expectQueryHeightUnavailable(service.queryClientConnections({ client_id: '07-tendermint-3' }));
  });
});

describe('ConnectionService connection listing', () => {
  const toHex = (value: string) => Buffer.from(value, 'utf8').toString('hex');
  const configService = {
    get: jest.fn(() => ({
      hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
      validators: {
        mintConnectionStt: { scriptHash: 'connection-policy' },
        spendConnection: { address: 'addr_test1connection' },
      },
    })),
  };
  const kupoService = {
    queryUtxosAtAddressByPolicyAndTokenPrefix: jest.fn().mockResolvedValue([
      { datum: 'connection-datum', matchedTokenNames: ['connection-token-7'] },
      { datum: 'connection-datum', matchedTokenNames: ['connection-token-3'] },
    ]),
  };

  beforeEach(() => {
    (resolveProofHeightForCurrentRoot as jest.Mock).mockResolvedValue(4_992_646n);
    (decodeConnectionDatum as jest.Mock).mockResolvedValue({
      state: {
        client_id: toHex('07-tendermint-0'),
        versions: [],
        state: 'Open',
        counterparty: {
          client_id: toHex('08-cardano-0'),
          connection_id: toHex('connection-0'),
          prefix: { key_prefix: toHex('ibc') },
        },
        delay_period: 0n,
      },
    });
  });

  it('applies offsets to connection listings that fit within the limit', async () => {
    const service = new ConnectionService(
      { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger,
      configService as unknown as ConfigService,
      { generateTokenName: jest.fn(() => 'connection-token-prefix') } as unknown as LucidService,
      kupoService as unknown as KupoService,
      {} as HistoryService,
      {} as IbcTreeCacheService,
      createTestTreeStore(),
    );
    const pagination = (offset: bigint) => ({
      key: new Uint8Array(),
      offset,
      limit: 100n,
      count_total: true,
      reverse: false,
    });

    const page = await service.queryConnections({ pagination: pagination(1n) });
    expect(page.connections.map((connection) => connection.id)).toEqual(['connection-7']);
    expect(page.pagination).toEqual({ next_key: new Uint8Array(), total: 2n });
    expect((await service.queryConnections({ pagination: pagination(999n) })).connections).toEqual([]);
  });
});

async function expectQueryHeightUnavailable(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GrpcUnavailableException);
  const payload = (error as GrpcUnavailableException).getError() as { code: number; message: string };
  expect(payload.code).toBe(status.UNAVAILABLE);
  expect(payload.message).toContain(GATEWAY_GRPC_ERROR_CODE.QUERY_HEIGHT_UNAVAILABLE);
  expect(payload.message).toContain('history service offline');
}
