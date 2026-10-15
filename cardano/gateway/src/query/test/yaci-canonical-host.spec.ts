import { restProvider, restGateway } from '../../test-config/rest-provider';
import { restBlockFixture } from '../../test-config/rest-block';

describe('canonical historical HostState lookup through REST', () => {
  afterEach(() => jest.restoreAllMocks());
  function context(invalid = [1], consume = true, quantity = 1n) {
    const first = restBlockFixture();
    const second = restBlockFixture(101, first.metadata.hash, invalid, 3, consume ? first.hashes[0] : undefined, false, false, quantity);
    const provider = restProvider([first, second]);
    return { first, second, ...provider, ...restGateway(first) };
  }
  it('uses accepted raw outputs and the NFT unspent at the requested height', async () => {
    const { service, first, second, query } = context();
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(100n)).toMatchObject({ txHash: first.hashes[0], datum: '00' });
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(101n)).toMatchObject({ txHash: second.hashes[0], datum: '00' });
    expect(query).not.toHaveBeenCalled();
  });
  it('drops orphaned spends when REST returns a replacement block', async () => {
    const { service, first, state } = context();
    state.blocks = [first, restBlockFixture(101, first.metadata.hash, [1], 5, undefined, true)];
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(101n)).toMatchObject({ txHash: first.hashes[0] });
  });
  it('authenticates generic client and channel NFTs through the same history endpoints', async () => {
    const { service, first, second } = context();
    expect(await service.findUtxoByUnitAtOrBeforeBlockNo(first.unit, 101n)).toMatchObject({ txHash: second.hashes[0] });
  });
  it('fails closed on an incomplete asset index instead of returning a spent predecessor', async () => {
    const { service, second, state } = context();
    state.missingProducers.add(second.hashes[0]);
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(101n)).rejects.toThrow('HostState UTxO not found');
  });
  it.each([0n, 2n])('rejects a raw HostState NFT quantity of %s', async (quantity) => {
    const { service } = context([1], true, quantity);
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(101n)).rejects.toThrow('HostState UTxO not found');
  });
  it('rejects ambiguous live NFTs when spend history does not consume the predecessor', async () => {
    const { service } = context([1], false);
    await expect(service.findHostStateUtxoAtOrBeforeBlockNo(101n)).rejects.toThrow('Multiple canonical HostState UTxO outputs');
  });
  it('does not count invalid normal-input consumption as a state transition', async () => {
    const { service, first } = context([0, 1]);
    expect(await service.findHostStateUtxoAtOrBeforeBlockNo(101n)).toMatchObject({ txHash: first.hashes[0] });
  });
});
