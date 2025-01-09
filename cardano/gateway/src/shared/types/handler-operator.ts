import { type Data } from '@lucid-evolution/lucid';
import { Height } from './height';

export type HandlerOperator =
  | 'CreateClient'
  | 'HandlerConnOpenInit'
  | 'HandlerConnOpenTry'
  | 'HandlerChanOpenInit'
  | 'HandlerChanOpenTry'
  | 'HandlerBindPort';

export async function encodeHandlerOperator(
  handlerDatum: HandlerOperator,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const HandlerOperatorSchema = Data.Enum([
    Data.Literal('CreateClient'),
    Data.Literal('HandlerConnOpenInit'),
    Data.Literal('HandlerConnOpenTry'),
    Data.Literal('HandlerChanOpenInit'),
    Data.Literal('HandlerChanOpenTry'),
    Data.Literal('HandlerBindPort'),
  ]);
  type THandlerOperator = Data.Static<typeof HandlerOperatorSchema>;
  const THandlerOperator = HandlerOperatorSchema as unknown as HandlerOperator;
  return Data.to(handlerDatum, THandlerOperator);
}
