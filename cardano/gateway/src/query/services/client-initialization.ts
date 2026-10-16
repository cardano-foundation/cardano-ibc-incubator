import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ClientState,
  ConsensusState,
  ProbabilisticHeader,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';

type PreparedClient = { client_state: string; consensus_state: string; imports: string[] };
const plans = new Map<string, Promise<PreparedClient>>();
const maxPlanBytes = 32 * 1024 * 1024;
let cacheWrites: Promise<void> = Promise.resolve();

async function reserveCacheSlot(directory: string): Promise<void> {
  const files = (await readdir(directory)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
  if (files.length < 64) return;
  let retained = files.length;
  for (const name of files) {
    const plan = JSON.parse(await readFile(join(directory, name), 'utf8')) as PreparedClient;
    const client = ClientState.decode(Buffer.from(plan.client_state, 'base64'));
    const duration = client.trusting_period!;
    const expires = client.latest_checkpoint_timestamp + duration.seconds * 1_000_000_000n + BigInt(duration.nanos);
    if (expires <= BigInt(Date.now()) * 1_000_000n) {
      await unlink(join(directory, name));
      retained--;
    }
  }
  if (retained >= 64) throw new Error('Client initialization cache is full of unexpired checkpoints');
}

function validate(plan: PreparedClient): PreparedClient {
  const client = ClientState.decode(Buffer.from(plan.client_state, 'base64'));
  const consensus = ConsensusState.decode(Buffer.from(plan.consensus_state, 'base64'));
  if (
    client.storage_version !== 2 ||
    !client.bootstrap_pending ||
    client.verification_generation !== 1n ||
    client.checkpoint_reference.length !== 32 ||
    client.storage_namespace.length !== 32 ||
    !Buffer.from(consensus.checkpoint_reference).equals(Buffer.from(client.checkpoint_reference)) ||
    consensus.verification_generation !== 1n ||
    !plan.imports?.length ||
    plan.imports.length > 4096 ||
    // A client starts from Mithril-certified stake: it holds the anchor for
    // the epoch before its checkpoint, and its final import the certificate.
    client.mithril_epoch + 1n !== client.current_epoch ||
    !client.mithril_aggregate_verification_key ||
    !client.mithril_protocol_parameters_hash
  )
    throw new Error('Invalid prepared client initialization');
  plan.imports.forEach((encoded, index) => {
    const chunk = ProbabilisticHeader.decode(Buffer.from(encoded, 'base64')).observation_chunk;
    const last = index === plan.imports.length - 1;
    if (!chunk || chunk.sequence !== index + 1 || chunk.operation !== (last ? 11 : 10) || (last && !chunk.objects.length))
      throw new Error('Invalid client initialization import sequence');
  });
  return plan;
}

export async function encodeInitialClient(
  client: ClientState,
  consensus: ConsensusState,
  mithrilAggregator: string,
): Promise<PreparedClient> {
  const executable = process.env.CARDANO_CLIENT_PREPARER || resolve(process.cwd(), 'bin/prepare-client');
  return new Promise((accept, reject) => {
    const child = execFile(executable, { timeout: 120_000, maxBuffer: maxPlanBytes }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Client initialization preparation failed: ${stderr || error.message}`));
      try {
        accept(validate(JSON.parse(stdout)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin!.on('error', reject);
    child.stdin!.end(
      JSON.stringify({
        client_state: Buffer.from(ClientState.encode(client).finish()).toString('base64'),
        consensus_state: Buffer.from(ConsensusState.encode(consensus).finish()).toString('base64'),
        mithril_aggregator: mithrilAggregator,
      }),
    );
  });
}

// Retain the selected point across Gateway and Hermes restarts. This is an
// automatically managed cache, not an operator-supplied initialization file.
export async function initialClientPlan(
  identity: string,
  build: () => Promise<PreparedClient>,
): Promise<PreparedClient> {
  const directory = join(
    process.env.CONSENSUS_HISTORY_CACHE_DIR || resolve('.cache/consensus-history'),
    'client-initialization',
  );
  const key = createHash('sha256')
    .update(directory + identity)
    .digest('hex');
  if (plans.has(key)) return plans.get(key)!;
  const pending = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${key}.json`);
    try {
      if ((await stat(path)).size > maxPlanBytes) throw new Error('Initial client cache exceeds its bound');
      return validate(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const plan = validate(await build());
    const publish = cacheWrites.then(async () => {
      await reserveCacheSlot(directory);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(plan), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    });
    cacheWrites = publish.catch(() => {});
    await publish;
    return plan;
  })();
  if (plans.size >= 4) plans.delete(plans.keys().next().value!);
  plans.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    plans.delete(key);
    throw error;
  }
}
