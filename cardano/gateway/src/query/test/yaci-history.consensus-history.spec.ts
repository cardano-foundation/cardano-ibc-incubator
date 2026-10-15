import { YaciHistoryService } from '../services/yaci-history.service';
import { YaciRestHistory } from '../../shared/helpers/yaci-rest-history';
import { YaciRestClient } from '../../shared/helpers/yaci-rest';

describe('REST historical client anchors', () => {
  afterEach(() => jest.restoreAllMocks());
  it('loads the exact client NFT at the requested height without querying PostgreSQL', async () => {
    const unit = '11'.repeat(28) + '22'.repeat(32);
    jest.spyOn(YaciRestClient.prototype, 'block').mockResolvedValue({ number: 123, hash: 'aa'.repeat(32) } as never);
    const outputs = jest.spyOn(YaciRestHistory.prototype, 'outputs').mockResolvedValue([{
      address: 'addr_test1history', tx_hash: 'bb'.repeat(32), output_index: 1,
      inline_datum: 'd87980', data_hash: 'cc'.repeat(32), block: 123, tx_index: 0, amounts: [{ unit, quantity: '1' }],
    }]);
    const query = jest.fn();
    const service = new YaciHistoryService({ get: () => 'https://yaci.example' } as never, {} as never, { query } as never);
    const result = await service.findUtxoByUnitAtOrBeforeBlockNo(unit, 123n);
    expect(outputs).toHaveBeenCalledWith({ policy: unit.slice(0, 56), unit, unspent: true }, 123);
    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({ txHash: 'bb'.repeat(32), outputIndex: 1, assetsPolicy: unit.slice(0, 56), assetsName: unit.slice(56), blockNo: 123 });
  });
});
