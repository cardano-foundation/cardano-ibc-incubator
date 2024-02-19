export const configTemplate: {
  validators: Record<
    string,
    { title: string; script: string; scriptHash: string; address: string }
  >;
  nonceUtxo: {
    txHash: string;
    outputIndex: number;
  };
  handlerAuthToken: {
    policyId: string;
    name: string;
  };
} = {
  validators: {
    spendHandler: {
      title: "",
      script: "",
      scriptHash: "",
      address: "",
    },
    spendClient: {
      title: "",
      script: "",
      scriptHash: "",
      address: "",
    },
    mintHandler: {
      title: "",
      script: "",
      scriptHash: "",
      address: "",
    },
    mintClient: {
      title: "",
      script: "",
      scriptHash: "",
      address: "",
    },
  },
  nonceUtxo: {
    txHash: "",
    outputIndex: 0,
  },
  handlerAuthToken: {
    policyId: "",
    name: "",
  },
} as const;

export type ConfigTemplate = typeof configTemplate;
