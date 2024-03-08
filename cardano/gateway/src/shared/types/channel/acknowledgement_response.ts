export type AcknowledgementResponse =
  | { AcknowledgementResult: { result: string } }
  | { AcknowledgementError: { err: string } };
