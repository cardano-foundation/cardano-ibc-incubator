import { Constr, credentialToAddress, Data, type LucidEvolution, type Network, type TxBuilder, type UTxO } from '@lucid-evolution/lucid';

export class BridgeMigrationInProgressError extends Error {
  constructor() {
    super('Bridge migration is in progress; resume the approved migration before submitting bridge operations');
    this.name = 'BridgeMigrationInProgressError';
  }
}

export type MigrationRuntimeConfig = {
  profile: 'cardano-ibc-compatible-v1';
  registryUnit: string;
  registryAddress: string;
  generation: string;
  compatibility: string;
  originalAddresses: string[];
};

export type MigrationRuntimeDeployment = {
  migration?: MigrationRuntimeConfig;
  hostStateNFT: { policyId: string; name: string };
  validators: Record<'hostStateStt' | 'spendClient' | 'spendConnection' | 'spendChannel' | 'spendTransferModule', { address?: string }> &
    Record<'mintClientStt' | 'mintConnectionStt' | 'mintChannelStt' | 'mintTransferEscrowShard', { scriptHash: string }>;
  modules: { transfer: { address: string } };
};

export function requireMigrationConfig(value: unknown): MigrationRuntimeConfig {
  const input = value as MigrationRuntimeConfig;
  if (!input || input.profile !== 'cardano-ibc-compatible-v1' ||
    !/^[0-9a-f]{58,120}$/.test(input.registryUnit) || !input.registryAddress ||
    !/^[1-9][0-9]*$/.test(input.generation) || !/^[0-9a-f]{64}$/.test(input.compatibility) ||
    !Array.isArray(input.originalAddresses) || input.originalAddresses.length !== 5 || input.originalAddresses.some((a) => typeof a !== 'string' || !a)) {
    throw new Error('Unsupported or incomplete migration manifest; export the verified upgrade-capable deployment');
  }
  return { profile: input.profile, registryUnit: input.registryUnit, registryAddress: input.registryAddress,
    generation: input.generation, compatibility: input.compatibility, originalAddresses: [...input.originalAddresses] };
}

function record(data: Data, length: number, index = 0): Data[] {
  if (!(data instanceof Constr) || data.index !== index || data.fields.length !== length) throw new Error('Unsupported migration registry datum');
  return data.fields;
}
function credential(data: Data) {
  if (!(data instanceof Constr) || ![0, 1].includes(data.index) || data.fields.length !== 1 || typeof data.fields[0] !== 'string' || !/^[0-9a-f]{56}$/.test(data.fields[0])) throw new Error('Invalid registry address credential');
  return {type: data.index === 0 ? 'Key' as const : 'Script' as const, hash: data.fields[0]};
}
function addressFromData(network: Network, data: Data): string {
  const [payment, option] = record(data, 2);
  if (!(option instanceof Constr)) throw new Error('Invalid stake credential');
  if (option.index === 1 && option.fields.length === 0) return credentialToAddress(network, credential(payment));
  const [stake] = record(option, 1);
  const [inline] = record(stake, 1);
  return credentialToAddress(network, credential(payment), credential(inline));
}

/** Read the canonical NFT and compare all role addresses, including stake parts.
 * The returned out-ref is included in the transaction: a concurrent handover
 * invalidates it at the ledger even if an indexer has temporarily served stale data.
 */
export async function migrationReference(lucid: LucidEvolution, deployment: MigrationRuntimeDeployment, createObject = false): Promise<UTxO | undefined> {
  if (!deployment.migration) return undefined;
  const manifest = requireMigrationConfig(deployment.migration);
  const utxo = await lucid.utxoByUnit(manifest.registryUnit);
  if (utxo.address !== manifest.registryAddress || utxo.assets[manifest.registryUnit] !== 1n || !utxo.datum) throw new Error('Missing authenticated implementation registry');
  const [token, hostPolicy, identity, , , implementation, phase] = record(Data.from(utxo.datum), 7);
  const [policy, name] = record(token, 2);
  const [generation, addresses, compatibility] = record(implementation, 3);
  if (typeof policy !== 'string' || typeof name !== 'string' || policy + name !== manifest.registryUnit || hostPolicy !== deployment.hostStateNFT.policyId || deployment.hostStateNFT.name !== '6962635f686f73745f7374617465' || compatibility !== manifest.compatibility) throw new Error('Registry identifies a different bridge or compatibility profile');
  if (!(phase instanceof Constr) || ![0, 1, 2].includes(phase.index)) throw new Error('Unsupported registry phase');
  if (phase.index === 2) throw new BridgeMigrationInProgressError();
  if (createObject && phase.index === 1) throw new Error('New state objects are paused while a migration or authority rotation is prepared');
  if (generation !== BigInt(manifest.generation)) throw new Error('Stale implementation manifest; verify and install the current generation, then restart the builder');
  const policies = record(identity, 5).slice(0, 4);
  const expectedPolicies = ['mintClientStt', 'mintConnectionStt', 'mintChannelStt', 'mintTransferEscrowShard'] as const;
  if (policies.some((policy, index) => policy !== deployment.validators[expectedPolicies[index]].scriptHash)) throw new Error('Manifest substitutes an immutable state policy');
  const roles = ['hostStateStt', 'spendClient', 'spendConnection', 'spendChannel', 'spendTransferModule'] as const;
  if (!Array.isArray(addresses) || addresses.length !== roles.length) throw new Error('Invalid registry role inventory');
  const network = lucid.config().network;
  if (!network) throw new Error('Cardano network is required');
  for (let index = 0; index < roles.length; index++) {
    if (addressFromData(network, addresses[index]) !== deployment.validators[roles[index]].address) throw new Error(`Manifest role ${roles[index]} is not the approved implementation`);
  }
  if (deployment.modules.transfer.address !== deployment.validators.spendTransferModule.address) throw new Error('Transfer module address differs from its authenticated implementation');
  return utxo;
}

/** Attach authorization as an ordinary builder action before returning it.
 * All completion APIs and composition therefore preserve the reference input.
 * A rejected transaction must be rebuilt from fresh canonical state.
 */
export async function withMigrationReference(lucid: LucidEvolution, tx: TxBuilder, deployment: MigrationRuntimeDeployment, createObject = false): Promise<TxBuilder> {
  const reference = await migrationReference(lucid, deployment, createObject);
  if (reference) tx.readFrom([reference]);
  return tx;
}
