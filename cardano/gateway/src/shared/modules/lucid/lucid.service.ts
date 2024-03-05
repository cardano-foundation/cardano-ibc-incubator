import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Lucid, type UTxO, type Tx, type SpendingValidator, type MintingPolicy } from 'lucid-cardano';
import { LUCID_CLIENT, LUCID_IMPORTER } from './lucid.provider';
import { CLIENT_TOKEN_PREFIX, HANDLER_TOKEN_NAME } from '../../../constant';
import { HandlerDatum, decodeHandlerDatum, encodeHandlerDatum } from 'src/shared/types/handler-datum';
import { GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { ClientState } from 'src/shared/types/client-state-types';
import { ConsensusState } from 'src/shared/types/consesus-state';
import { MintClientOperator, encodeMintClientOperator } from 'src/shared/types/mint-client-operator';
import { HandlerOperator, encodeHandlerOperator } from 'src/shared/types/handler-operator';
import { ClientDatum, encodeClientDatum } from 'src/shared/types/client-datum';
import { ClientDatumState } from 'src/shared/types/client-datum-state';
import { decodeClientDatum } from 'src/shared/types/client-datum';
import { Header } from 'src/shared/types/header';
import { SpendClientRedeemer, encodeSpendClientRedeemer } from 'src/shared/types/client-redeemer';
import { Height } from 'src/shared/types/height';

@Injectable()
export class LucidService {
  constructor(
    @Inject(LUCID_IMPORTER) public LucidImporter: typeof import('lucid-cardano'),
    @Inject(LUCID_CLIENT) public lucid: Lucid,
    private configService: ConfigService,
  ) {}

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
    const addressOrCredential = this.configService.get('deployment').validators.spendHandler.address;
    const handlerAuthTokenConfig = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthToken = handlerAuthTokenConfig.policyId + handlerAuthTokenConfig.name;
    const handlerUtxos = await this.lucid.utxosAt(addressOrCredential);
    if (handlerUtxos.length === 0) throw new GrpcNotFoundException(`Unable to find UTxO at  ${addressOrCredential}`);
    const handlerUtxo = handlerUtxos.find((utxo) => utxo.assets.hasOwnProperty(handlerAuthToken));
    if (!handlerUtxo) throw new GrpcNotFoundException(`Unable to find Handler UTxO at ${handlerUtxo.txHash}`);
    return handlerUtxo;
  }
  public async getClientDatum(clientDatumEncoded: string): Promise<ClientDatum> {
    return await decodeClientDatum(clientDatumEncoded, this.LucidImporter);
  }
  public createUpdatedHandlerDatum(HandlerDatumDecoded: HandlerDatum): HandlerDatum {
    return {
      state: { next_client_sequence: HandlerDatumDecoded.state.next_client_sequence + 1n },
      token: {
        name: this.configService.get('deployment').handlerAuthToken.name,
        policyId: this.configService.get('deployment').handlerAuthToken.policyId,
      },
    };
  }
  /**
   * Builds an unsigned UpdateClient transaction.
   **/
  public async buildUnsignedUpdateClientTx(clientId: string, header: Header): Promise<Tx> {
    // Get the token unit associated with the client
    const clientTokenUnit = this.getClientTokenUnit(clientId);
    // const clientTokenUnit = '46d060bc85f1517da53ac73985bd163c96d791f22e0641ba2af5e63e5c0f5a4c0706b6737aaadc47806655b66ed98894635e06265ebf93e0e26c70c4';
    // Find the UTXO for the client token
    const currentClientUtxo = await this.findUtxoByUnit(clientTokenUnit);
    // Retrieve the current client datum from the UTXO
    const currentClientDatum = await this.getClientDatum(currentClientUtxo.datum!);
    const currentClientDatumState = currentClientDatum.state;
    // Create a SpendClientRedeemer using the provided header
    const spendClientRedeemer: SpendClientRedeemer = this.createSpendClientRedeemer(header);
    const headerHeight = header.signedHeader.header.height;
    const newHeight: Height = {
      ...currentClientDatumState.clientState.latestHeight,
      revisionHeight: headerHeight,
    };

    const newClientState: ClientState = this.updateClientState(currentClientDatumState.clientState, newHeight);

    const newConsState: ConsensusState = this.createConsensusStateFromHeader(header);
    const currentConsStateInArray = Array.from(currentClientDatumState.consensusStates.entries());
    currentConsStateInArray.push([newHeight, newConsState]);
    currentConsStateInArray.sort(([height1], [height2]) => {
      if (height1.revisionNumber == height2.revisionNumber) {
        return Number(height1.revisionHeight - height2.revisionHeight);
      }
      return Number(height1.revisionNumber - height2.revisionNumber);
    });
    const newConsStates = new Map(currentConsStateInArray);
    const newClientDatum: ClientDatum = {
      ...currentClientDatum,
      state: {
        clientState: newClientState,
        consensusStates: newConsStates,
      },
    };

    const encodedSpendClientRedeemer = await encodeSpendClientRedeemer(spendClientRedeemer, this.LucidImporter);
    const encodedNewClientDatum = await encodeClientDatum(newClientDatum, this.LucidImporter);
    return this.createUnsignedUpdateClientTransaction(
      currentClientUtxo,
      encodedSpendClientRedeemer,
      encodedNewClientDatum,
      clientTokenUnit,
    );
  }

  /**
   * Builds an unsigned transaction for creating a new client, incorporating client and consensus state.
   *
   * @returns A Promise resolving to the unsigned transaction (Tx) for creating a new client.
   */
  public async buildUnsignedCreateClientTx(
    clientState: ClientState,
    consensusState: ConsensusState,
  ): Promise<[Tx, bigint]> {
    const handlerUtxo: UTxO = await this.findUtxoAtHandlerAuthToken();
    // Decode the handler datum from the handler UTXO
    const handlerDatumDecoded: HandlerDatum = await decodeHandlerDatum(handlerUtxo.datum!, this.LucidImporter);
    // Create an updated handler datum with an incremented client sequence
    const updatedHandlerDatum: HandlerDatum = this.createUpdatedHandlerDatum(handlerDatumDecoded);
    // const clientStateTokenName = this.generateClientStateTokenName(handlerDatumDecoded);
    const mintClientScriptHash = this.getMintClientScriptHash();

    const clientDatumState: ClientDatumState = {
      clientState: clientState,
      consensusStates: new Map([[clientState.latestHeight, consensusState]]),
    };

    const clientTokenName = this.generateClientTokenName(handlerDatumDecoded);

    const clientDatum: ClientDatum = {
      state: clientDatumState,
      token: {
        policyId: mintClientScriptHash,
        name: clientTokenName,
      },
    };
    const mintClientOperator: MintClientOperator = this.createMintClientOperator();
    const clientAuthTokenUnit = mintClientScriptHash + clientTokenName;
    const handlerOperator: HandlerOperator = 'CreateClient';
    // Encode encoded data for created transaction
    const mintClientOperatorEncoded: string = await encodeMintClientOperator(mintClientOperator, this.LucidImporter);
    const handlerOperatorEncoded: string = await encodeHandlerOperator(handlerOperator, this.LucidImporter);
    const updatedHandlerDatumEncoded: string = await encodeHandlerDatum(updatedHandlerDatum, this.LucidImporter);
    const clientDatumEncoded: string = await encodeClientDatum(clientDatum, this.LucidImporter);
    // Create and return the unsigned transaction for creating new client
    return [
      this.createUnsignedCreateClientTransaction(
        handlerUtxo,
        handlerOperatorEncoded,
        clientAuthTokenUnit,
        mintClientOperatorEncoded,
        updatedHandlerDatumEncoded,
        clientDatumEncoded,
      ),
      handlerDatumDecoded.state.next_client_sequence,
    ];
  }
  public getClientAuthTokenUnit(handlerDatum: HandlerDatum): string {
    const mintClientPolicyId = this.getMintClientScriptHash();
    const handlerAuthTokenUnit = this.getHandlerAuthTokenUnit();
    const nextClientSequenceEncoded = this.LucidImporter.Data.to(handlerDatum.state.next_client_sequence - 1n);
    // const nextClientSequenceEncoded = this.LucidImporter.Data.to(BigInt(9));
    const clientStateTokenName = this.generateTokenName(
      handlerAuthTokenUnit,
      CLIENT_TOKEN_PREFIX,
      nextClientSequenceEncoded,
    );
    return mintClientPolicyId + clientStateTokenName;
  }
  public getClientTokenUnit(clientId: string) {
    const mintClientPolicyId = this.getMintClientScriptHash();
    const clientTokenName = this.getClientTokenName(clientId);
    return mintClientPolicyId + clientTokenName;
  }
  private updateClientState(clientState: ClientState, newHeight: Height): ClientState {
    return {
      ...clientState,
      latestHeight: newHeight,
    };
  }
  private createUnsignedUpdateClientTransaction(
    currentClientUtxo: UTxO,
    encodedSpendClientRedeemer: string,
    encodedNewClientDatum: string,
    clientTokenUnit: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const tx = this.lucid.newTx();
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
  private createUnsignedCreateClientTransaction(
    handlerUtxo: any,
    handlerOperatorEncoded: string,
    clientAuthTokenUnit: string,
    mintClientOperatorEncoded: string,
    updatedHandlerDatumEncoded: string,
    clientDatumEncoded: string,
  ): Tx {
    const deploymentConfig = this.configService.get('deployment');
    const handlerAuthToken = deploymentConfig.handlerAuthToken.policyId + deploymentConfig.handlerAuthToken.name;
    const tx = this.lucid.newTx();

    tx.collectFrom([handlerUtxo], handlerOperatorEncoded)
      .attachSpendingValidator(this.getSpendingValidator(deploymentConfig.validators.spendHandler.script))
      .mintAssets(
        {
          [clientAuthTokenUnit]: 1n,
        },
        mintClientOperatorEncoded,
      )
      .attachMintingPolicy(this.getMintingPolicy(deploymentConfig.validators.mintClient.script));

    const addPayToContract = (address: string, inline: string, token: Record<string, bigint>) => {
      tx.payToContract(address, { inline }, token);
    };
    addPayToContract(deploymentConfig.validators.spendHandler.address, updatedHandlerDatumEncoded, {
      [handlerAuthToken]: 1n,
    });
    addPayToContract(deploymentConfig.validators.spendClient.address, clientDatumEncoded, {
      [clientAuthTokenUnit]: 1n,
    });
    // Optional: call validTo method if needed
    return tx;
  }
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
  private createMintClientOperator(): MintClientOperator {
    return {
      MintNewClient: {
        handlerAuthToken: {
          name: HANDLER_TOKEN_NAME,
          policyId: this.configService.get('deployment').validators.mintHandlerValidator.scriptHash,
        },
      },
    };
  }
  private createSpendClientRedeemer(header: Header): SpendClientRedeemer {
    return {
      UpdateClient: {
        header,
      },
    };
  }
  private createConsensusStateFromHeader(header: Header): ConsensusState {
    return {
      timestamp: header.signedHeader.header.time,
      next_validators_hash: header.signedHeader.header.nextValidatorsHash,
      root: {
        hash: header.signedHeader.header.appHash,
      },
    };
  }
  private getHandlerAuthTokenUnit(): string {
    const handlerAuthTokenConfig = this.configService.get('deployment').handlerAuthToken;
    return handlerAuthTokenConfig.policyId + handlerAuthTokenConfig.name;
  }
  private generateClientTokenName(handlerDatum: HandlerDatum): string {
    const handlerAuthTokenUnit = this.getHandlerAuthTokenUnit();
    const nextClientSequenceEncoded = this.LucidImporter.Data.to(handlerDatum.state.next_client_sequence);
    return this.generateTokenName(handlerAuthTokenUnit, CLIENT_TOKEN_PREFIX, nextClientSequenceEncoded);
  }
  public toBytes(buffer: Uint8Array) {
    return this.LucidImporter.toHex(buffer);
  }
  private generateTokenName(...parts: any[]): string {
    return this.LucidImporter.toHex(
      this.LucidImporter.C.hash_blake2b256(this.LucidImporter.fromHex(parts.map(String).join(''))),
    );
  }
  private getMintClientScriptHash(): string {
    return this.configService.get('deployment').validators.mintClient.scriptHash;
  }
  private getMintClientTokenName(): string {
    return this.configService.get('deployment').validators.mintClient.name;
  }
  private getClientTokenName(clientId: string): string {
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthTokenPolicyId = handlerAuthToken.policyId;
    const handlerAuthTokenName = handlerAuthToken.name;
    const clientIdEncoded = this.LucidImporter.Data.to(BigInt(clientId));
    return this.generateTokenName(handlerAuthTokenPolicyId, handlerAuthTokenName, CLIENT_TOKEN_PREFIX, clientIdEncoded);
  }
}
