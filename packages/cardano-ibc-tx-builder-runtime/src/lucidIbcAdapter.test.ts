import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as LucidImporter from '@lucid-evolution/lucid';
import type { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { LucidIbcAdapter, type DeploymentConfig } from './lucidIbcAdapter';

type TxRecording = {
  readFrom: UTxO[][];
  mints: Array<{ assets: Record<string, bigint>; redeemer: string }>;
  payments: Array<{
    address: string;
    datum: unknown;
    assets: Record<string, bigint>;
  }>;
};

function recordingTx(): { tx: TxBuilder; recording: TxRecording } {
  const recording: TxRecording = {
    readFrom: [],
    mints: [],
    payments: [],
  };
  const tx = {
    readFrom(utxos: UTxO[]) {
      recording.readFrom.push(utxos);
      return tx;
    },
    collectFrom() {
      return tx;
    },
    mintAssets(assets: Record<string, bigint>, redeemer: string) {
      recording.mints.push({ assets, redeemer });
      return tx;
    },
    pay: {
      ToContract(
        address: string,
        datum: unknown,
        assets: Record<string, bigint>,
      ) {
        recording.payments.push({ address, datum, assets });
        return tx;
      },
    },
  };

  return { tx: tx as unknown as TxBuilder, recording };
}

function refUtxo(label: string, outputIndex: number): UTxO {
  return {
    txHash: Buffer.from(label).toString('hex').padEnd(64, '0').slice(0, 64),
    outputIndex,
    address: `addr_test1_${label}`,
    assets: { lovelace: 2_000_000n },
  };
}

function deployment(): DeploymentConfig {
  const ref = (label: string, outputIndex: number) => {
    const utxo = refUtxo(label, outputIndex);
    return { txHash: utxo.txHash, outputIndex: utxo.outputIndex };
  };

  return {
    hostStateNFT: { policyId: '10'.repeat(28), name: 'aa' },
    validators: {
      hostStateStt: {
        address: 'addr_test1_host',
        refUtxo: ref('host', 0),
      },
      spendChannel: {
        address: 'addr_test1_channel',
        refUtxo: ref('channel', 1),
        refValidator: {
          send_packet: { refUtxo: ref('send-packet', 2) },
        },
      },
      spendTransferModule: { refUtxo: ref('transfer', 3) },
      mintVoucher: {
        refUtxo: ref('voucher', 4),
        scriptHash: '20'.repeat(28),
      },
      mintPort: {
        refUtxo: ref('port', 5),
        scriptHash: '30'.repeat(28),
      },
      mintTransferEscrowShard: {
        refUtxo: ref('escrow-shard', 6),
        scriptHash: '40'.repeat(28),
      },
      mintLifecycleCreationMarker: {
        refUtxo: ref('creation', 7),
        scriptHash: '50'.repeat(28),
      },
      mintLifecycleReclamationMarker: {
        refUtxo: ref('reclamation', 8),
        scriptHash: '60'.repeat(28),
      },
      mintLifecycleOperationalMarker: {
        refUtxo: ref('operational', 9),
        scriptHash: '70'.repeat(28),
      },
      mintLifecyclePacketMarker: {
        refUtxo: ref('packet', 10),
        scriptHash: '80'.repeat(28),
      },
      mintConnectionStt: { scriptHash: '90'.repeat(28) },
      mintChannelStt: { scriptHash: 'a0'.repeat(28) },
      mintClientStt: { scriptHash: 'b0'.repeat(28) },
    },
    modules: { transfer: { address: 'addr_test1_transfer_module' } },
  };
}

async function adapterHarness() {
  const txRecorder = recordingTx();
  const config = deployment();
  const lucid = {
    newTx: () => txRecorder.tx,
    utxosByOutRef: async ([outRef]: Array<{ txHash: string; outputIndex: number }>) => [
      {
        txHash: outRef.txHash,
        outputIndex: outRef.outputIndex,
        address: `addr_test1_ref_${outRef.outputIndex}`,
        assets: { lovelace: 2_000_000n },
      },
    ],
  };
  const adapter = new LucidIbcAdapter(
    LucidImporter,
    lucid as never,
    config,
  );
  await adapter.onModuleInit();
  return { adapter, config, recording: txRecorder.recording };
}

function commonSendDto(config: DeploymentConfig) {
  const hostStateUnit = config.hostStateNFT.policyId + config.hostStateNFT.name;
  const packetMarkerUnit =
    config.validators.mintLifecyclePacketMarker.scriptHash +
    Buffer.from('ibc_lifecycle').toString('hex');
  const hostStateUtxo = {
    ...refUtxo('host-state-input', 0),
    datum: 'host-state-datum',
    assets: {
      lovelace: 8_000_000n,
      [hostStateUnit]: 1n,
      [packetMarkerUnit]: 2n,
      ['ff'.repeat(28) + '01']: 7n,
    },
  };
  const transferModuleReferenceUtxo = {
    ...refUtxo('transfer-module-input', 1),
    datum: 'transfer-module-datum',
  };

  return {
    hostStateUtxo,
    encodedHostStateRedeemer: 'host-redeemer',
    encodedUpdatedHostStateDatum: 'updated-host-datum',
    channelUTxO: refUtxo('channel-input', 2),
    encodedSpendChannelRedeemer: 'channel-redeemer',
    connectionUTxO: refUtxo('connection-input', 3),
    clientUTxO: refUtxo('client-input', 4),
    spendChannelAddress: 'addr_test1_channel',
    encodedUpdatedChannelDatum: 'updated-channel-datum',
    channelTokenUnit: 'a0'.repeat(28) + '01',
    sendPacketPolicyId: 'c0'.repeat(28),
    channelToken: { policyId: 'a0'.repeat(28), name: '01' },
    transferModuleReferenceUtxo,
    encodedSpendTransferModuleRedeemer: 'transfer-module-redeemer',
    encodedUpdatedTransferModuleDatum: 'updated-transfer-module-datum',
    transferAmount: 5n,
  };
}

function assertPacketReceipt(
  config: DeploymentConfig,
  recording: TxRecording,
  hostStateAssets: Record<string, bigint>,
) {
  const packetPolicyRef = config.validators.mintLifecyclePacketMarker.refUtxo;
  const packetMarkerUnit =
    config.validators.mintLifecyclePacketMarker.scriptHash +
    Buffer.from('ibc_lifecycle').toString('hex');
  const readRefs = recording.readFrom.flat();
  assert.ok(
    readRefs.some(
      (utxo) =>
        utxo.txHash === packetPolicyRef.txHash &&
        utxo.outputIndex === packetPolicyRef.outputIndex,
    ),
    'packet policy reference input was not read',
  );
  assert.deepEqual(
    recording.mints.filter((mint) => mint.redeemer === 'd87980'),
    [{ assets: { [packetMarkerUnit]: 1n }, redeemer: 'd87980' }],
  );

  const hostPayment = recording.payments.find(
    (payment) => payment.address === 'addr_test1_host',
  );
  assert.ok(hostPayment, 'HostState continuation output was not created');
  assert.deepEqual(hostPayment.assets, {
    ...hostStateAssets,
    [packetMarkerUnit]: (hostStateAssets[packetMarkerUnit] ?? 0n) + 1n,
  });
}

describe('packet lifecycle receipts', () => {
  it('reads and mints the packet policy for an escrow send', async () => {
    const { adapter, config, recording } = await adapterHarness();
    const dto = {
      ...commonSendDto(config),
      walletUtxos: [refUtxo('wallet', 5)],
      transferModuleAddress: 'addr_test1_transfer_module',
      transferEscrowUtxo: {
        ...refUtxo('escrow-input', 6),
        assets: {
          lovelace: 3_000_000n,
          ['d0'.repeat(28) + '01']: 10n,
        },
      },
      encodedTransferEscrowDatum: 'updated-escrow-datum',
      denomToken: 'd0'.repeat(28) + '01',
    };

    adapter.createUnsignedSendPacketEscrowTx(dto);

    assertPacketReceipt(config, recording, dto.hostStateUtxo.assets);
  });

  it('reads and mints the packet policy for a voucher burn send', async () => {
    const { adapter, config, recording } = await adapterHarness();
    const dto = {
      ...commonSendDto(config),
      senderVoucherTokenUtxo: refUtxo('voucher-input', 5),
      voucherTokenUnit: '20'.repeat(28) + '01',
      encodedMintVoucherRedeemer: 'voucher-redeemer',
    };

    adapter.createUnsignedSendPacketBurnTx(dto);

    assertPacketReceipt(config, recording, dto.hostStateUtxo.assets);
  });
});
