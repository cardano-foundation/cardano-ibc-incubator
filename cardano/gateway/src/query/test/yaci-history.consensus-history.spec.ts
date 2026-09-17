import { YaciHistoryService } from '../services/yaci-history.service';

describe('YaciHistoryService historical client anchors', () => {
  it('loads the exact client NFT at the requested proof height', async () => {
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

    const result = await service.findUtxoByUnitAtOrBeforeBlockNo(
      '11'.repeat(28) + '22'.repeat(32),
      123n,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('block_no <= $1'),
      ['123', '11'.repeat(28), '22'.repeat(32)],
    );
    expect(result).toEqual(expect.objectContaining({
      txHash: 'aa'.repeat(32),
      outputIndex: 1,
      assetsPolicy: '11'.repeat(28),
      assetsName: '22'.repeat(32),
      blockNo: 123,
    }));
  });
});
