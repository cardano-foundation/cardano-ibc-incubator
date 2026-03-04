import { GrpcInternalException } from '~@/exception/grpc_exceptions';

import { WalletContextService } from '../wallet-context.service';

describe('WalletContextService', () => {
  const makeService = () => {
    const logger = {
      log: jest.fn(),
    } as any;

    const lucidService = {
      tryFindUtxosAt: jest.fn(),
      selectWalletFromAddress: jest.fn(),
    } as any;

    const service = new WalletContextService(logger, lucidService);

    return {
      service,
      logger,
      lucidService,
    };
  };

  it('selects wallet from address when UTxOs are available', async () => {
    const { service, logger, lucidService } = makeService();

    const walletUtxos = [
      {
        txHash: 'abc',
        outputIndex: 0,
        assets: {
          lovelace: 10_000_000n,
        },
      },
    ];

    lucidService.tryFindUtxosAt.mockResolvedValue(walletUtxos);

    await service.selectWalletFromAddressWithRetry('addr_test1wallet', 'createClient');

    expect(lucidService.tryFindUtxosAt).toHaveBeenCalledWith('addr_test1wallet', {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });
    expect(lucidService.selectWalletFromAddress).toHaveBeenCalledWith('addr_test1wallet', walletUtxos);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[walletContext] createClient selecting wallet from addr_test1wallet'),
    );
  });

  it('throws when no spendable UTxOs are found', async () => {
    const { service, lucidService } = makeService();

    lucidService.tryFindUtxosAt.mockResolvedValue([]);

    await expect(
      service.selectWalletFromAddressWithRetry('addr_test1missing', 'connectionOpenInit'),
    ).rejects.toBeInstanceOf(GrpcInternalException);

    await expect(
      service.selectWalletFromAddressWithRetry('addr_test1missing', 'connectionOpenInit'),
    ).rejects.toThrow(/no spendable UTxOs found/i);
  });
});
