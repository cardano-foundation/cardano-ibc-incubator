import {Data} from '../../../../plutus/data';

export const AcknowledgementResponseSchema = Data.Enum([
  Data.Object({AcknowledgementResult: Data.Object({result: Data.Bytes()})}),
  Data.Object({AcknowledgementResult: Data.Object({result: Data.Bytes()})}),
  Data.Object({AcknowledgementError: Data.Object({err: Data.Bytes()})}),
  Data.Object({AcknowledgementError: Data.Object({err: Data.Bytes()})}),
]);
export type AcknowledgementResponse = Data.Static<typeof AcknowledgementResponseSchema>;
export const AcknowledgementResponse = AcknowledgementResponseSchema as unknown as AcknowledgementResponse;
