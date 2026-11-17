const assert = require('node:assert/strict');
const { runtime, rpc, chainResponse } = require('./tendermint-cache.cjs');
const lib = require('@lucid-evolution/lucid');
const { ConnectionService } = require('../../../dist/tx/connection.service');
const { ChannelService } = require('../../../dist/tx/channel.service');
const { PacketLaneService } = require('../../../dist/tx/packet-lane.service');
const { ConnectionEnd } = require('@cardano-ibc/proto-types/build/ibc/core/connection/v1/connection');
const { Channel } = require('@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel');
const {
  ClientState,
  ConsensusState,
  Header,
} = require('@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint');
const { MerkleProof } = require('@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment');
const { clientDatumMockBuilder } = require('../../../dist/tx/test/mock/client-datum');
const bytes = (hex) => Buffer.from(hex, 'hex');
function proofBytes(hex) {
  const proof = lib.Data.from(hex);
  return MerkleProof.encode({
    proofs: proof.fields[0].map((layer) => {
      const e = layer.fields[0].fields[0].fields,
        leaf = e[2].fields;
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
          path: e[3].map((p) => ({
            hash: Number(p.fields[0]),
            prefix: bytes(p.fields[1]),
            suffix: bytes(p.fields[2]),
          })),
        },
      };
    }),
  }).finish();
}
async function main() {
  const mode = process.argv[3];
  if (mode === 'prepare') {
    const connection = ConnectionEnd.fromPartial({
      client_id: '08-cardano-probabilistic-0',
      versions: [{ identifier: '1', features: ['ORDER_ORDERED', 'ORDER_UNORDERED'] }],
      state: 2,
      counterparty: {
        client_id: '07-tendermint-0',
        connection_id: 'connection-0',
        prefix: { key_prefix: Buffer.from('ibc') },
      },
      delay_period: 0n,
    });
    const channel = Channel.fromPartial({
      state: 2,
      ordering: 1,
      counterparty: { port_id: 'transfer', channel_id: 'channel-0' },
      connection_hops: ['connection-2'],
      version: 'ics20-1',
    });
    await rpc(
      'checkpoint',
      Buffer.from(ConnectionEnd.encode(connection).finish()).toString('hex'),
      Buffer.from(Channel.encode(channel).finish()).toString('hex'),
    );
  }
  const fixture = await rpc('fixture');
  const r = await runtime(fixture, true);
  const submit = async (response) => {
    const chain = chainResponse(response);
    assert(!chain.rebuild, 'fixture transaction unexpectedly requires rebuilding');
    for (const cbor of chain.transactions) await rpc('signSubmit', cbor);
  };
  if (mode === 'update') {
    await submit(
      await r.service.updateClient({
        client_id: '07-tendermint-0',
        signer: r.signer,
        client_message: {
          type_url: '/ibc.lightclients.tendermint.v1.Header',
          value: Header.encode(Header.fromJSON(fixture.scenarios[0].headers[0])).finish(),
        },
      }),
    );
  } else {
    const state = clientDatumMockBuilder.build().state.clientState;
    Object.assign(state, {
      chainId: Buffer.from('cache-test-1').toString('hex'),
      latestHeight: { revisionNumber: 1n, revisionHeight: 9n },
      frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
      trustingPeriod: 1_209_600_000_000_000n,
      unbondingPeriod: 1_814_400_000_000_000n,
      maxClockDrift: 30_000_000_000n,
    });
    const timestamp = BigInt(fixture.scenarios[0].trusted_time);
    const request = {
      signer: r.signer,
      client_state: { type_url: '/ibc.lightclients.tendermint.v1.ClientState', value: new Uint8Array() },
      consensus_state: {
        type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
        value: ConsensusState.encode({
          timestamp: { seconds: timestamp / 1_000_000_000n, nanos: Number(timestamp % 1_000_000_000n) },
          root: { hash: bytes(fixture.checkpoint.root) },
          next_validators_hash: bytes(fixture.scenarios[0].trusted_root),
        }).finish(),
      },
    };
    // Use the same conversion as the cached-client integration check.
    const { normalizeClientStateFromDatum } = require('../../../dist/shared/helpers/client-state');
    request.client_state.value = ClientState.encode(normalizeClientStateFromDatum(state)).finish();
    const created = await r.service.createClient(request);
    assert.equal(created.client_id, '07-tendermint-0');
    await submit(created);
    const connection = new ConnectionService(r.logger, r.config, r.lucidService, r.runner, r.tree);
    const channel = new ChannelService(r.logger, r.config, r.lucidService, r.runner, r.tree);
    const validity = r.service.computeTxValidityWindow.bind(r.service);
    connection.computeTxValidityWindow = validity;
    channel.computeTxValidityWindow = validity;
    await submit(
      await connection.connectionOpenInit({
        signer: r.signer,
        client_id: created.client_id,
        counterparty: {
          client_id: '08-cardano-probabilistic-0',
          connection_id: '',
          prefix: { key_prefix: Buffer.from('ibc') },
        },
        delay_period: 0n,
      }),
    );
    await submit(
      await connection.connectionOpenAck({
        signer: r.signer,
        connection_id: 'connection-0',
        counterparty_connection_id: 'connection-2',
        client_state: { type_url: '/ibc.lightclients.probabilistic.v1.ClientState', value: new Uint8Array() },
        proof_try: proofBytes(fixture.checkpoint.proofs['connections/connection-2']),
        proof_client: MerkleProof.encode({ proofs: [] }).finish(),
        proof_height: { revision_number: 1n, revision_height: 9n },
      }),
    );
    await submit(
      await channel.channelOpenInit({
        signer: r.signer,
        port_id: 'transfer',
        channel: Channel.fromPartial({
          state: 1,
          ordering: 1,
          counterparty: { port_id: 'transfer', channel_id: '' },
          connection_hops: ['connection-0'],
          version: 'ics20-1',
        }),
      }),
    );
    await submit(
      await channel.channelOpenAck({
        signer: r.signer,
        port_id: 'transfer',
        channel_id: 'channel-0',
        counterparty_channel_id: 'channel-7',
        counterparty_version: 'ics20-1',
        proof_try: proofBytes(fixture.checkpoint.proofs['channelEnds/ports/transfer/channels/channel-7']),
        proof_height: { revision_number: 1n, revision_height: 9n },
      }),
    );
  }
  const packets = new PacketLaneService(r.config, r.lucidService, r.runner, {}, {}, {});
  if (mode === 'prepare') {
    const initialized = await packets.initialize({ signer: r.signer, channel_id: 'channel-0' });
    assert(initialized);
    await submit({ unsigned_tx: initialized });
  }
  const deployment = await packets.deployment('channel-0');
  const m = fixture.deployment;
  deployment.scripts.push(
    ...(await r.lucidService.lucid.utxosByOutRef([
      m.packetState.state.refUtxo,
      m.packetState.batch.refUtxo,
      m.packetState.guard.refUtxo,
      m.validators.mintVoucher.refUtxo,
    ])),
  );
  await rpc('packetDeployment', deployment);
  process.stdout.write(JSON.stringify({ passed: true, mode }) + '\n');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
