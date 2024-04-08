import { UTxO } from "npm:@dinhbx/lucid-custom";

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
  | "spendMockModule"
  | "spendTransferModule"
  | "mintVoucher";

type Module = "handler" | "mock" | "transfer";

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
  tokens: Record<
    Tokens,
    string
  >;
};
