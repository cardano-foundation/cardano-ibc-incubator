import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Lucid, type UTxO, Tx, type SpendingValidator, type MintingPolicy } from 'lucid-cardano';
import { LUCID_CLIENT, LUCID_IMPORTER } from './lucid.provider';
import { CHANNEL_TOKEN_PREFIX, CLIENT_PREFIX, CONNECTION_TOKEN_PREFIX } from '../../../constant';
import { HandlerDatum, decodeHandlerDatum, encodeHandlerDatum } from '../../types/handler-datum';
import { GrpcInternalException, GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { MintClientOperator, encodeMintClientOperator } from '../../types/mint-client-operator';
import { HandlerOperator, encodeHandlerOperator } from '../../types/handler-operator';
import { ClientDatum, encodeClientDatum } from '../../types/client-datum';
import { decodeClientDatum } from '../../types/client-datum';
import { SpendClientRedeemer, encodeSpendClientRedeemer } from '../../types/client-redeemer';
import { AuthToken } from '../../types/auth-token';
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
import { hashSha3_256 } from '../../helpers/hex';
import { IBCModuleRedeemer, encodeIBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import {
  MockModuleDatum,
  decodeMockModuleDatum,
  encodeMockModuleDatum,
} from '@shared/types/apps/mock/mock-module-datum';
type CodecType =
  | 'client'
  | 'connection'
  | 'handler'
  | 'channel'
  | 'mockModule'
  | 'spendClientRedeemer'
  | 'mintClientOperator'
  | 'handlerOperator'
  | 'mintConnectionRedeemer'
  | 'spendConnectionRedeemer'
  | 'mintChannelRedeemer'
  | 'spendChannelRedeemer'
  | 'iBCModuleRedeemer';
@Injectable()
export class LucidService {
  constructor(
    @Inject(LUCID_IMPORTER) public LucidImporter: typeof import('lucid-cardano'),
    @Inject(LUCID_CLIENT) public lucid: Lucid,
    private configService: ConfigService,
  ) {}
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
  // ========================== helper ==========================
  public getHandlerTokenUnit(): string {
    return (
      this.configService.get('deployment').handlerAuthToken.policyId +
      this.configService.get('deployment').handlerAuthToken.name
    );
  }
  public getClientPolicyId(): string {
    return this.configService.get('deployment').validators.mintClient.scriptHash;
  }
  public getConnectionPolicyId(): string {
    return this.configService.get('deployment').validators.mintConnection.scriptHash;
  }
  public getChannelPolicyId(): string {
    return this.configService.get('deployment').validators.mintChannel.scriptHash;
  }
  public getClientAuthTokenUnit(handlerDatum: HandlerDatum): string {
    const mintClientPolicyId = this.configService.get('deployment').validators.mintClient.scriptHash;
    // const encodedNextClientSequence = this.LucidImporter.Data.to(handlerDatum.state.next_client_sequence - 1n);
    const baseToken = handlerDatum.token;
    const clientStateTokenName = this.generateTokenName(
      baseToken,
      CLIENT_PREFIX,
      handlerDatum.state.next_client_sequence - 1n,
    );
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
        case 'spendClientRedeemer':
          return await encodeSpendClientRedeemer(data as SpendClientRedeemer, this.LucidImporter);
        case 'mintClientOperator':
          return await encodeMintClientOperator(data as MintClientOperator, this.LucidImporter);
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
        default:
          throw new Error(`Unknown datum type: ${type}`);
      }
    } catch (error) {
      throw new GrpcInternalException(`An unexpected error occurred when trying to encode ${type}: ${error}`);
    }
  }

  public getClientTokenUnit(clientId: string): string {
    const mintClientPolicyId = this.configService.get('deployment').validators.mintClient.scriptHash;
    const handlerAuthToken: AuthToken = this.configService.get('deployment').handlerAuthToken;
    const clientTokenName = this.generateTokenName(handlerAuthToken, CLIENT_PREFIX, BigInt(clientId));
    return mintClientPolicyId + clientTokenName;
  }
  public getConnectionTokenUnit(connectionId: bigint): [string, string] {
    const mintConnectionPolicyId = this.getMintConnectionScriptHash();
    const handlerAuthToken: AuthToken = this.configService.get('deployment').handlerAuthToken;
    const connectionTokenName = this.generateTokenName(handlerAuthToken, CONNECTION_TOKEN_PREFIX, BigInt(connectionId));
    return [mintConnectionPolicyId, connectionTokenName];
  }
  public getChannelTokenUnit(channelId: bigint): [string, string] {
    const mintChannelPolicyId = this.getMintChannelScriptHash();
    const handlerAuthToken: AuthToken = this.configService.get('deployment').handlerAuthToken;
    const channelTokenName = this.generateTokenName(handlerAuthToken, CHANNEL_TOKEN_PREFIX, channelId);
    return [mintChannelPolicyId, channelTokenName];
  }
  // ========================== Build transaction ==========================

  public createUnsignedUpdateClientTransaction(
    currentClientUtxo: UTxO,
    encodedSpendClientRedeemer: string,
    encodedNewClientDatum: string,
    clientTokenUnit: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([currentClientUtxo], encodedSpendClientRedeemer)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendClient.script))
      .payToContract(
        deploymentConfig.validators.spendClient.address,
        { inline: encodedNewClientDatum },
        {
          [clientTokenUnit]: 1n,
        },
      );

    return tx;
  }
  public createUnsignedCreateClientTransaction(
    handlerUtxo: any,
    encodedHandlerOperator: string,
    clientAuthTokenUnit: string,
    encodedMintClientOperator: string,
    encodedUpdatedHandlerDatum: string,
    encodedClientDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const handlerAuthToken = deploymentConfig.handlerAuthToken.policyId + deploymentConfig.handlerAuthToken.name;
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([handlerUtxo], encodedHandlerOperator)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendHandler.script))
      .mintAssets(
        {
          [clientAuthTokenUnit]: 1n,
        },
        encodedMintClientOperator,
      )
      .attachMintingPolicy(this.getMintingPolicy(deploymentConfig.validators.mintClient.script));

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
    };
    addPayToContract(deploymentConfig.validators.spendHandler.address, encodedUpdatedHandlerDatum, {
      [handlerAuthToken]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendClient.address, encodedClientDatum, {
      [clientAuthTokenUnit]: 1n,
    });
    // Optional: call validTo method if needed
    return tx;
  }
  public createUnsignedConnectionOpenInitTransaction(
    handlerUtxo: UTxO,
    encodedSpendHandlerRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedMintConnectionRedeemer: string,
    encodedUpdatedHandlerDatum: string,
    encodedConnectionDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendHandler.script))
      .mintAssets(
        {
          [connectionTokenUnit]: 1n,
        },
        encodedMintConnectionRedeemer,
      )
      .attachMintingPolicy(this.getMintingPolicy(deploymentConfig.validators.mintConnection.script))
      .readFrom([clientUtxo]);

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
    };
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
    encodedSpendHandlerRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedMintConnectionRedeemer: string,
    encodedUpdatedHandlerDatum: string,
    encodedConnectionDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendHandler.script))
      .mintAssets(
        {
          [connectionTokenUnit]: 1n,
        },
        encodedMintConnectionRedeemer,
      )
      .attachMintingPolicy(this.getMintingPolicy(deploymentConfig.validators.mintConnection.script))
      .readFrom([clientUtxo]);

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
    };
    addPayToContract(deploymentConfig.validators.spendHandler.address, encodedUpdatedHandlerDatum, {
      [this.getHandlerTokenUnit()]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendConnection.address, encodedConnectionDatum, {
      [connectionTokenUnit]: 1n,
    });
    return tx;
  }
  public createUnsignedConnectionOpenAckTransaction(
    connectionUtxo: UTxO,
    encodedSpendConnectionRedeemer: string,
    connectionTokenUnit: string,
    clientUtxo: UTxO,
    encodedUpdatedConnectionDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([connectionUtxo], encodedSpendConnectionRedeemer)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendConnection.script))
      .readFrom([clientUtxo])
      .payToContract(
        deploymentConfig.validators.spendConnection.address,
        { inline: encodedUpdatedConnectionDatum },
        {
          [connectionTokenUnit]: 1n,
        },
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
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.collectFrom([connectionUtxo], encodedSpendConnectionRedeemer)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendConnection.script))
      .readFrom([clientUtxo])
      .payToContract(
        deploymentConfig.validators.spendConnection.address,
        { inline: encodedUpdatedConnectionDatum },
        {
          [connectionTokenUnit]: 1n,
        },
      );
    return tx;
  }
  public createUnsignedChannelOpenInitTransaction(
    handlerUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    spendHandlerRefUtxo: UTxO,
    mintChannelRefUtxo: UTxO,
    spendMockModuleRefUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendMockModuleRedeemer: string,
    encodedSpendHandlerRedeemer: string,
    encodedMintChannelRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedHandlerDatum: string,
    encodedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.readFrom([spendHandlerRefUtxo, mintChannelRefUtxo, spendMockModuleRefUtxo])
      .collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .mintAssets(
        {
          [channelTokenUnit]: 1n,
        },
        encodedMintChannelRedeemer,
      )
      .readFrom([connectionUtxo, clientUtxo]);
    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
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
  public createUnsignedChannelOpenTryTransaction(
    handlerUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    mockModuleUtxo: UTxO,
    spendHandlerRefUtxo: UTxO,
    mintChannelRefUtxo: UTxO,
    spendMockModuleRefUtxo: UTxO,
    encodedSpendMockModuleRedeemer: string,
    encodedSpendHandlerRedeemer: string,
    encodedMintChannelRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedHandlerDatum: string,
    encodedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);
    tx.collectFrom([handlerUtxo], encodedSpendHandlerRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([spendHandlerRefUtxo, mintChannelRefUtxo, spendMockModuleRefUtxo])
      .mintAssets(
        {
          [channelTokenUnit]: 1n,
        },
        encodedMintChannelRedeemer,
      )
      .readFrom([connectionUtxo, clientUtxo]);
    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
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

  public createUnsignedChannelOpenAckTransaction(
    channelUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    spendChannelRefUtxo: UTxO,
    spendMockModuleRefUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendChannelRedeemer: string,
    encodedSpendMockModuleRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.readFrom([spendChannelRefUtxo, spendMockModuleRefUtxo])
      .collectFrom([channelUtxo], encodedSpendChannelRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([connectionUtxo, clientUtxo])
      .payToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          inline: encodedUpdatedChannelDatum,
        },
        {
          [channelTokenUnit]: 1n,
        },
      )
      .payToContract(
        deploymentConfig.modules.mock.address,
        {
          inline: encodedNewMockModuleDatum,
        },
        mockModuleUtxo.assets,
      );

    return tx;
  }
  public createUnsignedChannelOpenConfirmTransaction(
    channelUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    spendChannelRefUtxo: UTxO,
    spendMockModuleRefUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendChannelRedeemer: string,
    encodedSpendMockModuleRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx: Tx = this.txFromWallet(constructedAddress);

    tx.readFrom([spendChannelRefUtxo, spendMockModuleRefUtxo])

      .collectFrom([channelUtxo], encodedSpendChannelRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([connectionUtxo, clientUtxo])
      .payToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          inline: encodedUpdatedChannelDatum,
        },
        {
          [channelTokenUnit]: 1n,
        },
      )
      .payToContract(
        deploymentConfig.modules.mock.address,
        {
          inline: encodedNewMockModuleDatum,
        },
        mockModuleUtxo.assets,
      );

    return tx;
  }
  public createUnsignedRecvPacketTransaction(
    channelUtxo: UTxO,
    connectionUtxo: UTxO,
    clientUtxo: UTxO,
    spendChannelRefUtxo: UTxO,
    spendMockModuleRefUtxo: UTxO,
    mockModuleUtxo: UTxO,
    encodedSpendChannelRedeemer: string,
    encodedSpendMockModuleRedeemer: string,
    channelTokenUnit: string,
    encodedUpdatedChannelDatum: string,
    encodedNewMockModuleDatum: string,
    constructedAddress: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');

    const tx: Tx = this.txFromWallet(constructedAddress);
    tx.readFrom([spendChannelRefUtxo, spendMockModuleRefUtxo])
      .collectFrom([channelUtxo], encodedSpendChannelRedeemer)
      .collectFrom([mockModuleUtxo], encodedSpendMockModuleRedeemer)
      .readFrom([connectionUtxo, clientUtxo])
      .payToContract(
        deploymentConfig.validators.spendChannel.address,
        {
          inline: encodedUpdatedChannelDatum,
        },
        {
          [channelTokenUnit]: 1n,
        },
      )
      .payToContract(
        deploymentConfig.modules.mock.address,
        {
          inline: encodedNewMockModuleDatum,
        },
        mockModuleUtxo.assets,
      );

    return tx;
  }
  // ========================== private functions ==========================

  private getSpendingValidator(script: string): SpendingValidator {
    return {
      type: 'PlutusV2',
      script: script,
    };
  }
  private getMintingPolicy(script: string): MintingPolicy {
    return {
      type: 'PlutusV2',
      script: script,
    };
  }

  private getMintConnectionScriptHash(): string {
    return this.configService.get('deployment').validators.mintConnection.scriptHash;
  }
  private getMintChannelScriptHash(): string {
    return this.configService.get('deployment').validators.mintChannel.scriptHash;
  }

  public generateTokenName = (baseToken: AuthToken, prefix: string, postfix: bigint): string => {
    if (postfix < 0) throw new Error('sequence must be unsigned integer');
    const postfixHex = this.toHex(postfix.toString());
    if (postfixHex.length > 16) throw new Error('postfix size > 8 bytes');
    const baseTokenPart = hashSha3_256(baseToken.policyId + baseToken.name).slice(0, 40);
    const prefixPart = hashSha3_256(prefix).slice(0, 8);
    const fullName = baseTokenPart + prefixPart + postfixHex;
    return fullName;
  };

  private txFromWallet(constructedAddress: string): Tx {
    if (constructedAddress) {
      try {
        const lucid = this.lucid.selectWalletFrom({ address: constructedAddress });
        return lucid.newTx();
      } catch (err) {
        throw new GrpcInternalException('invalid constructed address');
      }
    }
    return this.lucid.newTx();
  }
}