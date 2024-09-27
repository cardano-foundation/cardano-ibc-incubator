import {Data} from '../../../../plutus/data';
import {IBCModuleCallbackSchema} from './IBCModuleCallback';
import {IBCModuleOperatorSchema} from './IBCModuleOperator';

export const IBCModuleRedeemerSchema = Data.Enum([
  Data.Object({Callback: Data.Tuple([IBCModuleCallbackSchema])}),
  Data.Object({Callback: Data.Tuple([IBCModuleCallbackSchema])}),
  Data.Object({Operator: Data.Tuple([IBCModuleOperatorSchema])}),
  Data.Object({Operator: Data.Tuple([IBCModuleOperatorSchema])}),
]);
export type IBCModuleRedeemer = Data.Static<typeof IBCModuleRedeemerSchema>;
export const IBCModuleRedeemer = IBCModuleRedeemerSchema as unknown as IBCModuleRedeemer;
