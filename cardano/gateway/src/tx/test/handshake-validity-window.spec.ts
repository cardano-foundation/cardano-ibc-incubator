import { ChannelService } from '../channel.service';
import { ConnectionService } from '../connection.service';
import { ogmiosRequest } from '../../shared/helpers/ogmios';

jest.mock('../../shared/helpers/ogmios', () => ({ ogmiosRequest: jest.fn() }));

describe.each([ChannelService, ConnectionService])('%s handshake validity', (Service) => {
  it('uses the configured window from ledger time even when the local clock is ahead', async () => {
    const service = Object.create(Service.prototype) as any;
    service.configService = {
      getOrThrow: () => 'http://ogmios',
      get: (key: string) => key === 'cardanoNetwork' ? 'Preview' : 300_000,
    };
    service.lucidService = {
      LucidImporter: { SLOT_CONFIG_NETWORK: { Preview: { zeroTime: 0, zeroSlot: 0, slotLength: 1000 } } },
    };
    (ogmiosRequest as jest.Mock).mockResolvedValue({ slot: 500, id: 'tip' });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(9_000_000);
    try {
      await expect(service.computeTxValidityWindow()).resolves.toMatchObject({
        currentSlot: 500,
        validFromTime: 500_000,
        validToSlot: 800,
        validToTime: 800_000,
      });
    } finally {
      clock.mockRestore();
    }
  });
});
