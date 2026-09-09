import { YaciHistoryService } from '../services/yaci-history.service';

describe('YaciHistoryService consensus-state history', () => {
  it('loads archive rows at the requested point and optional asset name', async () => {
    const query = jest.fn().mockResolvedValueOnce([{
      address: 'addr_test1history',
      tx_hash: 'aa'.repeat(32),
      tx_id: '4',
      output_index: '1',
      datum: 'd87980',
      datum_hash: 'bb'.repeat(32),
      assets_policy: '11'.repeat(28),
      assets_name: '22'.repeat(32),
      block_no: '123',
      block_id: '12',
    }]);
    const service = new YaciHistoryService(
      { get: jest.fn() } as never,
      {} as never,
      { query } as never,
    );

    const result = await service.findUtxosByAddressAndPolicyIdAtOrBeforeBlockNo(
      'addr_test1history',
      '11'.repeat(28),
      123n,
      '22'.repeat(32),
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('block_no <= $1'),
      ['123', 'addr_test1history', '11'.repeat(28), '22'.repeat(32)],
    );
    expect(result).toEqual([expect.objectContaining({
      txHash: 'aa'.repeat(32),
      outputIndex: 1,
      assetsPolicy: '11'.repeat(28),
      assetsName: '22'.repeat(32),
      blockNo: 123,
    })]);
  });
});
