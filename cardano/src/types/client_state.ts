import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { RationalSchema } from "./rational.ts";
import { HeightSchema } from "./height.ts";
import { ProofSpecSchema } from "./proof.ts";

export const ClientStateSchema = Data.Object({
  chainId: Data.Bytes(),
  trustLevel: RationalSchema,
  trustingPeriod: Data.Integer(),
  unbondingPeriod: Data.Integer(),
  maxClockDrift: Data.Integer(),
  frozenHeight: HeightSchema,
  latestHeight: HeightSchema,
  proofSpecs: Data.Array(ProofSpecSchema),
});
export type ClientState = Data.Static<typeof ClientStateSchema>;
export const ClientState = ClientStateSchema as unknown as ClientState;
