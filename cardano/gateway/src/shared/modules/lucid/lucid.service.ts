import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bech32 } from 'bech32';
import {
  type LucidEvolution,
  type UTxO,
  getAddressDetails,
  credentialToAddress,
  TxBuilder,
} from '@lucid-evolution/lucid';
import { LUCID_CLIENT, LUCID_IMPORTER } from './lucid.provider';
import { CHANNEL_TOKEN_PREFIX, CLIENT_PREFIX, CONNECTION_TOKEN_PREFIX } from '../../../constant';
import { HandlerDatum, decodeHandlerDatum, encodeHandlerDatum } from '../../types/handler-datum';
import { HostStateDatum, decodeHostStateDatum, encodeHostStateDatum } from '../../types/host-state-datum';
import { GrpcInternalException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { MintClientOperator, encodeMintClientOperator } from '../../types/mint-client-operator';
import { HandlerOperator, encodeHandlerOperator } from '../../types/handler-operator';
import { ClientDatum, encodeClientDatum } from '../../types/client-datum';
import { decodeClientDatum } from '../../types/client-datum';
import { SpendClientRedeemer, encodeSpendClientRedeemer } from '../../types/client-redeemer';
import { AuthToken, encodeAuthToken } from '../../types/auth-token';
import { ConnectionDatum, decodeConnectionDatum, encodeConnectionDatum } from '../../types/connection/connection-datum';
import {
  MintConnectionRedeemer,
  SpendConnectionRedeemer,
  encodeMintConnectionRedeemer,
  encodeSpendConnectionRedeemer,
} from '../../types/connection/connection-redeemer';
import {
  MintChannelRedeemer,
  SpendChannelRedeemer,
  encodeMintChannelRedeemer,
  encodeSpendChannelRedeemer,
} from '../../types/channel/channel-redeemer';
import { ChannelDatum, decodeChannelDatum, encodeChannelDatum } from '../../types/channel/channel-datum';
import { hashSha3_256, convertString2Hex } from '../../helpers/hex';
import { IBCModuleRedeemer, encodeIBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import {
  MockModuleDatum,
  decodeMockModuleDatum,
  encodeMockModuleDatum,
} from '@shared/types/apps/mock/mock-module-datum';
import { calculateTransferToken } from './helpers/send-packet.helper';
import {
  MintVoucherRedeemer,
  encodeMintVoucherRedeemer,
} from '@shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import {
  UnsignedAckPacketMintDto,
  UnsignedAckPacketSucceedDto,
  UnsignedAckPacketUnescrowDto,
  UnsignedChannelCloseInitDto,
  UnsignedChannelOpenAckDto,
  UnsignedChannelOpenInitDto,
  UnsignedConnectionOpenAckDto,
  UnsignedRecvPacketDto,
  UnsignedRecvPacketMintDto,
  UnsignedRecvPacketUnescrowDto,
  UnsignedSendPacketBurnDto,
  UnsignedSendPacketEscrowDto,
  UnsignedTimeoutPacketMintDto,
  UnsignedTimeoutPacketUnescrowDto,
  UnsignedTimeoutRefreshDto,
} from './dtos';

export type CodecType =
  | 'client'
  | 'connection'
  | 'handler'
  | 'channel'
  | 'mockModule'
  | 'host_state'
  | 'host_state_redeemer'
  | 'spendClientRedeemer'
  | 'mintClientOperator'
  | 'mintClientRedeemer'
  | 'handlerOperator'
  | 'mintConnectionRedeemer'
  | 'spendConnectionRedeemer'
  | 'mintChannelRedeemer'
  | 'spendChannelRedeemer'
  | 'iBCModuleRedeemer'
  | 'mintVoucherRedeemer';

type ReferenceScripts = {
  spendHandler: UTxO;
  spendChannel: UTxO;
  mintChannel: UTxO;
  mintClient: UTxO;
  mintConnection: UTxO;
  spendConnection: UTxO;
  spendClient: UTxO;
  spendMockModule: UTxO;
  spendTransferModule: UTxO;
  verifyProof: UTxO;
  hostStateStt: UTxO;
  channelOpenAck: UTxO;
  channelCloseInit: UTxO;
  receivePacket: UTxO;
  ackPacket: UTxO;
  sendPacket: UTxO;
  timeoutPacket: UTxO;
  mintVoucher: UTxO;
};

@Injectable()
export class LucidService {
  private readonly referenceScripts: ReferenceScripts;
  constructor(
    @Inject(LUCID_IMPORTER) public LucidImporter: typeof import('@lucid-evolution/lucid'),
    @Inject(LUCID_CLIENT) public lucid: LucidEvolution,
    private configService: ConfigService,
  ) {
    const deploymentConfig = this.configService.get('deployment');
    this.referenceScripts = {
      spendHandler: deploymentConfig.validators.spendHandler.refUtxo,
      spendConnection: deploymentConfig.validators.spendConnection.refUtxo,
      spendChannel: deploymentConfig.validators.spendChannel.refUtxo,
      spendClient: deploymentConfig.validators.spendClient.refUtxo,
      spendMockModule: deploymentConfig.validators.spendMockModule?.refUtxo,
      spendTransferModule: deploymentConfig.validators.spendTransferModule.refUtxo,
      mintChannel: deploymentConfig.validators.mintChannelStt?.refUtxo || deploymentConfig.validators.mintChannel.refUtxo,
      mintClient: deploymentConfig.validators.mintClientStt?.refUtxo || deploymentConfig.validators.mintClient.refUtxo,
      mintConnection: deploymentConfig.validators.mintConnectionStt?.refUtxo || deploymentConfig.validators.mintConnection.refUtxo,
      mintVoucher: deploymentConfig.validators.mintVoucher.refUtxo,
      verifyProof: deploymentConfig.validators.verifyProof.refUtxo,
      hostStateStt: deploymentConfig.validators.hostStateStt?.refUtxo,
      channelOpenAck: deploymentConfig.validators.spendChannel.refValidator.chan_open_ack.refUtxo,
      channelCloseInit: deploymentConfig.validators.spendChannel.refValidator.chan_close_init.refUtxo,
      receivePacket: deploymentConfig.validators.spendChannel.refValidator.recv_packet.refUtxo,
      ackPacket: deploymentConfig.validators.spendChannel.refValidator.acknowledge_packet.refUtxo,
      sendPacket: deploymentConfig.validators.spendChannel.refValidator.send_packet.refUtxo,
      timeoutPacket: deploymentConfig.validators.spendChannel.refValidator.timeout_packet.refUtxo,
    };
  }
  // ========================== Public functions ==========================
  // ========================== UTXO-related methods ==========================
  public async findUtxoAtWithUnit(addressOrCredential: string, unit: string): Promise<UTxO> {
    const utxos = await this.lucid.utxosAtWithUnit(addressOrCredential, unit);

    if (utxos.length === 0) throw new GrpcNotFoundException(`Unable to find UTxO with unit ${unit}`);
    return utxos[utxos.length - 1];
  }

  public async findUtxoByUnit(unit: string): Promise<UTxO> {
    const utxo = await this.lucid.utxoByUnit(unit);
    if (!utxo) throw new GrpcNotFoundException(`Unable to find UTxO with unit ${unit}`);
    return utxo;
  }
  public async findUtxoAt(addressOrCredential: string): Promise<UTxO[]> {
    const utxos = await this.lucid.utxosAt(addressOrCredential);
    if (utxos.length === 0) throw new GrpcNotFoundException(`Unable to find UTxO at  ${addressOrCredential}`);
    return utxos;
  }

  public async findUtxoAtHandlerAuthToken(): Promise<UTxO> {
    const { address: addressOrCredential } = this.configService.get('deployment').validators.spendHandler;
    const handlerAuthTokenConfig = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthToken = handlerAuthTokenConfig.policyId + handlerAuthTokenConfig.name;
    const handlerUtxos = await this.lucid.utxosAt(addressOrCredential);
    if (handlerUtxos.length === 0) throw new GrpcNotFoundException(`Unable to find UTxO at  ${addressOrCredential}`);
    const handlerUtxo = handlerUtxos.find((utxo) => utxo.assets.hasOwnProperty(handlerAuthToken));
    if (!handlerUtxo) throw new GrpcNotFoundException(`Unable to find Handler UTxO at ${handlerAuthToken}`);
    return handlerUtxo;
  }

  /**
   * Find the HostState UTXO by its unique NFT (STT Architecture)
   * 
   * The IBC Host State NFT uniquely identifies the canonical host state UTXO.
   * This provides:
   * - Guaranteed uniqueness (exactly one UTXO with this NFT exists)
   * - Simple querying (no ambiguous UTXOs)
   * - Complete state history (follow the NFT through transactions)
   * 
   * @returns The HostState UTXO containing the NFT
   * @throws GrpcNotFoundException if NFT or UTXO not found
   */
  public async findUtxoAtHostStateNFT(): Promise<UTxO> {
    const { address: addressOrCredential } = this.configService.get('deployment').validators.hostStateStt;
    const hostStateNFTConfig = this.configService.get('deployment').hostStateNFT;
    const hostStateNFT = hostStateNFTConfig.policyId + hostStateNFTConfig.name;
    
    const hostStateUtxos = await this.lucid.utxosAt(addressOrCredential);
    if (hostStateUtxos.length === 0) {
      throw new GrpcNotFoundException(`Unable to find UTxOs at HostState STT address: ${addressOrCredential}`);
    }
    
    const hostStateUtxo = hostStateUtxos.find((utxo) => utxo.assets.hasOwnProperty(hostStateNFT));
    if (!hostStateUtxo) {
      throw new GrpcNotFoundException(
        `Unable to find HostState UTXO with NFT: ${hostStateNFT}. ` +
        `This indicates the IBC Host State has not been initialized or the NFT was not minted correctly.`
      );
    }
    
    return hostStateUtxo;
  }

  public async getPublicKeyHash(address: string): Promise<string> {
    return getAddressDetails(address).paymentCredential?.hash;
  }
  // ========================== helper ==========================
  public getHandlerTokenUnit(): string {
    return (
      this.configService.get('deployment').handlerAuthToken.policyId +
      this.configService.get('deployment').handlerAuthToken.name
    );
  }
  public getClientPolicyId(): string {
    return this.configService.get('deployment').validators.mintClientStt?.scriptHash || this.configService.get('deployment').validators.mintClient.scriptHash;
  }
  public getConnectionPolicyId(): string {
    return this.configService.get('deployment').validators.mintConnectionStt?.scriptHash || this.configService.get('deployment').validators.mintConnection.scriptHash;
  }
  public getChannelPolicyId(): string {
    return this.configService.get('deployment').validators.mintChannelStt?.scriptHash || this.configService.get('deployment').validators.mintChannel.scriptHash;
  }
  public getClientAuthTokenUnit(handlerDatum: HandlerDatum, clientId: bigint): string {
    const mintClientPolicyId = this.configService.get('deployment').validators.mintClientStt?.scriptHash || this.configService.get('deployment').validators.mintClient.scriptHash;
    const hostStateNFT = this.configService.get('deployment').hostStateNFT;
    const clientStateTokenName = this.generateTokenName(hostStateNFT, CLIENT_PREFIX, clientId);
    return mintClientPolicyId + clientStateTokenName;
  }

  public toBytes(buffer: Uint8Array) {
    if (!buffer) return '';
    return this.LucidImporter.toHex(buffer);
  }
  //string to hex
  public toHex(data: string) {
    return this.LucidImporter.toHex(Buffer.from(data));
  }
  //hex to string
  public toText(data: string) {
    return this.LucidImporter.toText(data);
  }
  //hex to string
  public fromText(data: string) {
    return this.LucidImporter.fromText(data);
  }
  //hex to string
  public credentialToAddress(address: string) {
    return credentialToAddress(this.lucid.config().network, {
      hash: address,
      type: 'Key',
    });
  }
  public async decodeDatum<T>(encodedDatum: string, type: CodecType): Promise<T> {
    try {
      switch (type) {
        case 'client':
          return (await decodeClientDatum(encodedDatum, this.LucidImporter)) as T;
        case 'connection':
          return (await decodeConnectionDatum(encodedDatum, this.LucidImporter)) as T;
        case 'handler':
          return (await decodeHandlerDatum(encodedDatum, this.LucidImporter)) as T;
        case 'channel':
          return (await decodeChannelDatum(encodedDatum, this.LucidImporter)) as T;
        case 'mockModule':
          return (await decodeMockModuleDatum(encodedDatum, this.LucidImporter)) as T;
        case 'host_state':
          return (await decodeHostStateDatum(encodedDatum, this.LucidImporter)) as T;
        default:
          throw new Error(`Unknown datum type: ${type}`);
      }
    } catch (error) {
      throw new GrpcInternalException(`An unexpected error occurred when trying to decode ${type}: ${error}`);
    }
  }
  // The main encode function
  public async encode<T>(data: T, type: CodecType): Promise<string> {
    try {
      switch (type) {
        case 'client':
          return await encodeClientDatum(data as ClientDatum, this.LucidImporter);
        case 'connection':
          return await encodeConnectionDatum(data as ConnectionDatum, this.LucidImporter);
        case 'handler':
          return await encodeHandlerDatum(data as HandlerDatum, this.LucidImporter);
        case 'channel':
          return await encodeChannelDatum(data as ChannelDatum, this.LucidImporter);
        case 'mockModule':
          return await encodeMockModuleDatum(data as MockModuleDatum, this.LucidImporter);
        case 'host_state':
          return await encodeHostStateDatum(data as HostStateDatum, this.LucidImporter);
        case 'host_state_redeemer': {
          const { Data: LucidData } = this.LucidImporter;
          // Must match the HostStateRedeemer ADT in host_state_stt.ak
          const HostStateRedeemerSchema = LucidData.Enum([
            LucidData.Literal('CreateClient'),
            LucidData.Literal('CreateConnection'),
            LucidData.Literal('CreateChannel'),
            LucidData.Object({ BindPort: LucidData.Object({ port: LucidData.Integer() }) }),
            LucidData.Literal('UpdateClient'),
            LucidData.Literal('UpdateConnection'),
            LucidData.Literal('UpdateChannel'),
            LucidData.Literal('HandlePacket'),
          ]);
          return LucidData.to(data as string, HostStateRedeemerSchema as any);
        }
        case 'spendClientRedeemer':
          return await encodeSpendClientRedeemer(data as SpendClientRedeemer, this.LucidImporter);
        case 'mintClientOperator':
          return await encodeMintClientOperator(data as MintClientOperator, this.LucidImporter);
        case 'mintClientRedeemer': {
          // MintClientRedeemer is { handler_auth_token: AuthToken }
          const { Data } = this.LucidImporter;
          const AuthTokenSchema = Data.Object({
            policy_id: Data.Bytes(),
            name: Data.Bytes(),
          });
          const MintClientRedeemerSchema = Data.Object({
            handler_auth_token: AuthTokenSchema,
          });
          return Data.to(data as any, MintClientRedeemerSchema);
        }
        case 'handlerOperator':
          return await encodeHandlerOperator(data as HandlerOperator, this.LucidImporter);
        case 'mintConnectionRedeemer':
          return await encodeMintConnectionRedeemer(data as MintConnectionRedeemer, this.LucidImporter);
        case 'spendConnectionRedeemer':
          return await encodeSpendConnectionRedeemer(data as SpendConnectionRedeemer, this.LucidImporter);
        case 'mintChannelRedeemer':
          return await encodeMintChannelRedeemer(data as MintChannelRedeemer, this.LucidImporter);
        case 'spendChannelRedeemer':
          return await encodeSpendChannelRedeemer(data as SpendChannelRedeemer, this.LucidImporter);
        case 'iBCModuleRedeemer':
          return await encodeIBCModuleRedeemer(data as IBCModuleRedeemer, this.LucidImporter);
        case 'mintVoucherRedeemer':
          return await encodeMintVoucherRedeemer(data as MintVoucherRedeemer, this.LucidImporter);
        default:
          throw new Error(`Unknown datum type: ${type}`);
      }
    } catch (error) {
      console.error(error);
      throw new GrpcInternalException(`An unexpected error occurred when trying to encode ${type}: ${error}`);
    }
  }

  public getClientTokenUnit(clientId: string): string {
    const mintClientPolicyId = this.configService.get('deployment').validators.mintClientStt?.scriptHash || this.configService.get('deployment').validators.mintClient.scriptHash;
    const hostStateNFT: AuthToken = this.configService.get('deployment').hostStateNFT;
    const clientTokenName = this.generateTokenName(hostStateNFT, CLIENT_PREFIX, BigInt(clientId));
    return mintClientPolicyId + clientTokenName;
  }
  public getConnectionTokenUnit(connectionId: bigint): [string, string] {
    const mintConnectionPolicyId = this.getMintConnectionScriptHash();
    const connectionTokenName = CONNECTION_TOKEN_PREFIX + convertString2Hex(connectionId.toString());
    return [mintConnectionPolicyId, connectionTokenName];
  }
  public getChannelTokenUnit(channelId: bigint): [string, string] {
    const mintChannelPolicyId = this.getMintChannelScriptHash();
    const channelTokenName = CHANNEL_TOKEN_PREFIX + convertString2Hex(channelId.toString());
    return [mintChannelPolicyId, channelTokenName];
  }
  // ========================== Build transaction ==========================

  public createUnsignedUpdateClientTransaction(
    currentClientUtxo: UTxO,
    encodedSpendClientRedeemer: string,
    encodedNewClientDatum: string,
    clientTokenUnit: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);

    tx.collectFrom([currentClientUtxo], encodedSpendClientRedeemer)
      .readFrom([this.referenceScripts.spendClient])
      .pay.ToContract(
        deploymentConfig.validators.spendClient.address,
        { kind: 'inline', value: encodedNewClientDatum },
        {
          [clientTokenUnit]: 1n,
        },
      );

    return tx;
  }

  public createUnsignedCreateClientTransaction(
    hostStateUtxo: any,
    encodedHostStateRedeemer: string,
    clientAuthTokenUnit: string,
    encodedMintClientRedeemer: string,
    encodedUpdatedHostStateDatum: string,
    encodedClientDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const hostStateNFT = deploymentConfig.hostStateNFT.policyId + deploymentConfig.hostStateNFT.name;
    const tx: TxBuilder = this.txFromWallet(constructedAddress);

    console.log('[DEBUG TX] ========== CREATE CLIENT TRANSACTION ==========');
    console.log('[DEBUG TX] HostState NFT:', hostStateNFT);
    console.log('[DEBUG TX] Client auth token unit:', clientAuthTokenUnit);
    console.log('[DEBUG TX] HostState STT address:', deploymentConfig.validators.hostStateStt.address);
    console.log('[DEBUG TX] Spend Client address:', deploymentConfig.validators.spendClient.address);
    console.log('[DEBUG TX] HostState STT ref script:', this.referenceScripts.hostStateStt.txHash + '#' + this.referenceScripts.hostStateStt.outputIndex);
    console.log('[DEBUG TX] Mint Client ref script:', this.referenceScripts.mintClient.txHash + '#' + this.referenceScripts.mintClient.outputIndex);

    // STT Transaction Structure:
    // 1. Spend the old HostState UTXO (with NFT)
    // 2. Create a new HostState UTXO (with same NFT, updated datum)
    // 3. Mint and create the new Client UTXO
    
    // CRITICAL: Override the datum in the UTXO to prevent Lucid from re-encoding it
    // Lucid Evolution has a bug where it re-encodes inline datums with indefinite arrays
    // We pass the original datum bytes explicitly to bypass Lucid's re-encoding
    const hostStateUtxoWithRawDatum = {
      ...hostStateUtxo,
      datum: hostStateUtxo.datum,  // Keep the raw hex datum
      datumHash: undefined,  // Remove datumHash to force inline datum
    };
    
    console.log('[DEBUG TX] HostState UTXO datum (keeping raw):', hostStateUtxo.datum?.substring(0, 50));
    console.log('[DEBUG TX] Redeemer for spending:', encodedHostStateRedeemer);
    
    // Build transaction: spend HostState UTXO, mint client token, create outputs
    tx.readFrom([this.referenceScripts.hostStateStt, this.referenceScripts.mintClient])
      .collectFrom([hostStateUtxoWithRawDatum], encodedHostStateRedeemer)
      .mintAssets(
        {
          [clientAuthTokenUnit]: 1n,
        },
        encodedMintClientRedeemer,
      );

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.pay.ToContract(address, { kind: 'inline', value: inline }, token);
    };
    
    // Recreate HostState UTXO with updated datum and same NFT
    addPayToContract(deploymentConfig.validators.hostStateStt.address, encodedUpdatedHostStateDatum, {
      [hostStateNFT]: 1n,
    });
    
    // Create new Client UTXO
    addPayToContract(deploymentConfig.validators.spendClient.address, encodedClientDatum, {
      [clientAuthTokenUnit]: 1n,
    });
    
    console.log('[DEBUG TX] ================================================');
    
    return tx;
  }
  public createUnsignedConnectionOpenInitTransaction(
    handlerUtxo: UTxO,
    hostStateUtxo: UTxO,
    encodedHostStateRedeemer: string,
    encodedSpendHandlerRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedMintConnectionRedeemer: string,
    encodedUpdatedHandlerDatum: string,
    encodedUpdatedHostStateDatum: string,
    encodedConnectionDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);
    const hostStateNFT = deploymentConfig.hostStateNFT.policyId + deploymentConfig.hostStateNFT.name;
    const hostStateUtxoWithRawDatum = {
      ...hostStateUtxo,
      datum: hostStateUtxo.datum,
      datumHash: undefined,
    };

    tx.readFrom([this.referenceScripts.spendHandler, this.referenceScripts.mintConnection, this.referenceScripts.hostStateStt])
      .collectFrom([hostStateUtxoWithRawDatum], encodedHostStateRedeemer)
      .collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .mintAssets(
        {
          [connectionTokenUnit]: 1n,
        },
        encodedMintConnectionRedeemer,
      )
      .readFrom([clientUtxo]);

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.pay.ToContract(address, { kind: 'inline', value: inline }, token);
    };
    addPayToContract(deploymentConfig.validators.hostStateStt.address, encodedUpdatedHostStateDatum, {
      [hostStateNFT]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendHandler.address, encodedUpdatedHandlerDatum, {
      [this.getHandlerTokenUnit()]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendConnection.address, encodedConnectionDatum, {
      [connectionTokenUnit]: 1n,
    });
    return tx;
  }
  public createUnsignedConnectionOpenTryTransaction(
    handlerUtxo: UTxO,
    hostStateUtxo: UTxO,
    encodedHostStateRedeemer: string,
    encodedSpendHandlerRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedMintConnectionRedeemer: string,
    encodedUpdatedHandlerDatum: string,
    encodedUpdatedHostStateDatum: string,
    encodedConnectionDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);
    const hostStateNFT = deploymentConfig.hostStateNFT.policyId + deploymentConfig.hostStateNFT.name;
    const hostStateUtxoWithRawDatum = {
      ...hostStateUtxo,
      datum: hostStateUtxo.datum,
      datumHash: undefined,
    };

    tx.readFrom([this.referenceScripts.spendHandler, this.referenceScripts.mintConnection, this.referenceScripts.hostStateStt])
      .collectFrom([hostStateUtxoWithRawDatum], encodedHostStateRedeemer)
      .collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .mintAssets(
        {
          [connectionTokenUnit]: 1n,
        },
        encodedMintConnectionRedeemer,
      )
      .readFrom([clientUtxo]);

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.pay.ToContract(address, { kind: 'inline', value: inline }, token);
    };
    addPayToContract(deploymentConfig.validators.hostStateStt.address, encodedUpdatedHostStateDatum, {
      [hostStateNFT]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendHandler.address, encodedUpdatedHandlerDatum, {
      [this.getHandlerTokenUnit()]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendConnection.address, encodedConnectionDatum, {
      [connectionTokenUnit]: 1n,
    });
    return tx;
  }
  public createUnsignedConnectionOpenAckTransaction(dto: UnsignedConnectionOpenAckDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([this.referenceScripts.spendConnection, this.referenceScripts.verifyProof])
      .collectFrom([dto.connectionUtxo], dto.encodedSpendConnectionRedeemer)
      .readFrom([dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendConnection.address,
        { kind: 'inline', value: dto.encodedUpdatedConnectionDatum },
        {
          [dto.connectionTokenUnit]: 1n,
        },
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );
    return tx;
  }
  public createUnsignedConnectionOpenConfirmTransaction(
    connectionUtxo: UTxO,
    encodedSpendConnectionRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedUpdatedConnectionDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);

    tx.readFrom([this.referenceScripts.spendConnection])
      .collectFrom([connectionUtxo], encodedSpendConnectionRedeemer)
      .readFrom([clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendConnection.address,
        { kind: 'inline', value: encodedUpdatedConnectionDatum },
        {
          [connectionTokenUnit]: 1n,
        },
      );
    return tx;
  }
  public createUnsignedChannelOpenInitTransaction(dto: UnsignedChannelOpenInitDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([
      this.referenceScripts.spendHandler,
      this.referenceScripts.mintChannel,
      this.referenceScripts.spendTransferModule,
    ])
      .collectFrom([dto.handlerUtxo], dto.encodedSpendHandlerRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .mintAssets(
        {
          [dto.channelTokenUnit]: 1n,
        },
        dto.encodedMintChannelRedeemer,
      )
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendHandler.address,
        { kind: 'inline', value: dto.encodedUpdatedHandlerDatum },
        { [this.getHandlerTokenUnit()]: 1n },
      )
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        { kind: 'inline', value: dto.encodedChannelDatum },
        { [dto.channelTokenUnit]: 1n },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, dto.transferModuleUtxo.assets);

    return tx;
  }

  public createUnsignedChannelOpenTryTransaction(
    handlerUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendMockModuleRedeemer: string,
    encodedSpendHandlerRedeemer: string,
    encodedMintChannelRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedHandlerDatum: string,
    encodedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);
    tx.collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([
        this.referenceScripts.spendHandler,
        this.referenceScripts.mintChannel,
        this.referenceScripts.spendMockModule,
      ])
      .mintAssets(
        {
          [channelTokenUnit]: 1n,
        },
        encodedMintChannelRedeemer,
      )
      .readFrom([connectionUtxo, clientUtxo]);
    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.pay.ToContract(address, { kind: 'inline', value: inline }, token);
    };
    addPayToContract(deploymentConfig.validators.spendHandler.address, encodedUpdatedHandlerDatum, {
      [this.getHandlerTokenUnit()]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendChannel.address, encodedChannelDatum, {
      [channelTokenUnit]: 1n,
    });
    addPayToContract(deploymentConfig.modules.mock.address, encodedNewMockModuleDatum, mockModuleUtxo.assets);

    return tx;
  }

  public createUnsignedChannelOpenAckTransaction(dto: UnsignedChannelOpenAckDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.channelOpenAck,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, dto.transferModuleUtxo.assets)
      .mintAssets(
        {
          [dto.chanOpenAckPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }
  public createUnsignedChannelCloseInitTransaction(dto: UnsignedChannelCloseInitDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendMockModule,
      this.referenceScripts.channelCloseInit,
    ])
      .collectFrom([dto.mockModuleUtxo], dto.encodedSpendMockModuleRedeemer)
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(
        deploymentConfig.modules.mock.address,
        {
          kind: 'inline',
          value: dto.mockModuleUtxo.datum,
        },
        dto.mockModuleUtxo.assets,
      )
      .mintAssets(
        {
          [dto.channelCloseInitPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      );
    return tx;
  }

  public createUnsignedChannelOpenConfirmTransaction(
    channelUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendChannelRedeemer: string,
    encodedSpendMockModuleRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(constructedAddress);

    tx.readFrom([this.referenceScripts.spendChannel, this.referenceScripts.spendMockModule])

      .collectFrom([channelUtxo], encodedSpendChannelRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([connectionUtxo, clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: encodedUpdatedChannelDatum,
        },
        {
          [channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(
        deploymentConfig.modules.mock.address,
        {
          kind: 'inline',
          value: encodedNewMockModuleDatum,
        },
        mockModuleUtxo.assets,
      );

    return tx;
  }
  public createUnsignedRecvPacketUnescrowTx(dto: UnsignedRecvPacketUnescrowDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.receivePacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUtxo.assets,
        lovelace: dto.transferModuleUtxo.assets.lovelace - dto.transferAmount,
      })
      .pay.ToAddress(dto.receiverAddress, {
        lovelace: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.recvPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }

  public createUnsignedRecvPacketTx(dto: UnsignedRecvPacketDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.receivePacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .mintAssets(
        {
          [dto.recvPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }

  public createUnsignedRecvPacketMintTx(dto: UnsignedRecvPacketMintDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.mintVoucher,
      this.referenceScripts.receivePacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .mintAssets(
        {
          [dto.voucherTokenUnit]: dto.transferAmount,
        },
        dto.encodedMintVoucherRedeemer,
      )
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUtxo.assets,
      })
      .pay.ToAddress(dto.receiverAddress, {
        [dto.voucherTokenUnit]: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.recvPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }

  public createUnsignedAckPacketSucceedTx(dto: UnsignedAckPacketSucceedDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      // minting 1
      this.referenceScripts.ackPacket,
      // minting 2 
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUtxo.assets,
      })
      .mintAssets(
        {
          [dto.ackPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }

  public createUnsignedAckPacketUnescrowTx(dto: UnsignedAckPacketUnescrowDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.ackPacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUtxo.assets,
        [dto.denomToken]: calculateTransferToken(
          dto.transferModuleUtxo.assets,
          0n - BigInt(dto.transferAmount),
          dto.denomToken,
        ),
      })
      .pay.ToAddress(dto.senderAddress, {
        [dto.denomToken]: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.ackPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }
  public createUnsignedAckPacketMintTx(dto: UnsignedAckPacketMintDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.mintVoucher,
      this.referenceScripts.ackPacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .mintAssets(
        {
          [dto.voucherTokenUnit]: dto.transferAmount,
        },
        dto.encodedMintVoucherRedeemer,
      )
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUtxo.assets,
        [dto.denomToken]: calculateTransferToken(
          dto.transferModuleUtxo.assets,
          0n - BigInt(dto.transferAmount),
          dto.denomToken,
        ),
      })
      .pay.ToAddress(dto.senderAddress, {
        [dto.voucherTokenUnit]: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.ackPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }

  public createUnsignedSendPacketEscrowTx(dto: UnsignedSendPacketEscrowDto): TxBuilder {
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.sendPacket,
    ])
      .collectFrom([dto.channelUTxO], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUTxO], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUTxO, dto.clientUTxO])
      .pay.ToContract(
        dto.spendChannelAddress,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(dto.transferModuleAddress, undefined, {
        ...dto.transferModuleUTxO.assets,
        [dto.denomToken]: calculateTransferToken(
          dto.transferModuleUTxO.assets,
          BigInt(dto.transferAmount),
          dto.denomToken,
        ),
      })
      .mintAssets(
        {
          [dto.sendPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      );

    return tx;
  }

  public createUnsignedSendPacketBurnTx(dto: UnsignedSendPacketBurnDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');

    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.mintVoucher,
      this.referenceScripts.sendPacket,
    ])
      .collectFrom([dto.channelUTxO], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUTxO], dto.encodedSpendTransferModuleRedeemer)
      .collectFrom([dto.senderVoucherTokenUtxo])
      .readFrom([dto.connectionUTxO, dto.clientUTxO])
      .mintAssets(
        {
          [dto.voucherTokenUnit]: -BigInt(dto.transferAmount),
        },
        dto.encodedMintVoucherRedeemer,
      )
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(deploymentConfig.modules.transfer.address, undefined, {
        ...dto.transferModuleUTxO.assets,
        [dto.voucherTokenUnit]: calculateTransferToken(
          dto.transferModuleUTxO.assets,
          BigInt(dto.transferAmount),
          dto.voucherTokenUnit,
        ),
      })
      .mintAssets(
        {
          [dto.sendPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      );

    return tx;
  }

  public createUnsignedTimeoutPacketMintTx(dto: UnsignedTimeoutPacketMintDto): TxBuilder {
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.mintVoucher,
      this.referenceScripts.timeoutPacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .mintAssets(
        {
          [dto.voucherTokenUnit]: dto.transferAmount,
        },
        dto.encodedMintVoucherRedeemer,
      )
      .pay.ToContract(
        dto.spendChannelAddress,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(dto.transferModuleAddress, undefined, {
        ...dto.transferModuleUtxo.assets,
        lovelace: dto.transferModuleUtxo.assets.lovelace - dto.transferAmount,
      })
      .pay.ToAddress(dto.senderAddress, {
        [dto.voucherTokenUnit]: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.timeoutPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }
  public createUnsignedTimeoutPacketUnescrowTx(dto: UnsignedTimeoutPacketUnescrowDto): TxBuilder {
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);
    tx.readFrom([
      this.referenceScripts.spendChannel,
      this.referenceScripts.spendTransferModule,
      this.referenceScripts.timeoutPacket,
      this.referenceScripts.verifyProof,
    ])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .collectFrom([dto.transferModuleUtxo], dto.encodedSpendTransferModuleRedeemer)
      .readFrom([dto.connectionUtxo, dto.clientUtxo])
      .pay.ToContract(
        dto.spendChannelAddress,
        {
          kind: 'inline',
          value: dto.encodedUpdatedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      )
      .pay.ToContract(dto.transferModuleAddress, undefined, {
        ...dto.transferModuleUtxo.assets,
        [dto.denomToken]: calculateTransferToken(
          dto.transferModuleUtxo.assets,
          0n - BigInt(dto.transferAmount),
          dto.denomToken,
        ),
      })
      .pay.ToAddress(dto.senderAddress, {
        [dto.denomToken]: dto.transferAmount,
      })
      .mintAssets(
        {
          [dto.timeoutPacketPolicyId]: 1n,
        },
        encodeAuthToken(dto.channelToken, this.LucidImporter),
      )
      .mintAssets(
        {
          [dto.verifyProofPolicyId]: 1n,
        },
        dto.encodedVerifyProofRedeemer,
      );

    return tx;
  }
  public createUnsignedTimeoutRefreshTx(dto: UnsignedTimeoutRefreshDto): TxBuilder {
    const deploymentConfig = this.configService.get('deployment');
    const tx: TxBuilder = this.txFromWallet(dto.constructedAddress);

    tx.readFrom([this.referenceScripts.spendChannel])
      .collectFrom([dto.channelUtxo], dto.encodedSpendChannelRedeemer)
      .pay.ToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          kind: 'inline',
          value: dto.encodedChannelDatum,
        },
        {
          [dto.channelTokenUnit]: 1n,
        },
      );

    return tx;
  }
  // ========================== private functions ==========================

  private getMintConnectionScriptHash(): string {
    return this.configService.get('deployment').validators.mintConnectionStt?.scriptHash || this.configService.get('deployment').validators.mintConnection.scriptHash;
  }
  private getMintChannelScriptHash(): string {
    return this.configService.get('deployment').validators.mintChannelStt?.scriptHash || this.configService.get('deployment').validators.mintChannel.scriptHash;
  }

  public generateTokenName = (baseToken: AuthToken, prefix: string, postfix: bigint): string => {
    if (postfix < 0) throw new Error('sequence must be unsigned integer');
    const postfixHex = convertString2Hex(postfix.toString());
    if (postfixHex.length > 16) throw new Error('postfix size > 8 bytes');
    const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(0, 40);
    const prefixPart = hashSha3_256(prefix).slice(0, 8);
    const fullName = baseTokenPart + prefixPart + postfixHex;
    return fullName;
  };

  private txFromWallet(constructedAddress: string): TxBuilder {
    // Use the same DEPLOYER_SK as Hermes for consistent signing
    // Both Gateway and Hermes now use the same wallet
    const deployerSk = this.configService.get('deployerSk');
    if (deployerSk) {
      this.lucid.selectWallet.fromPrivateKey(deployerSk);
    }
    return this.lucid.newTx();
  }
}
