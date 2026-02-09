type RefUtxo = {
  txHash: string;
  outputIndex: number;
};

type MintingPolicy = {
  scriptHash: string;
  refUtxo: RefUtxo;
};

type SpendValidator = {
  scriptHash: string;
  address: string;
  refUtxo: RefUtxo;
};

type DeploymentConfigStt = {
  hostStateNFT: {
    policyId: string;
    name: string;
  };
  validators: {
    hostStateStt: SpendValidator;
    mintClientStt: MintingPolicy;
    mintConnectionStt: MintingPolicy;
    mintChannelStt: MintingPolicy;
  };
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requireNonEmptyString(value: unknown, path: string): string {
  assert(isNonEmptyString(value), `Invalid deployment config: "${path}" must be a non-empty string`);
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  assert(typeof value === 'number' && Number.isInteger(value) && value >= 0, `Invalid deployment config: "${path}" must be a non-negative integer`);
  return value;
}

function requireRefUtxo(value: any, path: string): RefUtxo {
  assert(value && typeof value === 'object', `Invalid deployment config: "${path}" must be an object`);
  return {
    txHash: requireNonEmptyString(value.txHash, `${path}.txHash`),
    outputIndex: requireNonNegativeInteger(value.outputIndex, `${path}.outputIndex`),
  };
}

function requireMintingPolicy(value: any, path: string): MintingPolicy {
  assert(value && typeof value === 'object', `Invalid deployment config: "${path}" must be an object`);
  return {
    scriptHash: requireNonEmptyString(value.scriptHash, `${path}.scriptHash`),
    refUtxo: requireRefUtxo(value.refUtxo, `${path}.refUtxo`),
  };
}

function requireSpendValidator(value: any, path: string): SpendValidator {
  assert(value && typeof value === 'object', `Invalid deployment config: "${path}" must be an object`);
  return {
    scriptHash: requireNonEmptyString(value.scriptHash, `${path}.scriptHash`),
    address: requireNonEmptyString(value.address, `${path}.address`),
    refUtxo: requireRefUtxo(value.refUtxo, `${path}.refUtxo`),
  };
}

/**
 * Enforce STT-only deployments.
 *
 * Historically we allowed Gateway to fall back to legacy (non-STT) minting
 * policies + base tokens when STT fields were missing from `handler.json`.
 * This is dangerous because it allows a misconfiguration to silently run
 * against the wrong on-chain contracts.
 */
export function requireSttDeploymentConfig(deployment: unknown): DeploymentConfigStt {
  assert(deployment && typeof deployment === 'object', 'Invalid deployment config: must be an object');
  const deploymentAny = deployment as any;

  const hostStateNFT = deploymentAny.hostStateNFT;
  assert(hostStateNFT && typeof hostStateNFT === 'object', 'Invalid deployment config: "hostStateNFT" must be an object');

  const validators = deploymentAny.validators;
  assert(validators && typeof validators === 'object', 'Invalid deployment config: "validators" must be an object');

  return {
    hostStateNFT: {
      policyId: requireNonEmptyString(hostStateNFT.policyId, 'hostStateNFT.policyId'),
      name: requireNonEmptyString(hostStateNFT.name, 'hostStateNFT.name'),
    },
    validators: {
      hostStateStt: requireSpendValidator(validators.hostStateStt, 'validators.hostStateStt'),
      mintClientStt: requireMintingPolicy(validators.mintClientStt, 'validators.mintClientStt'),
      mintConnectionStt: requireMintingPolicy(validators.mintConnectionStt, 'validators.mintConnectionStt'),
      mintChannelStt: requireMintingPolicy(validators.mintChannelStt, 'validators.mintChannelStt'),
    },
  };
}

