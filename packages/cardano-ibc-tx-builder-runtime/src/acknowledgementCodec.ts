export type Acknowledgement =
  | { response: { AcknowledgementResult: { result: string } } }
  | { response: { AcknowledgementError: { err: string } } };

type LucidDataCodecModule = typeof import('@lucid-evolution/lucid');

export function acknowledgementSchema(Lucid: LucidDataCodecModule) {
  const { Data } = Lucid;
  const AcknowledgementResponseSchema = Data.Enum([
    Data.Object({
      AcknowledgementResult: Data.Object({
        result: Data.Bytes(),
      }),
    }),
    Data.Object({
      AcknowledgementError: Data.Object({
        err: Data.Bytes(),
      }),
    }),
  ]);
  return Data.Object({
    response: AcknowledgementResponseSchema,
  });
}

export function encodeAcknowledgement(
  acknowledgement: Acknowledgement,
  Lucid: LucidDataCodecModule,
): string {
  return Lucid.Data.to(
    acknowledgement,
    acknowledgementSchema(Lucid) as any,
    { canonical: true },
  );
}

export function decodeAcknowledgement(
  encoded: string,
  Lucid: LucidDataCodecModule,
): Acknowledgement {
  return Lucid.Data.from(
    encoded,
    acknowledgementSchema(Lucid) as any,
  ) as Acknowledgement;
}
