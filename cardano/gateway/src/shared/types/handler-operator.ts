import { type Data } from 'lucid-cardano';

export type HandlerOperator = 'CreateClient' | 'Other';

export async function encodeHandlerOperator(handlerDatum: HandlerOperator, Lucid: typeof import('lucid-cardano')) {
  const { Data } = Lucid;
  const HandlerOperatorSchema = Data.Enum([Data.Literal('CreateClient'), Data.Literal('Other')]);
  type THandlerOperator = Data.Static<typeof HandlerOperatorSchema>;
  const THandlerOperator = HandlerOperatorSchema as unknown as HandlerOperator;
  return Data.to(handlerDatum, THandlerOperator);
}
