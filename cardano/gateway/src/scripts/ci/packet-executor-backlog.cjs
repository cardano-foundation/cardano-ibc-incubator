// Runs production Gateway selection/completion against an isolated fixture provider.
const assert = require('node:assert/strict');
const path = require('node:path');
require('tsconfig-paths').register({
  baseUrl: path.resolve('dist'),
  paths: {
    'src/*': ['*'],
    '~@/*': ['*'],
    '@shared/*': ['shared/*'],
    '@utils/*': ['utils/*'],
    '@config/*': ['config/*'],
  },
});
const { PacketLaneService } = require('../../../dist/tx/packet-lane.service.js');
const { TxOperationRunnerService } = require('../../../dist/tx/tx-operation-runner.service.js');
const { WalletContextService } = require('../../../dist/tx/wallet-context.service.js');
const { MerkleProof } = require('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment');
const lib = require('@lucid-evolution/lucid');
const encode = (v) =>
  JSON.stringify(v, (_, value) => (typeof value === 'bigint' ? { bigint: value.toString() } : value));
const decode = (s) =>
  JSON.parse(s, (_, value) => (value && typeof value.bigint === 'string' ? BigInt(value.bigint) : value));
const url = process.argv[2];
async function rpc(method, ...args) {
  const response = await fetch(url, { method: 'POST', body: encode({ method, args }) });
  const data = decode(await response.text());
  if (data.error) throw new Error(data.error);
  return data.result;
}
async function main() {
  const fixture = await rpc('fixture');
  const provider = Object.fromEntries(
    [
      'getProtocolParameters',
      'getUtxos',
      'getUtxosWithUnit',
      'getUtxoByUnit',
      'getUtxosByOutRef',
      'getDatum',
      'getDelegation',
      'evaluateTx',
      'awaitTx',
      'submitTx',
    ].map((method) => [method, (...args) => rpc(method, ...args)]),
  );
  let evaluations = 0;
  const evaluate = provider.evaluateTx;
  provider.evaluateTx = (...args) => {
    evaluations++;
    return evaluate(...args);
  };
  const readParameters = provider.getProtocolParameters;
  provider.getProtocolParameters = async () => {
    const parameters = await readParameters();
    for (const key of [
      'coinsPerUtxoByte',
      'keyDeposit',
      'poolDeposit',
      'maxTxExMem',
      'maxTxExSteps',
      'drepDeposit',
      'govActionDeposit',
    ]) {
      if (parameters[key] !== undefined) parameters[key] = BigInt(parameters[key]);
    }
    return parameters;
  };
  const lucid = await lib.Lucid(provider, 'Custom', { slotConfig: fixture.clock });
  lib.SLOT_CONFIG_NETWORK.Custom = fixture.clock;
  const wrapper = {
    lucid,
    LucidImporter: lib,
    beginWalletSelectionScope: () => 1,
    endWalletSelectionScope: () => {},
    assertWalletSelectionScopeSatisfied: () => {},
    selectWalletFromAddress: (address, utxos) => lucid.selectWallet.fromAddress(address, utxos),
    tryFindUtxosAt: (address) => lucid.utxosAt(address),
    resolveClientAtHeights: async () => ({ clientUtxo: fixture.deployment.client, historyWitnesses: [] }),
  };
  const wallet = new WalletContextService({ log() {} }, wrapper);
  const runner = new TxOperationRunnerService(wrapper, wallet, { register() {} }, { register() {} });
  const config = {
    getOrThrow: (key) => {
      if (key === 'cardanoNetwork') return 'Custom';
      if (key === 'ogmiosEndpoint') return url;
      throw new Error(`Unexpected config: ${key}`);
    },
  };
  const service = new PacketLaneService(
    config,
    wrapper,
    runner,
    {},
    {},
    { findIntentSpendingTransaction: async () => null },
  );
  // Fixture state is already initialized and authenticated by the real validators.
  service.deployment = async () => fixture.deployment;
  service.initialize = async () => undefined;
  const request = { signer: fixture.signer, port_id: 'transfer', channel_id: 'channel-0', intent_tx_hash: '' };
  const abandoned = await service.batch(request);
  assert.equal(abandoned.stage, 'send');
  if (process.env.GATEWAY_BATCH_RESPONSE_FIXTURE_PATH) {
    const { writeFileSync } = require('node:fs');
    const { BuildPacketBatchResponse } = require('@cardano-ibc/proto-types/build/ibc/cardano/v1/tx');
    const cbor = Buffer.from(abandoned.unsigned_tx.value).toString('utf8');
    const tx = lib.CML.Transaction.from_cbor_hex(cbor);
    writeFileSync(
      process.env.GATEWAY_BATCH_RESPONSE_FIXTURE_PATH,
      JSON.stringify(
        {
          response_hex: Buffer.from(
            BuildPacketBatchResponse.encode(BuildPacketBatchResponse.fromPartial(abandoned)).finish(),
          ).toString('hex'),
          transaction_hex: cbor,
          body_hash: lib.CML.hash_transaction(tx.body()).to_hex(),
        },
        null,
        2,
      ) + '\n',
    );
  }
  const abandonedBody = lib.CML.Transaction.from_cbor_hex(Buffer.from(abandoned.unsigned_tx.value).toString()).body();
  const clientBefore = fixture.deployment.client;
  const refs = abandonedBody.reference_inputs();
  assert(
    Array.from({ length: refs.len() }, (_, i) => refs.get(i).transaction_id().to_hex()).includes(clientBefore.txHash),
  );
  fixture.deployment.client = await rpc('replaceClientReference');
  // The ordinary inputs are untouched and the two-minute validity window has
  // not expired. Only disappearance of the reference can release this lease.
  assert(
    (await lucid.utxosByOutRef([{ txHash: clientBefore.txHash, outputIndex: clientBefore.outputIndex }])).length === 0,
  );
  const packets = [];
  const batches = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await service.batch(request);
    if (response.stage === 'idle') break;
    assert.equal(response.stage, 'send');
    assert(
      response.intent_tx_hashes.every((hash) => fixture.validHashes.includes(hash)),
      'selected unusable request',
    );
    const cbor = Buffer.from(response.unsigned_tx.value).toString();
    const redeemers = lib.CML.Transaction.from_cbor_hex(cbor).witness_set().redeemers().to_flat_format();
    for (let i = 0; i < redeemers.len(); i++) {
      const entry = redeemers.get(i);
      const data = lib.Data.from(entry.data().to_cbor_hex());
      if (entry.tag() === lib.CML.RedeemerTag.Mint && data.fields?.length === 3 && data.fields[1]?.index === 0)
        packets.push(...data.fields[1].fields[2]);
    }
    await rpc('signSubmit', cbor);
    batches.push(response.intent_tx_hashes.length);
  }
  assert.equal(packets.length, fixture.validHashes.length, 'valid backlog did not drain');
  const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
  const ackRequest = (packet) => {
    const proof = lib.Data.from(fixture.proofs[packet.fields[0].toString()]);
    const proofs = proof.fields[0].map((layer) => {
      const e = layer.fields[0].fields[0].fields;
      const leaf = e[2].fields;
      return {
        exist: {
          key: bytes(e[0]),
          value: bytes(e[1]),
          leaf: {
            hash: Number(leaf[0]),
            prehash_key: Number(leaf[1]),
            prehash_value: Number(leaf[2]),
            length: Number(leaf[3]),
            prefix: bytes(leaf[4]),
          },
          path: e[3].map((inner) => ({
            hash: Number(inner.fields[0]),
            prefix: bytes(inner.fields[1]),
            suffix: bytes(inner.fields[2]),
          })),
        },
      };
    });
    const f = packet.fields;
    return {
      signer: fixture.signer,
      packet: {
        sequence: f[0],
        source_port: lib.toText(f[1]),
        source_channel: lib.toText(f[2]),
        destination_port: lib.toText(f[3]),
        destination_channel: lib.toText(f[4]),
        data: bytes(f[5]),
        timeout_height: { revision_number: f[6].fields[0], revision_height: f[6].fields[1] },
        timeout_timestamp: f[7],
      },
      proof_height: { revision_number: 1n, revision_height: 18n },
      proof_acked: MerkleProof.encode({ proofs }).finish(),
      acknowledgement: bytes(lib.fromText('{"result":"AQ=="}')),
    };
  };
  const [first, second] = await Promise.all([
    service.settle(ackRequest(packets[0]), 'acknowledge'),
    service.settle(ackRequest(packets[1]), 'acknowledge'),
  ]);
  const beforeDuplicate = evaluations;
  await assert.rejects(() => service.settle(ackRequest(packets[0]), 'acknowledge'), /reserved/);
  assert.equal(evaluations, beforeDuplicate, 'duplicate lane reached script evaluation');
  const inputs = (response) => {
    const list = lib.CML.Transaction.from_cbor_hex(Buffer.from(response.unsigned_tx.value).toString()).body().inputs();
    return Array.from(
      { length: list.len() },
      (_, i) => `${list.get(i).transaction_id().to_hex()}#${list.get(i).index()}`,
    );
  };
  assert(
    inputs(first).every((ref) => !inputs(second).includes(ref)),
    'concurrent acknowledgements share spending inputs',
  );
  await rpc('signSubmit', Buffer.from(first.unsigned_tx.value).toString());
  await rpc('signSubmit', Buffer.from(second.unsigned_tx.value).toString());
  for (const packet of packets.slice(2)) {
    const response = await service.settle(ackRequest(packet), 'acknowledge');
    await rpc('signSubmit', Buffer.from(response.unsigned_tx.value).toString());
  }
  console.log(
    JSON.stringify({
      validRequests: packets.length,
      unusableRequests: fixture.invalidCount,
      batches,
      allSentBeforeAcknowledgements: true,
      sharedWalletAcknowledgementsHaveDisjointInputs: true,
      sameLaneDeferredBeforeEvaluation: true,
      rebuiltAfterReferenceConsumption: true,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
