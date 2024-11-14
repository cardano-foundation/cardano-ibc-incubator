import { GenType } from "./types.ts";

export const builtInTypes: { [type: string]: GenType } = {
  Bool: {
    type: "primitive",
    schema: ["Data.Boolean()"],
  },
  ByteArray: {
    type: "primitive",
    schema: ["Data.Bytes()"],
  },
  AssetName: {
    type: "primitive",
    schema: ["Data.Bytes()"],
  },
  BlockIdFlag: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  Data: {
    type: "primitive",
    schema: ["Data.Any()"],
  },
  Duration: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  Time: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  Uint64: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  HashOp: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  LengthOp: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  Int: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  PolicyId: {
    type: "primitive",
    schema: ["Data.Bytes()"],
  },
  Void: {
    type: "primitive",
    schema: ["Data.void()"],
  },
  TransferModuleDatum: {
    type: "primitive",
    schema: ["Data.void()"],
  },
} as const;
