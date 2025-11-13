import { Injectable } from '@nestjs/common';
import { LucidService } from '../lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { UTxO } from '@lucid-evolution/lucid';

/**
 * KupoService - Provides IBC-specific queries to Kupo indexer
 * 
 * Purpose:
 * - Query all IBC-related UTXOs (clients, connections, channels)
 * - Support historical UTXO queries at specific heights
 * - Enable tree rebuilding from on-chain state
 * 
 * Architecture:
 * - Builds on top of LucidService (which uses Kupmios)
 * - Kupo must be indexing from at least the Handler UTXO deployment block
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
   * Query Handler UTXO at a specific height (for historical queries)
   * 
   * NOTE: This requires Kupo to have indexed from the deployment block.
   * Currently returns current Handler UTXO as Lucid doesn't expose
   * historical query APIs directly.
   * 
   * TODO: Implement actual historical queries when Kupo API is integrated
   * This may require direct HTTP calls to Kupo's REST API:
   * GET /matches/{pattern}?spent&created_before={slot}
   * 
   * @param height - The block height to query
   * @returns Handler UTXO at that height
   */
  async queryHandlerUtxoAtHeight(height: number): Promise<UTxO> {
    // TODO: Convert height to slot number
    // TODO: Make direct Kupo API call for historical UTXO
    // For now, return current UTXO
    
    return await this.lucidService.findUtxoAtHandlerAuthToken();
  }

  /**
   * Query the IBC state root at a specific height
   * Convenience method that combines querying Handler UTXO + extracting root
   * 
   * @param height - The block height to query
   * @returns The IBC state root (32-byte hex string)
   */
  async queryIBCStateRootAtHeight(height: number): Promise<string> {
    const handlerUtxo = await this.queryHandlerUtxoAtHeight(height);
    
    if (!handlerUtxo.datum) {
      throw new Error('Handler UTXO has no datum');
    }
    
    const handlerDatum = await this.lucidService.decodeDatum(handlerUtxo.datum, 'handler');
    
    return handlerDatum.state.ibc_state_root;
  }
}

