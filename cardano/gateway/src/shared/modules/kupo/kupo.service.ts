import { Injectable } from '@nestjs/common';
import { LucidService } from '../lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { UTxO } from '@lucid-evolution/lucid';
import { GrpcNotFoundException } from '../../../exception/grpc_exceptions';

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
   * Query all Client UTXOs from the chain
   * Used for rebuilding the IBC state tree
   * 
   * @returns Array of Client UTXOs with their datums
   */
  async queryAllClientUtxos(): Promise<UTxO[]> {
    try {
      const utxos = await this.lucidService.findUtxoAt(this.clientAddress);
      
      // Filter to only UTXOs with client tokens
      return utxos.filter(utxo => {
        const assets = utxo.assets;
        return Object.keys(assets).some(assetId => 
          assetId.startsWith(this.clientTokenPrefix)
        );
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

}
