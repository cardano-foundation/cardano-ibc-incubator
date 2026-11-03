import { Logger } from '@nestjs/common';
import { HistoryService } from '../services/history.service';
import { latestPacketProofHeight } from '../services/settled-proof-height';
import { loadStakeWeightedStabilityEvidenceByHeight } from '../services/stability-evidence';
import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';

jest.mock('../services/stability-evidence', () => ({
  loadStakeWeightedStabilityEvidenceByHeight: jest.fn(),
}));

describe('packet proof history changes', () => {
  const evidence = jest.mocked(loadStakeWeightedStabilityEvidenceByHeight);
  const logger = {} as Logger;

  afterEach(() => jest.resetAllMocks());

  it('reads a fresh tip after a rollback interrupts the snapshot', async () => {
    const history = {
      findLatestBlock: jest.fn().mockResolvedValueOnce({ height: 100 }).mockResolvedValue({ height: 110 }),
    } as unknown as HistoryService;
    evidence.mockRejectedValueOnce(new YaciRestHistoryChangedError('changed'));
    evidence.mockResolvedValueOnce({ anchorHeight: 86n } as never);

    await expect(latestPacketProofHeight(history, logger)).resolves.toBe(86n);
    expect(history.findLatestBlock).toHaveBeenCalledTimes(2);
    expect(evidence.mock.calls.map(([request]) => request.height)).toEqual([76n, 86n]);
  });

  it('fails after repeated changes instead of returning an unchecked height', async () => {
    const history = { findLatestBlock: jest.fn().mockResolvedValue({ height: 100 }) } as unknown as HistoryService;
    const error = new YaciRestHistoryChangedError('changed');
    evidence.mockRejectedValue(error);

    await expect(latestPacketProofHeight(history, logger)).rejects.toBe(error);
    expect(history.findLatestBlock).toHaveBeenCalledTimes(3);
  });

  it('does not retry an invalid proof as a history race', async () => {
    const history = { findLatestBlock: jest.fn().mockResolvedValue({ height: 100 }) } as unknown as HistoryService;
    const error = new Error('Invalid VRF proof');
    evidence.mockRejectedValue(error);

    await expect(latestPacketProofHeight(history, logger)).rejects.toBe(error);
    expect(history.findLatestBlock).toHaveBeenCalledTimes(1);
  });
});
