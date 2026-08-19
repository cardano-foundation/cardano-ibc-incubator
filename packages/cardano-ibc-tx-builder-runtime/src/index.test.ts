import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncMutex } from './asyncMutex';
import {
  decodeAcknowledgement,
  encodeAcknowledgement,
  type Acknowledgement,
} from './acknowledgementCodec';
import { LucidIbcAdapter } from './lucidIbcAdapter';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const TestLucid = {
  Data: {
    Bytes: () => 'bytes',
    Object: (schema: unknown) => schema,
    Enum: (schema: unknown) => schema,
    to: (value: unknown) => JSON.stringify(value),
    from: (encoded: string) => JSON.parse(encoded),
  },
} as unknown as typeof import('@lucid-evolution/lucid');

describe('tx-builder runtime serialization', () => {
  it('runs queued operations one at a time in submission order', async () => {
    const mutex = new AsyncMutex();
    const firstCanFinish = deferred();
    const firstStarted = deferred();
    const order: string[] = [];

    const first = mutex.runExclusive(async () => {
      order.push('first:start');
      firstStarted.resolve();
      await firstCanFinish.promise;
      order.push('first:end');
      return 'first';
    });
    const second = mutex.runExclusive(async () => {
      order.push('second:start');
      order.push('second:end');
      return 'second';
    });
    const third = mutex.runExclusive(async () => {
      order.push('third:start');
      order.push('third:end');
      return 'third';
    });

    await firstStarted.promise;
    await Promise.resolve();
    assert.deepEqual(order, ['first:start']);

    firstCanFinish.resolve();
    assert.deepEqual(await Promise.all([first, second, third]), [
      'first',
      'second',
      'third',
    ]);
    assert.deepEqual(order, [
      'first:start',
      'first:end',
      'second:start',
      'second:end',
      'third:start',
      'third:end',
    ]);
  });
});

describe('acknowledgement codec', () => {
  it('round-trips acknowledgement result and error responses', () => {
    const success: Acknowledgement = {
      response: {
        AcknowledgementResult: {
          result: Buffer.from('ok').toString('hex'),
        },
      },
    };
    const failure: Acknowledgement = {
      response: {
        AcknowledgementError: {
          err: Buffer.from('insufficient funds').toString('hex'),
        },
      },
    };

    assert.deepEqual(
      decodeAcknowledgement(
        encodeAcknowledgement(success, TestLucid),
        TestLucid,
      ),
      success,
    );
    assert.deepEqual(
      decodeAcknowledgement(
        encodeAcknowledgement(failure, TestLucid),
        TestLucid,
      ),
      failure,
    );
  });
});

describe('escrow shard creation', () => {
  it('consumes and recreates the transfer state used as the NFT nonce', () => {
    const readFromCalls: unknown[][] = [];
    const collectFromCalls: Array<[unknown[], string | undefined]> = [];
    const payToContractCalls: Array<[
      string,
      unknown,
      Record<string, bigint>,
    ]> = [];
    const tx: any = {
      readFrom(utxos: unknown[]) {
        readFromCalls.push(utxos);
        return tx;
      },
      collectFrom(utxos: unknown[], redeemer?: string) {
        collectFromCalls.push([utxos, redeemer]);
        return tx;
      },
      mintAssets() {
        return tx;
      },
      pay: {
        ToContract(
          address: string,
          datum: unknown,
          assets: Record<string, bigint>,
        ) {
          payToContractCalls.push([address, datum, assets]);
          return tx;
        },
      },
    };
    const transferState = {
      txHash: 'aa'.repeat(32),
      outputIndex: 0,
      address: 'addr_transfer',
      assets: { module: 1n, lovelace: 2_000_000n },
    };
    const deployment: any = {
      hostStateNFT: { policyId: 'host-policy', name: 'host-name' },
      validators: {
        hostStateStt: { address: 'addr_host' },
      },
      modules: { transfer: { address: 'addr_transfer' } },
    };
    const adapter = new LucidIbcAdapter(
      TestLucid,
      { newTx: () => tx } as any,
      deployment,
    );
    (adapter as any).referenceScripts = {
      spendChannel: { ref: 'spend-channel' },
      spendTransferModule: { ref: 'spend-transfer' },
      mintTransferEscrowShard: { ref: 'mint-shard' },
      sendPacket: { ref: 'send-packet' },
      hostStateStt: { ref: 'host-state' },
    };

    adapter.createUnsignedSendPacketEscrowTx({
      hostStateUtxo: { txHash: 'host', outputIndex: 0, assets: {} },
      channelUTxO: { txHash: 'channel', outputIndex: 0, assets: {} },
      connectionUTxO: { txHash: 'connection', outputIndex: 0, assets: {} },
      clientUTxO: { txHash: 'client', outputIndex: 0, assets: {} },
      transferModuleReferenceUtxo: transferState,
      encodedHostStateRedeemer: 'host-redeemer',
      encodedSpendChannelRedeemer: 'channel-redeemer',
      encodedSpendTransferModuleRedeemer: 'module-redeemer',
      encodedMintTransferEscrowShardRedeemer: 'mint-shard-redeemer',
      encodedUpdatedHostStateDatum: 'updated-host-datum',
      encodedUpdatedChannelDatum: 'updated-channel-datum',
      encodedTransferEscrowDatum: 'escrow-datum',
      spendChannelAddress: 'addr_channel',
      transferModuleAddress: 'addr_transfer',
      channelTokenUnit: 'channel-token',
      channelToken: { policyId: 'channel-policy', name: 'channel-name' },
      sendPacketPolicyId: 'send-policy',
      transferEscrowShardTokenUnit: 'shard-policy' + '11'.repeat(28),
      denomToken: 'lovelace',
      transferAmount: 10n,
      walletUtxos: [{ txHash: 'wallet', outputIndex: 0, assets: {} }],
    });

    assert.ok(
      collectFromCalls.some(
        ([utxos, redeemer]) =>
          utxos[0] === transferState && redeemer === 'module-redeemer',
      ),
    );
    assert.ok(
      payToContractCalls.some(
        ([address, datum, assets]) =>
          address === 'addr_transfer' &&
          datum === undefined &&
          assets === transferState.assets,
      ),
    );
    assert.equal(
      readFromCalls.some((utxos) => utxos.includes(transferState)),
      false,
    );
  });
});
