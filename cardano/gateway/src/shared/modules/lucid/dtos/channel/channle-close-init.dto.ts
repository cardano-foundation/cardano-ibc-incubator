import { UTxO } from '@lucid-evolution/lucid';
import { AuthToken } from '~@/shared/types/auth-token';

export type UnsignedChannelCloseInitDto = {
    channelUtxo: UTxO;
    connectionUtxo: UTxO;
    clientUtxo: UTxO;
    spendChannelRefUtxo: UTxO;
    spendMockModuleRefUtxo: UTxO;
    channelCloseInitRefUtxO: UTxO;
    mockModuleUtxo: UTxO;

    channelCloseInitPolicyId: string;
    encodedSpendChannelRedeemer: string;
    encodedSpendMockModuleRedeemer: string;
    channelTokenUnit: string;
    channelToken: AuthToken;
    encodedUpdatedChannelDatum: string;
    constructedAddress: string;
};