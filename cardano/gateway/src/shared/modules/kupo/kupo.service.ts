import { Injectable } from '@nestjs/common';
import { LucidService } from '../lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { UTxO } from '@lucid-evolution/lucid';

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
  private readonly handlerAddress: string;
  private readonly clientAddress: string;
  private readonly connectionAddress: string;
  private readonly channelAddress: string;

  constructor(
    private readonly lucidService: LucidService,
    private readonly configService: ConfigService,
  ) {
    const deployment = this.configService.get('deployment');
    
    // Initialize token prefixes for filtering
    this.clientTokenPrefix = deployment.validators.mintClient.policy_id;
    this.connectionTokenPrefix = deployment.validators.mintConnection.policy_id;
    this.channelTokenPrefix = deployment.validators.mintChannel.policy_id;
    
    // Initialize addresses
    this.handlerAddress = deployment.validators.address;
    this.clientAddress = deployment.validators.spendClient.address;
    this.connectionAddress = deployment.validators.spendConnection.address;
    this.channelAddress = deployment.validators.spendChannel.address;
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
      // If no UTXOs found, return empty array (no clients exist yet)
      return [];
    }
  }

  /**
   * Query all Connection UTXOs from the chain
   * Used for rebuilding the IBC state tree
   * 
   * @returns Array of Connection UTXOs with their datums
   */
  async queryAllConnectionUtxos(): Promise<UTxO[]> {
    try {
      const utxos = await this.lucidService.findUtxoAt(this.connectionAddress);
      
      // Filter to only UTXOs with connection tokens
      return utxos.filter(utxo => {
        const assets = utxo.assets;
        return Object.keys(assets).some(assetId => 
          assetId.startsWith(this.connectionTokenPrefix)
        );
      });
    } catch (error) {
      // If no UTXOs found, return empty array (no connections exist yet)
      return [];
    }
  }

  /**
   * Query all Channel UTXOs from the chain
   * Used for rebuilding the IBC state tree
   * 
   * @returns Array of Channel UTXOs with their datums
   */
  async queryAllChannelUtxos(): Promise<UTxO[]> {
    try {
      const utxos = await this.lucidService.findUtxoAt(this.channelAddress);
      
      // Filter to only UTXOs with channel tokens
      return utxos.filter(utxo => {
        const assets = utxo.assets;
        return Object.keys(assets).some(assetId => 
          assetId.startsWith(this.channelTokenPrefix)
        );
      });
    } catch (error) {
      // If no UTXOs found, return empty array (no channels exist yet)
      return [];
    }
  }

  /**
   * Query HostState UTXO at a specific height (STT Architecture)
   * 
   * STT Benefits:
   * - NFT provides unique identifier (no ambiguous UTXOs)
   * - Can trace complete state history by following NFT
   * - Historical queries simplified (find NFT at height)
   * 
   * NOTE: This requires Kupo to have indexed from the NFT mint block.
   * Currently returns current HostState UTXO as Lucid doesn't expose
   * historical query APIs directly.
   * 
   * TODO: Implement actual historical queries when Kupo API is integrated
   * This may require direct HTTP calls to Kupo's REST API:
   * GET /matches/{nft_policy}/{nft_name}?spent&created_before={slot}
   * 
   * @param height - The block height to query
   * @returns HostState UTXO at that height
   */
  async queryHostStateUtxoAtHeight(height: number): Promise<UTxO> {
    // TODO: Convert height to slot number
    // TODO: Make direct Kupo API call for historical UTXO
    // For now, return current UTXO
    
    return await this.lucidService.findUtxoAtHostStateNFT();
  }

  /**
   * Query the current HostState UTXO (STT Architecture)
   * 
   * Convenience wrapper around LucidService.findUtxoAtHostStateNFT()
   * Provided for consistency with other query methods
   * 
   * @returns The current HostState UTXO
   */
  async queryCurrentHostStateUtxo(): Promise<UTxO> {
    return await this.lucidService.findUtxoAtHostStateNFT();
  }

  /**
   * Query the IBC state root at a specific height (STT Architecture)
   * 
   * Convenience method that combines querying HostState UTXO + extracting root
   * 
   * @param height - The block height to query
   * @returns The IBC state root (32-byte hex string)
   */
  async queryIBCStateRootAtHeight(height: number): Promise<string> {
    const hostStateUtxo = await this.queryHostStateUtxoAtHeight(height);
    
    if (!hostStateUtxo.datum) {
      throw new Error('HostState UTXO has no datum');
    }
    
    const hostStateDatum = await this.lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
    
    return hostStateDatum.state.ibc_state_root;
  }
}

