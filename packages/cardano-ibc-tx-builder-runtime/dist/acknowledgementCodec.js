"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgementSchema = acknowledgementSchema;
exports.encodeAcknowledgement = encodeAcknowledgement;
exports.decodeAcknowledgement = decodeAcknowledgement;
function acknowledgementSchema(Lucid) {
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
function encodeAcknowledgement(acknowledgement, Lucid) {
    return Lucid.Data.to(acknowledgement, acknowledgementSchema(Lucid), { canonical: true });
}
function decodeAcknowledgement(encoded, Lucid) {
    return Lucid.Data.from(encoded, acknowledgementSchema(Lucid));
}
