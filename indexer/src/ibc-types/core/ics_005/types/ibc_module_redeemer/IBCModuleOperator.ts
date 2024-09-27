import {TransferModuleRedeemerSchema} from '../../../../apps/transfer/transfer_module_redeemer/TransferModuleRedeemer';
import {Data} from '../../../../plutus/data';

export const IBCModuleOperatorSchema = Data.Enum([
  Data.Object({
    TransferModuleOperator: Data.Tuple([TransferModuleRedeemerSchema]),
  }),
  Data.Object({
    TransferModuleOperator: Data.Tuple([TransferModuleRedeemerSchema]),
  }),
  Data.Literal('OtherModuleOperator'),
]);
export type IBCModuleOperator = Data.Static<typeof IBCModuleOperatorSchema>;
export const IBCModuleOperator = IBCModuleOperatorSchema as unknown as IBCModuleOperator;
