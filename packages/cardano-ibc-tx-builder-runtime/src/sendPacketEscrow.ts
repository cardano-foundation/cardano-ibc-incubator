import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import type { UnsignedSendPacketEscrowTxInput } from '@cardano-ibc/tx-builder';

export type SendPacketEscrowDependencies = {
  newTx: () => TxBuilder;
  hostStateAddress: string | undefined;
  hostStateTokenUnit: string;
  transferModuleRootAddress: string;
  referenceScripts: {
    spendChannel: UTxO;
    spendTransferModule: UTxO;
    mintTransferEscrowShard: UTxO;
    sendPacket: UTxO;
    hostStateStt: UTxO;
  };
  encodeAuthToken: (token: UnsignedSendPacketEscrowTxInput['channelToken']) => string;
  internalError?: (message: string) => Error;
};

export function createUnsignedSendPacketEscrowTx(
  dependencies: SendPacketEscrowDependencies,
  dto: UnsignedSendPacketEscrowTxInput,
): TxBuilder {
  const internalError = dependencies.internalError ?? ((message: string) => new Error(message));
  if (!dependencies.hostStateAddress) {
    throw internalError('Host state script address is missing from deployment config');
  }
  if (!dto.walletUtxos || dto.walletUtxos.length === 0) {
    throw internalError('Sender wallet UTxOs are required for escrow send packet');
  }
  if (!dto.encodedTransferEscrowDatum) {
    throw internalError('Transfer escrow datum is required for sharded escrow updates');
  }
  if (!dto.transferModuleReferenceUtxo || (!dto.transferEscrowUtxo && (
    !dto.transferEscrowShardTokenUnit ||
    !dto.encodedMintTransferEscrowShardRedeemer ||
    !dto.encodedUpdatedTransferModuleDatum
  ))) {
    throw internalError(
      'Transfer module reference UTxO, shard token, and shard mint redeemer are required to create an escrow shard',
    );
  }

  const refs = dependencies.referenceScripts;
  const tx = dependencies.newTx();
  tx.readFrom([
    refs.spendChannel,
    refs.spendTransferModule,
    refs.mintTransferEscrowShard,
    refs.sendPacket,
    refs.hostStateStt,
  ])
    .collectFrom([{ ...dto.hostStateUtxo, datumHash: undefined }], dto.encodedHostStateRedeemer)
    .collectFrom([dto.channelUTxO], dto.encodedSpendChannelRedeemer)
    .readFrom([dto.connectionUTxO, dto.clientUTxO])
    .pay.ToContract(
      dependencies.hostStateAddress,
      { kind: 'inline', value: dto.encodedUpdatedHostStateDatum },
      dto.hostStateUtxo.assets,
    )
    .pay.ToContract(
      dto.spendChannelAddress,
      { kind: 'inline', value: dto.encodedUpdatedChannelDatum },
      dto.channelUTxO.assets,
    )
    .mintAssets(
      { [dto.sendPacketPolicyId]: 1n },
      dependencies.encodeAuthToken(dto.channelToken),
    );

  if (dto.transferEscrowUtxo) {
    tx
      .readFrom([dto.transferModuleReferenceUtxo])
      .collectFrom([dto.transferEscrowUtxo], dto.encodedSpendTransferModuleRedeemer);
  } else {
    tx
      .collectFrom([dto.transferModuleReferenceUtxo], dto.encodedSpendTransferModuleRedeemer)
      .mintAssets(
        { [dto.transferEscrowShardTokenUnit!]: 1n },
        dto.encodedMintTransferEscrowShardRedeemer,
      )
      .pay.ToContract(
        dependencies.transferModuleRootAddress,
        { kind: 'inline', value: dto.encodedUpdatedTransferModuleDatum! },
        dto.transferModuleReferenceUtxo.assets,
      );
  }

  const updatedAssets = { ...dto.transferEscrowUtxo?.assets };
  updatedAssets[dto.denomToken] = (updatedAssets[dto.denomToken] ?? 0n) + dto.transferAmount;
  if (!dto.transferEscrowUtxo && dto.transferEscrowShardTokenUnit) {
    updatedAssets[dto.transferEscrowShardTokenUnit] =
      (updatedAssets[dto.transferEscrowShardTokenUnit] ?? 0n) + 1n;
  }
  for (const [unit, amount] of Object.entries(updatedAssets)) {
    if (amount === 0n) delete updatedAssets[unit];
  }
  if (
    (updatedAssets[dto.denomToken] ?? 0n) > 0n ||
    Object.keys(updatedAssets).some((unit) => unit !== 'lovelace')
  ) {
    tx.pay.ToContract(
      dto.transferModuleAddress,
      { kind: 'inline', value: dto.encodedTransferEscrowDatum },
      updatedAssets,
    );
  }
  return tx;
}
