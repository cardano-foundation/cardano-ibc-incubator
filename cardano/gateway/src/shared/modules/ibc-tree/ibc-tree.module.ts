import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IbcTreeStateStore, type IbcTreeDeployment } from '../../helpers/ibc-state-root';
import { KupoModule } from '../kupo/kupo.module';
import { KupoService } from '../kupo/kupo.service';
import { LucidModule } from '../lucid/lucid.module';
import { LucidService } from '../lucid/lucid.service';

@Module({
  imports: [ConfigModule, KupoModule, LucidModule],
  providers: [{
    provide: IbcTreeStateStore,
    inject: [ConfigService, KupoService, LucidService],
    useFactory: (config: ConfigService, kupo: KupoService, lucid: LucidService) => {
      const deployment = config.getOrThrow<{
        hostStateNFT: IbcTreeDeployment['hostStateNFT'];
        validators?: {
          mintClientStt?: { scriptHash?: string };
          spendConsensusState?: { address?: string };
        };
      }>('deployment');
      const historyAddress = deployment.validators?.spendConsensusState?.address;
      const clientPolicyId = deployment.validators?.mintClientStt?.scriptHash;
      if (!!historyAddress !== !!clientPolicyId) {
        throw new Error('Consensus-state history requires both its validator address and client policy id');
      }
      return new IbcTreeStateStore({
        network: config.getOrThrow<string>('cardanoNetwork'),
        hostStateNFT: deployment.hostStateNFT,
        ...(historyAddress && clientPolicyId
          ? { consensusStateHistory: { address: historyAddress, policyId: clientPolicyId } }
          : {}),
      }, kupo, lucid);
    },
  }],
  exports: [IbcTreeStateStore],
})
export class IbcTreeModule {}
