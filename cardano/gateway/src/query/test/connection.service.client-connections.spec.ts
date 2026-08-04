import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryClientConnectionsResponse } from '@plus/proto-types/build/ibc/core/connection/v1/query';
import { GrpcInvalidArgumentException, GrpcNotFoundException } from '../../exception/grpc_exceptions';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { IbcTreeCacheService } from '../../shared/services/ibc-tree-cache.service';
import { ConnectionService } from '../services/connection.service';
import { HistoryService } from '../services/history.service';

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
  };

  let service: ConnectionService;
  let queryConnections: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    lucidService.findUtxoByUnit.mockResolvedValue({ datum: 'client-datum' });

    service = new ConnectionService(
      logger,
      {} as ConfigService,
      lucidService as unknown as LucidService,
      {} as KupoService,
      {} as MithrilService,
      {} as HistoryService,
      {} as IbcTreeCacheService,
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
});
