export type Acknowledgement = {
    response: {
        AcknowledgementResult: {
            result: string;
        };
    };
} | {
    response: {
        AcknowledgementError: {
            err: string;
        };
    };
};
type LucidDataCodecModule = typeof import('@lucid-evolution/lucid');
export declare function acknowledgementSchema(Lucid: LucidDataCodecModule): import("@lucid-evolution/lucid").TObject<{
    response: import("@lucid-evolution/lucid").TUnion<(import("@lucid-evolution/lucid").TObject<{
        AcknowledgementResult: import("@lucid-evolution/lucid").TObject<{
            result: import("@lucid-evolution/lucid").TUnsafe<string>;
        }>;
    }> | import("@lucid-evolution/lucid").TObject<{
        AcknowledgementError: import("@lucid-evolution/lucid").TObject<{
            err: import("@lucid-evolution/lucid").TUnsafe<string>;
        }>;
    }>)[]>;
}>;
export declare function encodeAcknowledgement(acknowledgement: Acknowledgement, Lucid: LucidDataCodecModule): string;
export declare function decodeAcknowledgement(encoded: string, Lucid: LucidDataCodecModule): Acknowledgement;
export {};
