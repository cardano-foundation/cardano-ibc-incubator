import { ogmiosRequest } from './ogmios';

export type LedgerStateUtxo = {
  txHash: string;
  outputIndex: number;
  address: string;
  assets: Record<string, bigint>;
  datum?: string;
};

const parseQuantity = (value: unknown, field: string): bigint => {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`Ogmios returned a negative ${field}`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Ogmios returned an invalid ${field}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`Ogmios returned an invalid ${field}`);
};

const parseAssets = (value: unknown): Record<string, bigint> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Ogmios returned an invalid UTxO value');
  }

  const assets: Record<string, bigint> = {};
  for (const [policyId, rawPolicyAssets] of Object.entries(value)) {
    if (!rawPolicyAssets || typeof rawPolicyAssets !== 'object' || Array.isArray(rawPolicyAssets)) {
      throw new Error(`Ogmios returned an invalid value entry for ${policyId}`);
    }

    if (policyId === 'ada') {
      const lovelace = (rawPolicyAssets as Record<string, unknown>).lovelace;
      assets.lovelace = parseQuantity(lovelace, 'lovelace quantity');
      continue;
    }

    if (!/^[0-9a-f]{56}$/i.test(policyId)) {
      throw new Error(`Ogmios returned an invalid policy id ${policyId}`);
    }
    for (const [assetName, rawQuantity] of Object.entries(rawPolicyAssets)) {
      if (!/^(?:[0-9a-f]{2}){0,32}$/i.test(assetName)) {
        throw new Error(`Ogmios returned an invalid asset name ${assetName}`);
      }
      assets[policyId.toLowerCase() + assetName.toLowerCase()] = parseQuantity(
        rawQuantity,
        `quantity for ${policyId}.${assetName}`,
      );
    }
  }

  if (assets.lovelace === undefined) {
    throw new Error('Ogmios UTxO value is missing ada.lovelace');
  }
  return assets;
};

export const parseLedgerStateUtxo = (value: unknown): LedgerStateUtxo => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Ogmios returned an invalid UTxO');
  }
  const row = value as Record<string, unknown>;
  const transaction = row.transaction as Record<string, unknown> | undefined;
  const txHash = transaction?.id;
  if (typeof txHash !== 'string' || !/^[0-9a-f]{64}$/i.test(txHash)) {
    throw new Error('Ogmios returned an invalid UTxO transaction id');
  }
  if (typeof row.index !== 'number' || !Number.isSafeInteger(row.index) || row.index < 0) {
    throw new Error('Ogmios returned an invalid UTxO output index');
  }
  if (typeof row.address !== 'string' || row.address.length === 0) {
    throw new Error('Ogmios returned an invalid UTxO address');
  }
  // Ogmios 6.13 exposes an inline Datum as its raw CBOR base16 string. The
  // sibling datumHash field, when present, is deliberately not a substitute.
  if (row.datum !== undefined && (typeof row.datum !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(row.datum))) {
    throw new Error('Ogmios returned an invalid inline datum');
  }

  return {
    txHash: txHash.toLowerCase(),
    outputIndex: row.index,
    address: row.address,
    assets: parseAssets(row.value),
    ...(typeof row.datum === 'string' ? { datum: row.datum.toLowerCase() } : {}),
  };
};

export const queryLedgerStateUtxosAtAddresses = async (
  ogmiosEndpoint: string,
  addresses: string[],
): Promise<LedgerStateUtxo[]> => {
  if (addresses.length === 0 || addresses.some((address) => !address.trim())) {
    throw new Error('At least one non-empty Cardano address is required for a ledger UTxO query');
  }

  const result = await ogmiosRequest<unknown>(ogmiosEndpoint, 'queryLedgerState/utxo', {
    addresses: [...new Set(addresses)],
  });
  if (!Array.isArray(result)) {
    throw new Error('Ogmios returned an invalid UTxO response');
  }
  return result.map(parseLedgerStateUtxo);
};
