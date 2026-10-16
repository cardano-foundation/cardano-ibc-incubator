import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { bech32 } from 'bech32';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Cbor, CborArray, CborBytes, CborUInt } from '@harmoniclabs/cbor';
import {
  ClientState,
  ConsensusState,
  ProbabilisticHeader,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';
import { QueryNewClientRequest, QueryNewClientResponse } from '@cardano-ibc/proto-types/ibc/core/client/v1/query';
import { QueryService } from '../services/query.service';
import { queryPraosNoncesAtPoint } from '../../shared/helpers/ogmios';

jest.mock('../../shared/helpers/ogmios', () => ({
  ...jest.requireActual('../../shared/helpers/ogmios'),
  queryPraosNoncesAtPoint: jest.fn(),
}));

let directory: string;
const originalEnvironment = process.env;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cardano-initialization-'));
  process.env = { ...originalEnvironment, CONSENSUS_HISTORY_CACHE_DIR: directory };
});
afterEach(() => {
  process.env = originalEnvironment;
  rmSync(directory, { recursive: true, force: true });
});

// A local Mithril network certifies each test's initial stake table, because
// a client starts only from Mithril-certified stake.
let aggregatorBinary: string;
const aggregators: ChildProcess[] = [];
beforeAll(() => {
  aggregatorBinary = join(mkdtempSync(join(tmpdir(), 'mithril-test-aggregator-')), 'aggregator');
  const result = spawnSync('go', ['build', '-o', aggregatorBinary, './mithril/mithriltest/cmd/aggregator'], {
    cwd: resolve(__dirname, '../../../../../cosmos/cardano-probabilistic-light-client-core'),
    env: { ...process.env, GOWORK: 'off', CGO_ENABLED: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Building the test Mithril aggregator failed: ${result.stderr}`);
}, 300_000);
afterEach(() => aggregators.splice(0).forEach((child) => child.kill()));

function localAggregator(epoch: bigint, table: { pool_id: string; stake: bigint }[]): Promise<string> {
  const child = spawn(aggregatorBinary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  aggregators.push(child);
  const distribution = table.map((row) => `${JSON.stringify(row.pool_id)}:${row.stake.toString()}`).join(',');
  child.stdin!.end(`{"epoch":${epoch.toString()},"stake_distribution":{${distribution}}}`);
  return new Promise((accept, reject) => {
    child.stdout!.once('data', (data) => accept(String(data).trim()));
    child.once('exit', (code) => reject(new Error(`The test Mithril aggregator exited with ${code}`)));
  });
}

async function setup(network = 'Preview', stakeRows = 13, mithril = true) {
  const raw = JSON.parse(
    gunzipSync(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/native-boundary-control.json.gz',
        ),
      ),
    ).toString(),
  );
  for (const field of ['trusting_period', 'max_clock_drift'])
    raw.client[field] = { seconds: String(BigInt(raw.client[field]) / 1_000_000_000n), nanos: 0 };
  const client = ClientState.fromJSON(raw.client);
  const consensus = ConsensusState.fromJSON(raw.consensus);
  for (let index = client.epoch_stake_distribution.length; index < stakeRows; index++) {
    const key = createHash('sha256').update(`initial-pool-${index}`).digest();
    const binding = { pool_id: bech32.encode('pool', bech32.toWords(key.subarray(0, 28))), vrf_key_hash: key, first_registration_slot: 1n };
    client.latest_checkpoint_pool_registry!.pools.push({ registration: binding, registered: true, pending_vrf_key_hash: new Uint8Array(), pending_effective_epoch: 0n, retirement_epoch: 0n });
    client.latest_checkpoint_pool_registry!.mark.push(binding);
    client.latest_checkpoint_pool_registry!.effective.push(binding);
    client.epoch_stake_distribution.push({ ...binding, stake: 1n, relative_stake_numerator: 1n, relative_stake_denominator: 1n });
  }
  const total = client.epoch_stake_distribution.reduce((sum, row) => sum + row.stake, 0n);
  client.epoch_stake_distribution.forEach((row) => { row.relative_stake_numerator = row.stake; row.relative_stake_denominator = total; });
  client.epoch_contexts[0].stake_distribution = client.epoch_stake_distribution;
  const block = {
    height: Number(client.latest_checkpoint_height!.revision_height),
    hash: client.latest_checkpoint_block_hash,
    slotNo: client.latest_checkpoint_slot,
    epochNo: Number(client.current_epoch),
    timestampUnixNs: client.latest_checkpoint_timestamp,
  };
  const context = client.epoch_contexts[0];
  const mithrilEndpoint = mithril ? await localAggregator(client.current_epoch, context.stake_distribution) : undefined;
  const values = {
    mithrilEndpoint,
    cardanoChainId: client.chain_id,
    cardanoNetwork: network,
    ogmiosEndpoint: 'ws://operator-node',
    cardanoClientTrustingPeriodSeconds: 172800,
    cardanoClientMaxClockDriftSeconds: Number(client.max_clock_drift!.seconds),
    cardanoRandomnessStabilisationWindowSlots: client.randomness_stabilisation_window_slots.toString(),
    deployment: {
      packetState: { state: { scriptHash: Buffer.from(client.packet_lane_policy_id).toString('hex') } },
      hostStateNFT: {
        policyId: Buffer.from(client.host_state_nft_policy_id).toString('hex'),
        name: Buffer.from(client.host_state_nft_token_name).toString('hex'),
      },
    },
  };
  const history = {
    findLatestBlock: jest.fn().mockResolvedValue(block),
    findBlockByHeight: jest.fn().mockResolvedValue(block),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn().mockResolvedValue({ datum: 'host-state', blockNo: block.height }),
    findEpochContextAtBlock: jest.fn().mockResolvedValue({
      epoch: block.epochNo,
      stakeDistribution: context.stake_distribution.map((r) => ({
        poolId: r.pool_id,
        stake: r.stake,
        vrfKeyHash: Buffer.from(r.vrf_key_hash).toString('hex'),
        relativeStakeNumerator: r.relative_stake_numerator,
        relativeStakeDenominator: r.relative_stake_denominator,
        firstRegistrationSlot: r.first_registration_slot,
      })),
      verificationContext: {
        epochNonce: Buffer.from(context.epoch_nonce).toString('hex'),
        slotsPerKesPeriod: Number(context.slots_per_kes_period),
        maxKesEvolutions: Number(client.max_kes_evolutions),
        currentEpochStartSlot: context.epoch_start_slot,
        currentEpochEndSlotExclusive: context.epoch_end_slot_exclusive,
        activeSlotCoefficientNumerator: client.active_slot_coefficient_numerator,
        activeSlotCoefficientDenominator: client.active_slot_coefficient_denominator,
      },
    }),
    findInitialPoolRegistryAtBlock: jest.fn().mockResolvedValue(client.latest_checkpoint_pool_registry),
    findObservedPoolProductionAtBlock: jest.fn().mockResolvedValue(client.latest_checkpoint_pool_production),
    findOperationalCertificateCountersAtBlock: jest.fn().mockResolvedValue(new Map()),
    findDescendantBlocks: jest.fn().mockRejectedValue(new Error('Creation must not require settlement descendants')),
  };
  const nonce = client.latest_checkpoint_nonce_state!;
  jest.mocked(queryPraosNoncesAtPoint).mockResolvedValue(nonce as never);
  const header = Cbor.encode(
    new CborArray([
      new CborArray([
        new CborUInt(BigInt(block.height)),
        new CborUInt(block.slotNo),
        new CborBytes(nonce.last_applied_block_nonce),
      ]),
    ]),
  ).toBuffer();
  const lucid = {
    decodeDatum: jest
      .fn()
      .mockResolvedValue({ state: { ibc_state_root: Buffer.from(consensus.ibc_state_root).toString('hex') } }),
    LucidImporter: {
      SLOT_CONFIG_NETWORK: {
        [network]: {
          zeroTime: Number(client.system_start_unix_ns / 1_000_000n),
          slotLength: Number(client.slot_length_ns / 1_000_000n),
        },
      },
    },
  };
  const mini = {
    fetchBlockCbor: jest.fn().mockResolvedValue(Buffer.alloc(0)),
    extractBlockHeaderCbor: jest.fn().mockReturnValue(header),
  };
  const packet = { snapshot: jest.fn().mockResolvedValue(consensus.packet_state_snapshot) };
  const create = () =>
    new QueryService(
      {} as never,
      { get: (key: keyof typeof values) => values[key] } as never,
      lucid as never,
      {} as never,
      history as never,
      mini as never,
      {} as never,
      {} as never,
      {} as never,
      packet as never,
    );
  return { service: create(), create, history, block };
}

it.each(['Custom', 'Preview'])(
  'creates a shared-storage client on %s without an operator file or settlement descendants',
  async (network) => {
    const { service, history, block } = await setup(network);
    const response = await service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 0n }));
    const client = ClientState.decode(response.client_state!.value);
    const consensus = ConsensusState.decode(response.consensus_state!.value);
    expect(client.storage_version).toBe(2);
    expect(client.bootstrap_pending).toBe(true);
    expect(client.mithril_epoch).toBe(client.current_epoch - 1n);
    expect(client.latest_height!.revision_height).toBe(BigInt(block.height));
    expect(client.epoch_stake_distribution).toEqual([]);
    expect(consensus.packet_state_snapshot).toHaveLength(0);
    expect(response.client_state!.value.length).toBeLessThanOrEqual(4096);
    expect(response.consensus_state!.value.length).toBeLessThanOrEqual(1024);
    expect(response.initialization_message).toBeUndefined();
    expect(history.findDescendantBlocks).not.toHaveBeenCalled();
    expect(history.findHostStateUtxoAtOrBeforeBlockNo).toHaveBeenCalledWith(BigInt(block.height));
  },
);

it('resumes a 4000-row initialization and exposes each bounded import through completion', async () => {
  const { service, create, history, block } = await setup('Preview', 4000);
  const initial = await service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 0n }));
  const records = [Buffer.from(QueryNewClientResponse.encode(initial).finish()).toString('base64')];
  const restarted = create();
  history.findEpochContextAtBlock.mockRejectedValue(new Error('The original node point is no longer available'));
  for (let sequence = 1; sequence <= 4096; sequence++) {
    const request = QueryNewClientRequest.fromPartial({
      height: BigInt(block.height),
      initialization_sequence: sequence,
    });
    const response = await restarted.queryNewClient(request);
    expect(response.client_state).toEqual(initial.client_state);
    const retry = await restarted.queryNewClient(request);
    expect(retry.initialization_message).toEqual(response.initialization_message);
    const chunk = ProbabilisticHeader.decode(response.initialization_message!.value).observation_chunk!;
    expect(chunk.sequence).toBe(sequence);
    expect(response.initialization_message!.value.length).toBeLessThan(900000);
    records.push(Buffer.from(QueryNewClientResponse.encode(response).finish()).toString('base64'));
    if (chunk.operation === 11) break;
    expect(chunk.operation).toBe(10);
  }
  const last = QueryNewClientResponse.decode(Buffer.from(records[records.length - 1], 'base64'));
  const completion = ProbabilisticHeader.decode(last.initialization_message!.value).observation_chunk!;
  expect(completion.operation).toBe(11);
  // The final import carries the certificate of the initial stake table.
  expect(JSON.parse(Buffer.from(completion.objects).toString()).protocol_message.message_parts.current_epoch).toBe(
    (ClientState.decode(initial.client_state!.value).current_epoch - 1n).toString(),
  );
  expect(history.findEpochContextAtBlock).toHaveBeenCalledTimes(1);
  if (process.env.CLIENT_INITIALIZATION_FIXTURE)
    writeFileSync(process.env.CLIENT_INITIALIZATION_FIXTURE, JSON.stringify(records));
}, 60_000);

it('refuses to prepare a client without a Mithril aggregator', async () => {
  const { service, history } = await setup('Preview', 13, false);
  await expect(service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 0n }))).rejects.toThrow(
    'requires MITHRIL_ENDPOINT',
  );
  expect(history.findEpochContextAtBlock).not.toHaveBeenCalled();
});

it('does not query ledger context before this instance has a HostState UTxO', async () => {
  const { service, history } = await setup();
  history.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue(undefined);
  await expect(service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 1n }))).rejects.toThrow(
    'HostState UTxO does not exist',
  );
  expect(history.findEpochContextAtBlock).not.toHaveBeenCalled();
  expect(history.findInitialPoolRegistryAtBlock).not.toHaveBeenCalled();
});

it('reloads the initial point from disk after the Gateway process loses its memory cache', async () => {
  const { service } = await setup();
  const response = await service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 0n }));
  const client = ClientState.decode(response.client_state!.value);
  const identity = `${client.chain_id}:${Buffer.from(client.host_state_nft_policy_id).toString('hex')}.${Buffer.from(client.host_state_nft_token_name).toString('hex')}:${client.latest_checkpoint_block_hash}:${client.trusting_period!.seconds}:${client.max_clock_drift!.seconds}:${client.randomness_stabilisation_window_slots}`;
  await jest.isolateModulesAsync(async () => {
    const { initialClientPlan } = await import('../services/client-initialization');
    const rebuild = jest.fn().mockRejectedValue(new Error('The old node point has been pruned'));
    const plan = await initialClientPlan(identity, rebuild);
    expect(Buffer.from(plan.client_state, 'base64')).toEqual(Buffer.from(response.client_state!.value));
    expect(rebuild).not.toHaveBeenCalled();
  });
});


it('preserves pending initialization data when the automatic cache reaches capacity', async () => {
  const { service } = await setup();
  const response = await service.queryNewClient(QueryNewClientRequest.fromPartial({ height: 0n }));
  const client = ClientState.decode(response.client_state!.value);
  const cache = join(directory, 'client-initialization');
  const original = join(cache, readdirSync(cache)[0]);
  const encoded = readFileSync(original, 'utf8');
  for (let index = 0; index < 63; index++) copyFileSync(original, join(cache, `${index.toString(16).padStart(64, '0')}.json`));
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Number(client.latest_checkpoint_timestamp / 1_000_000n) + 1000);
  try {
    const { initialClientPlan } = await import('../services/client-initialization');
    await expect(initialClientPlan('another point', async () => JSON.parse(encoded))).rejects.toThrow('full of unexpired checkpoints');
    expect(existsSync(original)).toBe(true);
    expect(readdirSync(cache)).toHaveLength(64);
  } finally { clock.mockRestore(); }
});
