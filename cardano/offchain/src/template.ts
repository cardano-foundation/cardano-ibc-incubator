import { UTxO } from "npm:@lucid-evolution/lucid@0.4.18";

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
  | "spendTransferModule"
  | "mintVoucher"
  | "verifyProof";

type Module = "handler" | "transfer";

type Tokens = "mock";

export type DeploymentTemplate = {
  validators: Record<
    Validator,
    {
      title: string;
      script: string;
      scriptHash: string;
      address: string;
      refUtxo: UTxO;
      refValidator?: Record<
        string,
        { script: string; scriptHash: string; refUtxo: UTxO }
      >;
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
  tokens: Record<Tokens, string>;
};
