import { UTxO } from "https://deno.land/x/lucid@0.10.7/mod.ts";

type Validator =
  | "spendHandler"
  | "mintClient"
  | "spendClient"
  | "mintConnection"
  | "spendConnection"
  | "mintChannel"
  | "spendChannel"
  | "mintPort"
  | "mintIdentifier"
  | "spendMockModule";

type Module = "handler" | "mock";

export type DeploymentTemplate = {
  validators: Record<
    Validator,
    {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
    }
  >;
  handlerAuthToken: {
    policyId: string;
    name: string;
  };
  modules: Record<
    Module,
    {
      identifier: string;
      address: string;
    }
  >;
};
