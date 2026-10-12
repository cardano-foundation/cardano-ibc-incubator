import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { YaciHistoryService } from '../services/yaci-history.service';
import { restBlockFixture } from '../../test-config/rest-block';

describe('REST canonicality of imported transaction confirmations', () => {
  const fixture = restBlockFixture();
  const row = {
    tx_hash: fixture.hashes[0], block_no: 100, block_hash: fixture.metadata.hash,
    tx_index: 0, slot_no: 1000, tx_cbor_hex: fixture.bodies[0].to_cbor_hex(),
    tx_body_cbor_hex: fixture.bodies[0].to_cbor_hex(), gas_fee: 1, tx_size: 100,
  };
  const service = new YaciHistoryService(
    { get: () => 'https://yaci.example' } as unknown as ConfigService,
    {} as never,
    { query: async () => [row] } as unknown as EntityManager,
  );
  afterEach(() => jest.restoreAllMocks());

  it.each(['findTxByHash', 'findTransactionEvidenceByHash'] as const)('checks the remote block before returning %s', async (method) => {
    const request = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify(fixture.metadata)));
    await expect(service[method](fixture.hashes[0])).resolves.toBeTruthy();
    expect(request.mock.calls[0][0]).toBe('https://yaci.example/api/v1/blocks/100');
  });

  it.each(['findTxByHash', 'findTransactionEvidenceByHash'] as const)('rejects an orphaned local confirmation from %s', async (method) => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ...fixture.metadata, hash: 'ff'.repeat(32) })));
    await expect(service[method](fixture.hashes[0])).rejects.toThrow('no longer canonical');
  });
});
