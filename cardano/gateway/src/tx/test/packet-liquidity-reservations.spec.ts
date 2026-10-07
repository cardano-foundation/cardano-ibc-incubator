import { PacketLaneService } from '../packet-lane.service';
import { buildPacketTimeout, selectPacketLiquidity } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  buildPacketTimeout: jest.fn(),
  selectPacketLiquidity: jest.fn(),
  record: jest.fn(),
}));
jest.mock('../../query/services/packet-state.service', () => ({ PacketStateService: class {} }));

it('selects refund liquidity from unreserved inputs after entering the completion scope', async () => {
  const busy = { txHash: 'busy', outputIndex: 0 } as any;
  const alternative = { txHash: 'alternative', outputIndex: 0 } as any;
  const lane = { txHash: 'lane', outputIndex: 0 } as any;
  const deployment = { client: {}, batchAddress: 'batch' } as any;
  const lucid = {
    lucid: { utxosAt: jest.fn().mockResolvedValue([busy, alternative]) },
    resolveClientAtHeights: jest.fn().mockResolvedValue({ clientUtxo: {}, historyWitnesses: [] }),
  };
  const service = new PacketLaneService({} as any, lucid as any, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(service, 'deployment').mockResolvedValue(deployment);
  jest.spyOn(service as any, 'packet').mockReturnValue({});
  jest.spyOn(service as any, 'proof').mockReturnValue({});
  jest.mocked(selectPacketLiquidity).mockImplementation((inputs) => inputs);
  jest.mocked(buildPacketTimeout).mockResolvedValue({ tx: {}, input: lane } as any);
  jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
    // Candidate discovery must happen after the runner refreshed reservations.
    expect(lucid.lucid.utxosAt).not.toHaveBeenCalled();
    const built = await build(0, 1000, (inputs: any[]) => inputs.filter((input) => input !== busy));
    expect(built.inputs).toEqual([lane, alternative]);
    return { value: new Uint8Array([1]) };
  });
  await service.settle(
    {
      signer: 'operator',
      packet: {
        source_port: 'transfer',
        source_channel: 'channel-0',
        sequence: 1n,
        data: Buffer.from(JSON.stringify({ denom: '6c6f76656c616365', amount: '20' })),
      },
      proof_height: { revision_number: 0n, revision_height: 1n },
    } as any,
    'timeout',
  );
  expect(selectPacketLiquidity).toHaveBeenCalledWith(
    [alternative],
    deployment,
    'transfer',
    'channel-0',
    '6c6f76656c616365',
    20n,
    1n,
  );
});
