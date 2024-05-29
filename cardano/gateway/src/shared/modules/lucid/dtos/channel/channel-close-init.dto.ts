import { UTxO } from '@dinhbx/lucid-custom';

export type UnsignedChannelCloseInitDto = {
    channelUtxo: UTxO;
    handlerUtxo: UTxO;
    connectionUtxo: UTxO;
    clientUtxo: UTxO;
    spendHandlerRefUtxo: UTxO;
    spendMockModuleRefUtxo: UTxO;
    mockModuleUtxo: UTxO;
    encodedSpendChannelRedeemer: string;
    encodedSpendMockModuleRedeemer: string;
    channelTokenUnit: string;
    encodedUpdatedChannelDatum: string;
    constructedAddress: string;
};