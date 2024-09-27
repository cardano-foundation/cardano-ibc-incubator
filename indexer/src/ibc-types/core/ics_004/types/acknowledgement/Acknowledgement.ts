import {Data} from '../../../../plutus/data';
import {AcknowledgementResponseSchema} from '../acknowledgement_response/AcknowledgementResponse';

export const AcknowledgementSchema = Data.Object({
  response: AcknowledgementResponseSchema,
});
export type Acknowledgement = Data.Static<typeof AcknowledgementSchema>;
export const Acknowledgement = AcknowledgementSchema as unknown as Acknowledgement;
