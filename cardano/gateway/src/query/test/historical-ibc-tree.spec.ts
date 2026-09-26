import * as Lucid from '@lucid-evolution/lucid';
import { Pool, PoolClient } from 'pg';
import { publicClientCommitmentValues } from '@cardano-ibc/tx-builder-runtime/plutusSerialise';
import { reconstructHistoricalIbcTree, HistoricalTreeDeployment } from '../services/historical-ibc-tree';
import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { StaleIbcTreeStateError, encodeConnectionEndValue, encodeChannelEndValue, encodeModuleRegistration } from '../../shared/helpers/ibc-state-root';
import { ClientDatum, encodeClientDatum, decodeClientDatum } from '../../shared/types/client-datum';
import { ConnectionDatum, encodeConnectionDatum, decodeConnectionDatum } from '../../shared/types/connection/connection-datum';
import { ChannelDatum, encodeChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { HostStateDatum, encodeHostStateDatum, decodeHostStateDatum } from '../../shared/types/host-state-datum';
import { ChannelState } from '../../shared/types/channel/state';
import { Order } from '../../shared/types/channel/order';
import { State } from '../../shared/types/connection/state';

const databaseUrl = process.env.BRIDGE_HISTORY_TEST_DATABASE_URL;
const hash = (n: number) => n.toString(16).padStart(64, '0');
const hex = (s: string) => Buffer.from(s).toString('hex');
const clientPolicy = '11'.repeat(28);
const connectionPolicy = '22'.repeat(28);
const channelPolicy = '33'.repeat(28);
const name = 'aa'.repeat(24) + hex('0');
const hostToken = { policyId: '44'.repeat(28), name: '01' };
const deployment: HistoricalTreeDeployment = {
  hostStateNFT: hostToken,
  validators: {
    mintClientStt: { scriptHash: clientPolicy }, mintConnectionStt: { scriptHash: connectionPolicy },
    mintChannelStt: { scriptHash: channelPolicy }, spendClient: { address: 'client-address' },
    spendConnection: { address: 'connection-address' }, spendChannel: { address: 'channel-address' },
  },
};
const registration = {
  module_script_hash: '55'.repeat(28),
  port_token: { policy_id: '66'.repeat(28), name: '01' },
  module_token: { policy_id: '77'.repeat(28), name: '02' },
};
const connection: ConnectionDatum = {
  token: { policyId: connectionPolicy, name },
  state: {
    client_id: hex('07-tendermint-0'), state: State.Open, delay_period: 0n,
    versions: [{ identifier: hex('1'), features: [hex('ORDER_UNORDERED')] }],
    counterparty: { client_id: hex('07-tendermint-1'), connection_id: hex('connection-1'), prefix: { key_prefix: hex('ibc') } },
  },
};
function channel(n: number): ChannelDatum {
  return {
    token: { policyId: channelPolicy, name }, port: hex('transfer'),
    state: {
      channel: { state: ChannelState.Open, ordering: Order.Unordered, counterparty: { port_id: hex('transfer'), channel_id: hex('channel-1') }, connection_hops: [hex('connection-0')], version: hex('ics20-1') },
      next_sequence_send: BigInt(n + 1), next_sequence_recv: 1n, next_sequence_ack: 1n,
      packet_commitment: new Map([[BigInt(n), 'aabb']]),
      packet_receipt: new Map([[BigInt(n), '']]), packet_acknowledgement: new Map([[BigInt(n), 'ccdd']]),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: BigInt(n) },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: BigInt(n) },
    },
  };
}
function client(n: number): ClientDatum {
  const height = { revisionNumber: 0n, revisionHeight: BigInt(n) };
  return {
    token: { policyId: clientPolicy, name }, history_root: hash(n - 1),
    state: {
      clientState: {
        chainId: hex('chain-0'), trustLevel: { numerator: 1n, denominator: 3n }, trustingPeriod: 100n,
        unbondingPeriod: 200n, maxClockDrift: 1n, frozenHeight: { revisionNumber: 0n, revisionHeight: 0n }, latestHeight: height, proofSpecs: [],
      },
      consensusStates: new Map([[height, { timestamp: BigInt(100 + n), next_validators_hash: hash(11), root: { hash: hash(12) } }]]),
      processedTimes: new Map([[height, BigInt(200 + n)]]), processedHeights: new Map([[height, BigInt(n)]]),
    },
  };
}
const decoder = {
  LucidImporter: Lucid,
  async decodeDatum<T>(datum: string, type: string): Promise<T> {
    const decode = { host_state: decodeHostStateDatum, client: decodeClientDatum, connection: decodeConnectionDatum, channel: decodeChannelDatum }[type];
    if (!decode) throw new Error(`Unexpected datum type ${type}`);
    return await decode(datum, Lucid) as T;
  },
};

async function expectedTree(n: number) {
  const tree = new ICS23MerkleTree();
  tree.set('ports/transfer', Buffer.from(await encodeModuleRegistration(registration, Lucid), 'hex'));
  const current = publicClientCommitmentValues(await encodeClientDatum(client(n), Lucid));
  tree.set('clients/07-tendermint-0/clientState', Buffer.from(current.clientValue, 'hex'));
  for (let h = 1; h <= n; h++) {
    tree.set(`clients/07-tendermint-0/consensusStates/0-${h}`, Buffer.from(publicClientCommitmentValues(await encodeClientDatum(client(h), Lucid)).consensusValue, 'hex'));
  }
  tree.set('connections/connection-0', Buffer.from(await encodeConnectionEndValue(connection.state, Lucid), 'hex'));
  const state = channel(n).state;
  tree.set('channelEnds/ports/transfer/channels/channel-0', Buffer.from(await encodeChannelEndValue(state.channel, Lucid), 'hex'));
  for (const [key, value] of [['nextSequenceSend', state.next_sequence_send], ['nextSequenceRecv', state.next_sequence_recv], ['nextSequenceAck', state.next_sequence_ack]] as const) {
    tree.set(`${key}/ports/transfer/channels/channel-0`, Buffer.from(Lucid.Data.to(value), 'hex'));
  }
  for (const [key, values] of [['commitments', state.packet_commitment], ['receipts', state.packet_receipt], ['acks', state.packet_acknowledgement]] as const) {
    for (const [sequence, value] of values) tree.set(`${key}/ports/transfer/channels/channel-0/sequences/${sequence}`, Buffer.from(Lucid.Data.to(value), 'hex'));
  }
  return tree;
}

// Raw Yaci row fixtures test historical selection/reconstruction, not ledger
// validation. Production datum encoders and the real PostgreSQL SQL are used.
(databaseUrl ? describe : describe.skip)('historical IBC tree reconstruction from PostgreSQL', () => {
  let pool: Pool;
  let db: PoolClient;
  let roots: string[];
  const sql = { query: async (text: string, values?: unknown[]) => (await db.query(text, values)).rows };
  const tx = async (id: number, block: number, index = 0, invalid = false, blockHash = hash(block)) => {
    await db.query('INSERT INTO transaction VALUES ($1, $2, $3, $4, $5)', [hash(id), block, blockHash, index, invalid]);
  };
  const put = async (id: number, index: number, block: number, address: string, unit: string, datum: string) => {
    await db.query('INSERT INTO address_utxo VALUES ($1,$2,$3,$4,NULL,$5,$6)', [hash(id), index, block, address, datum, JSON.stringify([{ unit, quantity: '1' }])]);
  };
  const spend = async (id: number, index: number, consuming: number, block: number) => {
    await db.query('INSERT INTO tx_input VALUES ($1,$2,$3,$4,$5)', [hash(id), index, hash(consuming), block, hash(block)]);
  };
  const hostDatum = async (n: number) => encodeHostStateDatum({
    state: { ibc_state_root: roots[n - 1], version: BigInt(n), next_client_sequence: 1n, next_connection_sequence: 1n, next_channel_sequence: 1n, bound_port: [], last_update_time: 0n },
    nft_policy: hostToken.policyId, deployer: '99'.repeat(28), control: { port_registry: new Map([[hex('transfer'), registration]]), shutdown: 'Active', live_clients: 0n, live_connections: 0n, live_channels: 0n },
  } as HostStateDatum, Lucid);
  const rebuild = (height = 2n, id = 30) => reconstructHistoricalIbcTree(sql, deployment, 'Custom', decoder, height, { txHash: hash(id), outputIndex: 3 });

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    roots = await Promise.all([1, 2, 3].map(async (n) => (await expectedTree(n)).getRoot()));
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query('CREATE SCHEMA historical_ibc_tree_test');
    await db.query('SET LOCAL search_path TO historical_ibc_tree_test');
    await db.query(`
      CREATE TABLE block(number bigint PRIMARY KEY, hash text);
      CREATE TABLE transaction(tx_hash text PRIMARY KEY, block bigint, block_hash text, tx_index integer, invalid boolean);
      CREATE TABLE address_utxo(tx_hash text, output_index smallint, block bigint, owner_addr text, owner_addr_full text, inline_datum text, amounts jsonb, PRIMARY KEY(output_index, tx_hash));
      CREATE TABLE tx_input(tx_hash text, output_index smallint, spent_tx_hash text, spent_at_block bigint, spent_at_block_hash text, PRIMARY KEY(output_index, tx_hash));
    `);
    for (const n of [1, 2, 3]) await db.query('INSERT INTO block VALUES ($1,$2)', [n, hash(n)]);
    await tx(10, 1);
    await put(10, 0, 1, 'client-address', clientPolicy + name, await encodeClientDatum(client(1), Lucid));
    await put(10, 1, 1, 'connection-address', connectionPolicy + name, await encodeConnectionDatum(connection, Lucid));
    await put(10, 2, 1, 'channel-address', channelPolicy + name, await encodeChannelDatum(channel(1), Lucid));
    await put(10, 3, 1, 'host-address', hostToken.policyId + hostToken.name, await hostDatum(1));
    await tx(20, 2);
    await tx(30, 2, 1);
    for (const index of [0, 2, 3]) await spend(10, index, 20, 2);
    await put(20, 0, 2, 'client-address', clientPolicy + name, await encodeClientDatum(client(2), Lucid));
    await put(20, 2, 2, 'channel-address', channelPolicy + name, await encodeChannelDatum(channel(99), Lucid));
    await put(20, 3, 2, 'host-address', hostToken.policyId + hostToken.name, await hostDatum(1));
    for (const index of [2, 3]) await spend(20, index, 30, 2);
    await put(30, 2, 2, 'channel-address', channelPolicy + name, await encodeChannelDatum(channel(2), Lucid));
    await put(30, 3, 2, 'host-address', hostToken.policyId + hostToken.name, await hostDatum(2));
    await tx(40, 3);
    await spend(20, 0, 40, 3);
    for (const index of [2, 3]) await spend(30, index, 40, 3);
    await put(40, 0, 3, 'client-address', clientPolicy + name, await encodeClientDatum(client(3), Lucid));
    await put(40, 2, 3, 'channel-address', channelPolicy + name, await encodeChannelDatum(channel(3), Lucid));
    await put(40, 3, 3, 'host-address', hostToken.policyId + hostToken.name, await hostDatum(3));
  });
  afterEach(async () => { await db.query('ROLLBACK'); db.release(); });

  it('rebuilds older public roots from spent outputs, including consensus history and packet pruning', async () => {
    for (const [height, id] of [[1, 10], [2, 30], [3, 40]]) {
      const result = await rebuild(BigInt(height), id);
      expect(result.root).toBe(roots[height - 1]);
      expect(result.tree.verifyProof(result.tree.generateProof(`acks/ports/transfer/channels/channel-0/sequences/${height}`))).toBe(true);
      expect(result.tree.get(`clients/07-tendermint-0/consensusStates/0-${height + 1}`)).toBeUndefined();
      expect(result.tree.get('clients/07-tendermint-0/consensusStates/0-1')).toBeDefined();
    }
    const old = await rebuild();
    expect(old.tree.get('acks/ports/transfer/channels/channel-0/sequences/1')).toBeUndefined();
    expect(old.tree.get('acks/ports/transfer/channels/channel-0/sequences/99')).toBeUndefined();
  });

  it('excludes failed and orphaned outputs and does not count their inputs as spent', async () => {
    await tx(50, 2, 2, true);
    await put(50, 0, 2, 'client-address', clientPolicy + name, '00');
    await spend(10, 1, 50, 2);
    await tx(60, 2, 3, false, hash(999));
    await put(60, 0, 2, 'client-address', clientPolicy + name, '00');
    expect((await rebuild()).root).toBe(roots[1]);
  });

  it.each(['old checkpoint', 'live channel', 'datum', 'spend record'])('fails closed on missing %s', async (missing) => {
    if (missing === 'old checkpoint') await db.query('DELETE FROM address_utxo WHERE tx_hash=$1 AND output_index=0', [hash(10)]);
    if (missing === 'live channel') await db.query('DELETE FROM address_utxo WHERE tx_hash=$1 AND output_index=2', [hash(30)]);
    if (missing === 'datum') await db.query('UPDATE address_utxo SET inline_datum=NULL WHERE tx_hash=$1 AND output_index=0', [hash(20)]);
    if (missing === 'spend record') await db.query('DELETE FROM tx_input WHERE tx_hash=$1 AND output_index=0', [hash(10)]);
    await expect(rebuild()).rejects.toThrow(/Tree rebuild failed|Historical IBC tree unavailable/);
  });

  it('rejects a mismatched HostState reference and an unindexed block', async () => {
    await expect(rebuild(2n, 10)).rejects.toThrow(StaleIbcTreeStateError);
    await expect(rebuild(4n, 40)).rejects.toThrow('requested canonical block is not indexed');
  });

  it('rejects an output carrying a non-unit state token', async () => {
    await db.query('UPDATE address_utxo SET amounts=$1 WHERE tx_hash=$2 AND output_index=2', [JSON.stringify([{ unit: channelPolicy + name, quantity: '2' }]), hash(30)]);
    await expect(rebuild()).rejects.toThrow('non-unit state authentication token');
  });

  it('pages through more than 500 retained checkpoints without including future state', async () => {
    await db.query('DELETE FROM tx_input WHERE tx_hash=$1 AND output_index=0', [hash(20)]);
    let previous = 20;
    for (let n = 0; n < 501; n++) {
      const id = 1000 + n;
      await tx(id, 2, 10 + n);
      await spend(previous, 0, id, 2);
      await put(id, 0, 2, 'client-address', clientPolicy + name, await encodeClientDatum(client(2), Lucid));
      previous = id;
    }
    await spend(previous, 0, 40, 3);
    expect((await rebuild()).root).toBe(roots[1]);
  }, 30_000);
});
