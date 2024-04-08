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
  Data: {
    type: "primitive",
    schema: ["Data.Any()"],
  },
  Int: {
    type: "primitive",
    schema: ["Data.Integer()"],
  },
  Void: {
    type: "primitive",
    schema: ["Data.void()"],
  },
} as const;
