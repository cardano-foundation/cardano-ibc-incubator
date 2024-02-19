import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";

// const AuthTokenSchema1 = Data.Object({
//     policy_id: Data.Bytes(),
//     name: Data.Bytes(),
//   });
//   export type ProofSpec = Data.Static<typeof AuthTokenSchema1>;
//   export const ProofSpec = AuthTokenSchema1 as unknown as ProofSpec;

const LeaftOpSchema = Data.Object({
  hash: Data.Integer(),
  prehash_key: Data.Integer(),
  prehash_value: Data.Integer(),
  length: Data.Integer(),
  prefix: Data.Bytes(),
});
export type LeftOp = Data.Static<typeof LeaftOpSchema>;
export const LeftOp = LeaftOpSchema as unknown as LeftOp;

const InnerSpecSchema = Data.Object({
  child_order: Data.Array(Data.Integer()),
  child_size: Data.Integer(),
  min_prefix_length: Data.Integer(),
  max_prefix_length: Data.Integer(),
  empty_child: Data.Bytes(),
  hash: Data.Integer(),
});
export type InnerSpec = Data.Static<typeof InnerSpecSchema>;
export const InnerSpec = InnerSpecSchema as unknown as InnerSpec;

export const ProofSpecSchema = Data.Object({
  leaf_spec: LeaftOpSchema,
  inner_spec: InnerSpecSchema,
  max_depth: Data.Integer(),
  min_depth: Data.Integer(),
  prehash_key_before_comparison: Data.Boolean(),
});
export type ProofSpec = Data.Static<typeof ProofSpecSchema>;
export const ProofSpec = ProofSpecSchema as unknown as ProofSpec;
