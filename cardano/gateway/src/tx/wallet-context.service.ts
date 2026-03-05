import { Inject, Injectable, Logger } from '@nestjs/common';

import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';

import { sumLovelaceFromUtxos } from './helper/helper';

@Injectable()
export class WalletContextService {
  constructor(
    private readonly logger: Logger,
    @Inject(LucidService) private readonly lucidService: LucidService,
  ) {}

  async selectWalletFromAddressWithRetry(address: string, context: string): Promise<void> {
    const walletUtxos = await this.lucidService.tryFindUtxosAt(address, {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });

    if (walletUtxos.length === 0) {
      throw new GrpcInternalException(`${context} failed: no spendable UTxOs found for ${address}`);
    }

    this.lucidService.selectWalletFromAddress(address, walletUtxos);
    this.logger.log(
      `[walletContext] ${context} selecting wallet from ${address}, utxos=${walletUtxos.length}, lovelace_total=${sumLovelaceFromUtxos(
        walletUtxos,
      )}`,
    );
  }
}
