import { ConfigService } from '@nestjs/config';
import { querySystemStart } from '../../helpers/time';

export const LUCID_CLIENT = 'LUCID_CLIENT';
export const LUCID_IMPORTER = 'LUCID_IMPORTER';

export const LucidClient = {
  provide: LUCID_CLIENT,
  useFactory: async (configService: ConfigService) => {
    // Dynamically import Lucid library
    const Lucid = await (eval(`import('@dinhbx/lucid-custom')`) as Promise<typeof import('@dinhbx/lucid-custom')>);
    // Create Lucid provider and instance
    const provider = new Lucid.Kupmios(configService.get('kupoEndpoint'), configService.get('ogmiosEndpoint'));
    const chainZeroTime = await querySystemStart(configService.get('ogmiosEndpoint'));
    Lucid.SLOT_CONFIG_NETWORK.Preview.zeroTime = chainZeroTime;
    const lucid = await Lucid.Lucid.new(provider, 'Preview');
    // const lucid = await Lucid.Lucid.new(
    //   new Lucid.Blockfrost('https://cardano-preview.blockfrost.io/api/v0', 'preview2fjKEg2Zh687WPUwB8eljT2Mz2q045GC'),
    //   'Preview',
    // );
    // const defaultSigner = configService.get('signer').address;
    // lucid.selectWalletFrom({
    //   address: defaultSigner,
    // });
    // lucid.selectWalletFromPrivateKey(configService.get('signer').sk);

    return lucid;
  },
  inject: [ConfigService],
};

export const LucidImporter = {
  provide: LUCID_IMPORTER,
  useFactory: async () => {
    // Dynamically import Lucid library
    return await (eval(`import('@dinhbx/lucid-custom')`) as Promise<typeof import('@dinhbx/lucid-custom')>);
  },
};
