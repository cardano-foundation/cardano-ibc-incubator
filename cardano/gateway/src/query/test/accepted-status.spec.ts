import { Metadata } from '@grpc/grpc-js';
import { acceptedStatus } from '../services/accepted-status';
import * as settled from '../services/settled-proof-height';
import { QueryController } from '../query.controller';

describe('accepted application status', () => {
  afterEach(() => jest.restoreAllMocks());
  const history = () => ({
    findBlockByHeight: jest.fn(async (height: bigint) => ({
      hash: height === 123n ? 'anchor' : 'descendant',
      timestampUnixNs: 1795210428123456789n,
    })),
  });
  function anchor() {
    return jest.spyOn(settled, 'latestPacketProofAnchor').mockResolvedValue({
      proofHeight: 123n,
      anchorBlockHash: 'anchor',
      lastDescendant: { height: 147, hash: 'descendant' },
    });
  }
  it('returns the selected ledger timestamp without constructing another header', async () => {
    const selected = anchor();
    const h = history();
    expect(await acceptedStatus(h as any, {} as any)).toEqual({ height: 123n, timestampUnixNs: 1795210428123456789n });
    expect(selected).toHaveBeenCalledTimes(1);
    expect(h.findBlockByHeight.mock.calls).toEqual([[123n], [147n]]);
  });
  it.each([123n, 147n])('rejects a canonical change at %s', async (changed) => {
    anchor();
    const h = history();
    h.findBlockByHeight.mockImplementation(async (height) => ({
      hash: height === changed ? 'replaced' : height === 123n ? 'anchor' : 'descendant',
      timestampUnixNs: 1n,
    }));
    await expect(acceptedStatus(h as any, {} as any)).rejects.toThrow('Canonical chain changed');
  });
  it('rejects an unavailable timestamp', async () => {
    anchor();
    const h = history();
    h.findBlockByHeight.mockImplementation(async (height) => ({
      hash: height === 123n ? 'anchor' : 'descendant',
      timestampUnixNs: 0n,
    }));
    await expect(acceptedStatus(h as any, {} as any)).rejects.toThrow('timestamp is unavailable');
  });
  it('sends the exact timestamp with the matching height only when requested', async () => {
    const service = {
      latestAcceptedStatus: jest.fn(async () => ({ height: 123n, timestampUnixNs: 1795210428123456789n })),
      latestHeight: jest.fn(async () => ({ height: 99n })),
    };
    const controller = new QueryController(service as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const call = { sendMetadata: jest.fn() };
    expect(await controller.LatestHeight({})).toEqual({ height: 99n });
    expect(service.latestAcceptedStatus).not.toHaveBeenCalled();
    const metadata = new Metadata();
    metadata.set('x-cardano-include-timestamp', 'true');
    expect(await controller.LatestHeight({}, metadata, call as any)).toEqual({ height: 123n });
    expect(call.sendMetadata.mock.calls[0][0].get('x-cardano-block-timestamp-ns')).toEqual(['1795210428123456789']);
  });
});
