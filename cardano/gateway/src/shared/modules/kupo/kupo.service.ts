import { Injectable } from '@nestjs/common';
import { LucidService } from '../lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { UTxO } from '@lucid-evolution/lucid';
import { GrpcNotFoundException } from '../../../exception/grpc_exceptions';
import { isKupoHistoryProvider, KupoHistoricalOutput } from './kupo.types';

function compareHistoryPosition(a: KupoHistoricalOutput, b: KupoHistoricalOutput): number {
  return (
    a.createdAt.slotNo - b.createdAt.slotNo ||
    a.transactionIndex - b.transactionIndex ||
    a.outputIndex - b.outputIndex ||
    a.txHash.localeCompare(b.txHash)
  );
}

function hasSameHistoryPosition(a: KupoHistoricalOutput, b: KupoHistoricalOutput): boolean {
  return (
    a.createdAt.slotNo === b.createdAt.slotNo &&
    a.transactionIndex === b.transactionIndex &&
    a.outputIndex === b.outputIndex
  );
}

/**
 * Select the most recently created output for each authentication token.
 *
 * The checks here turn impossible NFT histories into hard failures rather than
 * silently picking one row: an older continuation must be spent in the same
 * canonical block that creates its successor, and at most the latest output
 * may remain unspent.
 */
export function selectLatestKupoOutputByAuthToken(history: KupoHistoricalOutput[]): KupoHistoricalOutput[] {
  const grouped = new Map<string, KupoHistoricalOutput[]>();
  for (const output of history) {
    const outputs = grouped.get(output.authToken.unit) ?? [];
    outputs.push(output);
    grouped.set(output.authToken.unit, outputs);
  }

  const latest: KupoHistoricalOutput[] = [];
  for (const [unit, unsortedOutputs] of grouped.entries()) {
    const outputs = [...unsortedOutputs].sort(compareHistoryPosition);
    for (let index = 0; index < outputs.length - 1; index += 1) {
      const current = outputs[index];
      const successor = outputs[index + 1];
      if (hasSameHistoryPosition(current, successor)) {
        throw new Error(`Ambiguous Kupo auth-token history: ${unit} has duplicate chain positions`);
      }
      if (!current.spentAt) {
        throw new Error(`Ambiguous Kupo auth-token history: ${unit} has a non-latest unspent output`);
      }
      if (
        current.spentAt.slotNo !== successor.createdAt.slotNo ||
        current.spentAt.headerHash !== successor.createdAt.headerHash
      ) {
        throw new Error(`Malformed Kupo auth-token history: ${unit} continuation points are discontinuous`);
      }
    }

    const unspent = outputs.filter((output) => output.spentAt === null);
    if (unspent.length > 1 || (unspent.length === 1 && unspent[0] !== outputs.at(-1))) {
      throw new Error(`Ambiguous Kupo auth-token history: ${unit} has multiple current outputs`);
    }
    latest.push(outputs[outputs.length - 1]);
  }

  return latest.sort((a, b) => a.authToken.unit.localeCompare(b.authToken.unit));
}

/**
 * KupoService - Provides IBC-specific queries to Kupo indexer (STT Architecture)
 *
 * Purpose:
 * - Query all IBC-related UTXOs (clients, connections, channels)
 * - Query HostState UTXO via unique NFT
 * - Support historical UTXO queries at specific heights
 * - Enable tree rebuilding from on-chain state
 *
 * STT Architecture Benefits:
 * - Simplified queries: Follow the NFT to find canonical state
 * - No ambiguity: Exactly one HostState UTXO exists
 * - Complete history: NFT traces all state updates
 *
 * Architecture:
 * - Builds on top of LucidService (which uses Kupmios)
 * - Kupo must be indexing from at least the HostState NFT mint block
 * - Used by QueryService and tree rebuild logic
 */
@Injectable()
export class KupoService {
  private readonly clientTokenPrefix: string;
  private readonly connectionTokenPrefix: string;
  private readonly channelTokenPrefix: string;
  private readonly clientAddress: string;
  private readonly connectionAddress: string;
  private readonly channelAddress: string;

  constructor(
    private readonly lucidService: LucidService,
    private readonly configService: ConfigService,
  ) {
    const deployment = this.configService.get('deployment');

    // Initialize token prefixes for filtering
    // NOTE: `scriptHash` is the Cardano policy id for minting policies.
    this.clientTokenPrefix = deployment.validators.mintClientStt.scriptHash;
    this.connectionTokenPrefix = deployment.validators.mintConnectionStt.scriptHash;
    this.channelTokenPrefix = deployment.validators.mintChannelStt.scriptHash;

    // Initialize addresses
    this.clientAddress = deployment.validators.spendClient.address;
    this.connectionAddress = deployment.validators.spendConnection.address;
    this.channelAddress = deployment.validators.spendChannel.address;
  }

  private getMatchingAssetNames(utxo: UTxO, policyId: string, tokenNamePrefix?: string): string[] {
    return Object.keys(utxo.assets)
      .filter((assetId) => assetId !== 'lovelace')
      .filter((assetId) => assetId.startsWith(policyId))
      .map((assetId) => assetId.slice(policyId.length))
      .filter((tokenName) => !tokenNamePrefix || tokenName.startsWith(tokenNamePrefix));
  }

  async queryUtxosAtAddressByPolicyAndTokenPrefix(
    address: string,
    policyId: string,
    tokenNamePrefix?: string,
  ): Promise<Array<UTxO & { matchedTokenNames: string[] }>> {
    try {
      // The configured Kupmios provider resolves this through Kupo's
      // address-level `?unspent` index. Do not fan out into per-out-ref checks:
      // that provider path issues one sequential request per transaction hash.
      const utxos = await this.lucidService.findUtxoAt(address);
      return utxos
        .map((utxo) => ({
          ...utxo,
          // Keep the matching token names so callers can recover the sequence-derived
          // connection/channel id without depending on a db-sync-specific row shape.
          matchedTokenNames: this.getMatchingAssetNames(utxo, policyId, tokenNamePrefix),
        }))
        .filter((utxo) => utxo.matchedTokenNames.length > 0);
    } catch (error) {
      // LucidService represents an address with no live UTxOs as NOT_FOUND.
      // Preserve that empty-list behavior, but do not turn provider/indexer
      // failures into a false assertion that no IBC objects exist.
      if (error instanceof GrpcNotFoundException) return [];
      throw error;
    }
  }

  /**
   * Retrieve the latest historical state for each auth token at an indexed
   * address. This deliberately does not translate provider failures or missing
   * Kupo history support into an empty result.
   */
  async queryLatestUtxosAtAddressByPolicyFromHistory(
    address: string,
    policyId: string,
    assetName?: string,
  ): Promise<KupoHistoricalOutput[]> {
    const lucid = this.lucidService.lucid as unknown as { provider?: unknown };
    if (!isKupoHistoryProvider(lucid.provider)) {
      throw new Error('Configured Lucid provider does not support Kupo historical matches');
    }

    const history = assetName === undefined
      ? await lucid.provider.getKupoHistoryAtAddressByPolicy(address, policyId)
      : await lucid.provider.getKupoHistoryAtAddressByPolicy(address, policyId, assetName);
    return selectLatestKupoOutputByAuthToken(history);
  }

  /**
   * Query all Client UTXOs from the chain
   * Used for rebuilding the IBC state tree
   *
   * @returns Array of Client UTXOs with their datums
   */
  async queryAllClientUtxos(): Promise<UTxO[]> {
    try {
      const utxos = await this.lucidService.findUtxoAt(this.clientAddress);

      // Filter to only UTXOs with client tokens
      return utxos.filter((utxo) => {
        const assets = utxo.assets;
        return Object.keys(assets).some((assetId) => assetId.startsWith(this.clientTokenPrefix));
      });
    } catch (error) {
      // If no UTxOs exist yet, return an empty array. Provider failures must
      // propagate so a tree rebuild cannot mistake an outage for an empty set.
      if (error instanceof GrpcNotFoundException) return [];
      throw error;
    }
  }

  /**
   * Query all Connection UTXOs from the chain
   * Used for rebuilding the IBC state tree
   *
   * @returns Array of Connection UTXOs with their datums
   */
  async queryAllConnectionUtxos(): Promise<UTxO[]> {
    return this.queryUtxosAtAddressByPolicyAndTokenPrefix(this.connectionAddress, this.connectionTokenPrefix);
  }

  /**
   * Query all Channel UTXOs from the chain
   * Used for rebuilding the IBC state tree
   *
   * @returns Array of Channel UTXOs with their datums
   */
  async queryAllChannelUtxos(): Promise<UTxO[]> {
    return this.queryUtxosAtAddressByPolicyAndTokenPrefix(this.channelAddress, this.channelTokenPrefix);
  }

  async queryLatestChannelUtxosFromHistory(
    channelTokenUnit?: string,
  ): Promise<KupoHistoricalOutput[]> {
    let assetName: string | undefined;
    if (channelTokenUnit !== undefined) {
      if (
        !/^[0-9a-f]{56}$/.test(this.channelTokenPrefix) ||
        !channelTokenUnit.startsWith(this.channelTokenPrefix)
      ) {
        throw new Error(
          'Invalid channel token unit: expected the configured 56-hex policy prefix',
        );
      }
      assetName = channelTokenUnit.slice(this.channelTokenPrefix.length);
      if (
        assetName.length === 0 ||
        assetName.length > 64 ||
        assetName.length % 2 !== 0 ||
        !/^[0-9a-f]+$/.test(assetName)
      ) {
        throw new Error(
          'Invalid channel token unit: expected a non-empty lowercase hexadecimal asset name',
        );
      }
    }
    return this.queryLatestUtxosAtAddressByPolicyFromHistory(
      this.channelAddress,
      this.channelTokenPrefix,
      assetName,
    );
  }
}
