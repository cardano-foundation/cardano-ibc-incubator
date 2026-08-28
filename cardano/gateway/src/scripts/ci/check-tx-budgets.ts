import * as fs from 'node:fs';
import * as path from 'node:path';

import * as Lucid from '@lucid-evolution/lucid';

import { encodeMintVoucherRedeemer } from '@shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { encodeSpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import {
  encodeMintConnectionRedeemer,
  encodeSpendConnectionRedeemer,
} from '@shared/types/connection/connection-redeemer';
import { encodeVerifyProofRedeemer } from '@shared/types/connection/verify-proof-redeemer';
import {
  encodeTraceRegistryDatum,
  encodeTraceRegistryRedeemer,
  TRACE_REGISTRY_LIMITS,
} from '@shared/types/trace-registry';

import {
  analyzeCapacityScenario,
  formatCapacityReport,
  loadNormalizedCapacityFixture,
} from './tendermint-update-capacity';
import { checkTransactionBudgets, type ExUnits } from './tx-budget-limits';

type BlueprintValidator = {
  title: string;
  compiledCode: string;
};

type Blueprint = {
  validators: BlueprintValidator[];
};

type AikenCheckReport = {
  modules: Array<{
    name: string;
    tests: Array<{
      title: string;
      execution_units?: {
        mem: number | null;
        cpu: number | null;
      };
    }>;
  }>;
};

type SizedPayload = {
  name: string;
  bytes: number;
};

type ScenarioInput = {
  id: string;
  name: string;
  inputCount: number;
  outputCount: number;
  mintPolicyCount: number;
  referenceScriptTitles: string[];
  inlineScriptTitles?: string[];
  redeemers: SizedPayload[];
  datums: SizedPayload[];
  largestProofPayloadBytes: number;
  aikenTests: string[];
  extraBytes?: number;
  unsignedBytesOverride?: number;
};

type ScenarioReport = {
  id: string;
  name: string;
  unsignedBytes: number;
  signedBytesEstimate: number;
  redeemers: SizedPayload[];
  datums: SizedPayload[];
  largestProofPayloadBytes: number;
  scriptReferenceCount: number;
  inlineScriptCount: number;
  exUnits: ExUnits;
};

const repoRoot = path.resolve(__dirname, '../../../../..');
const DEFAULT_MAX_TX_SIZE = 16_384;
const DEFAULT_TX_HEADROOM_BYTES = 750;
const DEFAULT_SIGNED_WITNESS_ESTIMATE_BYTES = 260;
const DEFAULT_MAX_TX_EX_MEM = 16_500_000;
const DEFAULT_MAX_TX_EX_STEPS = 10_000_000_000;
const DEFAULT_EX_UNIT_HEADROOM_BPS = 500;

const TX_BASE_BYTES = 360;
const TX_INPUT_BYTES = 44;
const TX_OUTPUT_BYTES = 80;
const TX_MINT_POLICY_BYTES = 45;
const TX_REFERENCE_INPUT_BYTES = 44;
const REFERENCE_SCRIPT_OUTPUT_OVERHEAD_BYTES = 200;

const CAPACITY_HOST_STATE_AIKEN_TEST = 'host_state_stt.test.host_update_client_capacity_minimum_history_succeeds';
const CAPACITY_SCENARIOS = [
  {
    fixtureName: 'adjacent_all_signed',
    aikenTest: 'spending_client_capacity.test.update_client_capacity_adjacent_all_signed_45_succeeds',
  },
  {
    fixtureName: 'adjacent_mixed',
    aikenTest: 'spending_client_capacity.test.update_client_capacity_adjacent_mixed_45_succeeds',
  },
  {
    fixtureName: 'non_adjacent_mixed',
    aikenTest: 'spending_client_capacity.test.update_client_capacity_non_adjacent_mixed_45_succeeds',
  },
] as const;

function readIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer; found ${value}`);
  }
  return parsed;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function byteLength(hex: string): number {
  if (hex.length % 2 !== 0) {
    throw new Error(`Expected even-length hex, got ${hex.length} characters`);
  }
  return hex.length / 2;
}

function hexOfBytes(bytes: number, byte = 'ab'): string {
  return byte.repeat(bytes);
}

function sized(name: string, hex: string): SizedPayload {
  return { name, bytes: byteLength(hex) };
}

function dataBytes(name: string, bytes: number): SizedPayload {
  return sized(name, Lucid.Data.to(hexOfBytes(bytes) as never, Lucid.Data.Bytes(), { canonical: true }));
}

function scriptBytes(validators: Map<string, BlueprintValidator>, title: string): number {
  const validator = validators.get(title);
  if (!validator) {
    throw new Error(`Missing validator in blueprint: ${title}`);
  }
  return byteLength(validator.compiledCode);
}

function requiredAikenTestUnits(aikenTests: Map<string, ExUnits>, testName: string): ExUnits {
  const units = aikenTests.get(testName);
  if (!units) {
    throw new Error(`Missing Aiken execution-unit fixture: ${testName}`);
  }
  return units;
}

function sumExUnits(aikenTests: Map<string, ExUnits>, testNames: string[]): ExUnits {
  return testNames
    .map((testName) => requiredAikenTestUnits(aikenTests, testName))
    .reduce(
      (sum, units) => ({
        mem: sum.mem + units.mem,
        steps: sum.steps + units.steps,
      }),
      { mem: 0, steps: 0 },
    );
}

function estimateUnsignedBytes(validators: Map<string, BlueprintValidator>, scenario: ScenarioInput): number {
  if (scenario.unsignedBytesOverride !== undefined) {
    return scenario.unsignedBytesOverride;
  }

  const inlineScriptBytes = (scenario.inlineScriptTitles ?? []).reduce(
    (sum, title) => sum + scriptBytes(validators, title),
    0,
  );
  const redeemerBytes = scenario.redeemers.reduce((sum, payload) => sum + payload.bytes, 0);
  const datumBytes = scenario.datums.reduce((sum, payload) => sum + payload.bytes, 0);

  return (
    TX_BASE_BYTES +
    scenario.inputCount * TX_INPUT_BYTES +
    scenario.outputCount * TX_OUTPUT_BYTES +
    scenario.mintPolicyCount * TX_MINT_POLICY_BYTES +
    scenario.referenceScriptTitles.length * TX_REFERENCE_INPUT_BYTES +
    inlineScriptBytes +
    redeemerBytes +
    datumBytes +
    (scenario.extraBytes ?? 0)
  );
}

function toAikenTestMap(report: AikenCheckReport): Map<string, ExUnits> {
  const tests = new Map<string, ExUnits>();
  for (const module of report.modules) {
    for (const test of module.tests) {
      const mem = test.execution_units?.mem;
      const cpu = test.execution_units?.cpu;
      if (typeof mem !== 'number' || typeof cpu !== 'number') {
        continue;
      }
      tests.set(`${module.name}.${test.title}`, { mem, steps: cpu });
    }
  }
  return tests;
}

function proofPayload(bytes: number) {
  const exist = {
    key: hexOfBytes(32, '01'),
    value: hexOfBytes(bytes, '02'),
    leaf: {
      hash: 1n,
      prehash_key: 1n,
      prehash_value: 1n,
      length: 1n,
      prefix: hexOfBytes(8, '03'),
    },
    path: [
      {
        hash: 1n,
        prefix: hexOfBytes(32, '04'),
        suffix: hexOfBytes(32, '05'),
      },
    ],
  };

  return {
    proofs: [
      {
        proof: {
          CommitmentProof_Exist: {
            exist,
          },
        },
      },
    ],
  };
}

const EMPTY_PROOF = { proofs: [] } as const;
const HEIGHT = { revisionNumber: 0n, revisionHeight: 11n } as const;

const PACKET = {
  sequence: 3n,
  source_port: '7472616e73666572',
  source_channel: '6368616e6e656c2d30',
  destination_port: '7472616e73666572',
  destination_channel: '6368616e6e656c2d31',
  data: hexOfBytes(256, '06'),
  timeout_height: { revisionNumber: 0n, revisionHeight: 99n },
  timeout_timestamp: 0n,
} as const;

const CLIENT_STATE = {
  chainId: '6f736d6f7369732d31',
  trustLevel: { numerator: 1n, denominator: 3n },
  trustingPeriod: 120n,
  unbondingPeriod: 240n,
  maxClockDrift: 10n,
  frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
  latestHeight: { revisionNumber: 0n, revisionHeight: 50n },
  proofSpecs: [],
};

const CONSENSUS_STATE = {
  timestamp: 123n,
  next_validators_hash: hexOfBytes(32, '07'),
  root: { hash: hexOfBytes(32, '08') },
};

function verifyProofRedeemer(proofBytes: number, valueBytes = 128): string {
  return encodeVerifyProofRedeemer(
    {
      VerifyMembership: {
        cs: CLIENT_STATE,
        cons_state: CONSENSUS_STATE,
        height: HEIGHT,
        processed_time: 0n,
        processed_height: 0n,
        delay_time_period: 0n,
        delay_block_period: 0n,
        proof: proofPayload(proofBytes) as never,
        path: { key_path: ['696263', '70617468'] },
        value: hexOfBytes(valueBytes, '09'),
      },
    },
    Lucid,
  );
}

function voucherRedeemer(kind: 'MintVoucher' | 'RefundVoucher'): string {
  const data = {
    denom: '756f736d6f',
    amount: '31303030303030',
    sender: '6f736d6f3173656e646572',
    receiver: '616464725f74657374317265636569766572',
    memo: '',
  };

  if (kind === 'MintVoucher') {
    return encodeMintVoucherRedeemer(
      {
        MintVoucher: {
          packet_source_port: PACKET.source_port,
          packet_source_channel: PACKET.source_channel,
          packet_dest_port: PACKET.destination_port,
          packet_dest_channel: PACKET.destination_channel,
          data,
        },
      },
      Lucid,
    );
  }

  return encodeMintVoucherRedeemer(
    {
      RefundVoucher: {
        packet_source_port: PACKET.source_port,
        packet_source_channel: PACKET.source_channel,
        data,
        acknowledgement: {
          response: {
            AcknowledgementError: {
              err: '74696d656f7574',
            },
          },
        },
      },
    },
    Lucid,
  );
}

function createTransferEscrowShardRedeemer(): string {
  const encodedPacketDenom = Buffer.from('6c6f76656c616365').toString('hex');
  const fungibleTokenPacketData = Lucid.Data.Object({
    denom: Lucid.Data.Bytes(),
    amount: Lucid.Data.Bytes(),
    sender: Lucid.Data.Bytes(),
    receiver: Lucid.Data.Bytes(),
    memo: Lucid.Data.Bytes(),
  });
  const schema = Lucid.Data.Object({
    channel_id: Lucid.Data.Bytes(),
    denom: Lucid.Data.Bytes(),
    data: fungibleTokenPacketData,
    registry_siblings: Lucid.Data.Array(Lucid.Data.Bytes()),
  });

  return Lucid.Data.to(
    {
      channel_id: PACKET.source_channel,
      denom: encodedPacketDenom,
      data: {
        denom: encodedPacketDenom,
        amount: '31303030303030',
        sender: '6f736d6f3173656e646572',
        receiver: '616464725f74657374317265636569766572',
        memo: '',
      },
      registry_siblings: Array.from({ length: 64 }, () => hexOfBytes(32, '00')),
    } as never,
    schema as never,
    { canonical: true },
  );
}

function traceShardDatum(entryCount: number): string {
  return encodeTraceRegistryDatum(
    {
      Shard: {
        bucket_index: 7n,
        entries: Array.from({ length: entryCount }, (_, index) => ({
          voucher_hash: hexOfBytes(28, (10 + (index % 80)).toString(16).padStart(2, '0')),
          full_denom: `transfer/channel-${index}/uosmo`,
        })),
      },
    },
    Lucid,
  );
}

function traceDirectoryDatum(archivedCount: number): string {
  return encodeTraceRegistryDatum(
    {
      Directory: {
        buckets: Array.from({ length: TRACE_REGISTRY_LIMITS.bucketCount }, (_, bucketIndex) => ({
          bucket_index: BigInt(bucketIndex),
          active_shard_name: hexOfBytes(32, (32 + bucketIndex).toString(16).padStart(2, '0')),
          archived_shard_names:
            bucketIndex === 7
              ? Array.from({ length: archivedCount }, (_, index) =>
                  hexOfBytes(32, (80 + index).toString(16).padStart(2, '0')),
                )
              : [],
        })),
      },
    },
    Lucid,
  );
}

async function buildScenarios(
  validators: Map<string, BlueprintValidator>,
  aikenTests: Map<string, ExUnits>,
): Promise<ScenarioReport[]> {
  const largestReferenceScript = [
    'host_state_stt.host_state_stt.spend',
    'minting_channel_stt.mint_channel_stt.mint',
    'minting_client_stt.mint_client_stt.mint',
    'minting_connection_stt.mint_connection_stt.mint',
    'minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint',
    'minting_voucher.mint_voucher.mint',
    'spending_channel.spend_channel.spend',
    'spending_client.spend_client.spend',
    'spending_connection.spend_connection.spend',
    'spending_transfer_module.spend_transfer_module.spend',
    'trace_registry.spend_trace_registry.spend',
    'spending_channel/acknowledge_packet.acknowledge_packet.mint',
    'spending_channel/chan_open_ack.chan_open_ack.mint',
    'spending_channel/prune_packet_history.prune_packet_history.mint',
    'spending_channel/recv_packet.recv_packet.mint',
    'spending_channel/send_packet.send_packet.spend',
    'spending_channel/timeout_packet.timeout_packet.mint',
  ]
    .map((title) => ({ title, bytes: scriptBytes(validators, title) }))
    .sort((left, right) => right.bytes - left.bytes)[0];

  const scenarios: ScenarioInput[] = [
    {
      id: 'reference_script_deployment',
      name: 'reference script deployment',
      inputCount: 1,
      outputCount: 1,
      mintPolicyCount: 0,
      referenceScriptTitles: [],
      inlineScriptTitles: [largestReferenceScript.title],
      redeemers: [],
      datums: [dataBytes('reference datum', 0)],
      largestProofPayloadBytes: 0,
      aikenTests: [],
      unsignedBytesOverride: largestReferenceScript.bytes + REFERENCE_SCRIPT_OUTPUT_OVERHEAD_BYTES,
    },
    {
      id: 'bind_port_at_global_cap',
      name: 'BindPort at global cap',
      inputCount: 2,
      outputCount: 2,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'minting_port.mint_port.mint',
        'minting_identifier.minting_identifier.mint',
      ],
      redeemers: [
        // A BindPort witness contains one 32-byte sibling for every level of
        // the 256-bit commitment tree. Keep this estimate deliberately above
        // the encoded payload so the global-cap boundary has explicit margin.
        dataBytes('host state BindPort redeemer', 9_000),
        dataBytes('mint port redeemer', 80),
        dataBytes('mint identifier redeemer', 40),
      ],
      datums: [dataBytes('updated HostState datum with ten ports', 512)],
      largestProofPayloadBytes: 8_192,
      aikenTests: [
        'host_state_stt.test.host_state_bind_tenth_port_succeeds_at_global_cap',
        'minting_port.test.mint_port_tenth_port_succeeds_at_module_cap',
        'minting_identifier.test.mints_identifier_from_nonce_output_reference',
      ],
    },
    {
      id: 'conn_open_try',
      name: 'ConnOpenTry',
      inputCount: 2,
      outputCount: 3,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'minting_connection_stt.mint_connection_stt.mint',
        'verifying_proof.verify_proof.mint',
      ],
      redeemers: [
        sized(
          'mint connection ConnOpenTry',
          await encodeMintConnectionRedeemer(
            {
              ConnOpenTry: {
                client_state: hexOfBytes(2048, '31'),
                proof_init: proofPayload(1024) as never,
                proof_client: EMPTY_PROOF as never,
                proof_height: HEIGHT,
              },
            },
            Lucid,
          ),
        ),
        sized('verify proof', verifyProofRedeemer(1024)),
        dataBytes('host state redeemer', 512),
      ],
      datums: [dataBytes('updated host state datum', 1000), dataBytes('connection datum', 768)],
      largestProofPayloadBytes: 1024,
      aikenTests: [
        'ibc/core/ics_003_connection_semantics/connection_datum.test.test_is_conn_open_try_valid_succeed',
        'spending_transfer_module.test.on_chan_open_try_succeed',
      ],
    },
    {
      id: 'conn_open_ack',
      name: 'ConnOpenAck',
      inputCount: 3,
      outputCount: 3,
      mintPolicyCount: 1,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_connection.spend_connection.spend',
        'verifying_proof.verify_proof.mint',
      ],
      redeemers: [
        sized('spend connection ConnOpenAck', await encodeSpendConnectionRedeemer('ConnOpenAck', Lucid)),
        sized('verify proof', verifyProofRedeemer(1536)),
        dataBytes('host state redeemer', 512),
      ],
      datums: [dataBytes('updated host state datum', 1000), dataBytes('connection datum', 768)],
      largestProofPayloadBytes: 1536,
      aikenTests: ['spending_connection.test.conn_open_ack_succeed'],
    },
    {
      id: 'send_packet_at_commitment_capacity',
      name: 'First native SendPacket at commitment capacity',
      inputCount: 4,
      outputCount: 4,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_transfer_module.spend_transfer_module.spend',
        'spending_channel/send_packet.send_packet.spend',
        'minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint',
      ],
      redeemers: [
        sized(
          'spend channel SendPacket',
          await encodeSpendChannelRedeemer({ SendPacket: { packet: PACKET as never } }, Lucid),
        ),
        // SendPacket carries one 64-level sparse-Merkle packet witness.
        dataBytes('host state redeemer', 2_400),
        dataBytes('transfer module redeemer', 384),
        sized('create transfer escrow shard', createTransferEscrowShardRedeemer()),
      ],
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum', 2_800),
        dataBytes('updated transfer module datum', 32),
        dataBytes('transfer escrow shard datum', 360),
      ],
      largestProofPayloadBytes: 2_048,
      aikenTests: [
        'spending_channel.test.send_packet_succeed',
        'spending_channel/send_packet.test.succeed_send_packet',
        'ibc/core/ics_004/channel_datum_test/validate_send_packet.succeed_at_packet_commitment_capacity',
        'host_state_stt.test.host_state_handle_packet_send_succeeds_at_commitment_capacity',
        'spending_transfer_module.test.transfer_escrow_succeed',
        'minting_transfer_escrow_shard.test.create_transfer_escrow_shard_succeeds',
      ],
    },
    {
      id: 'recv_packet_at_history_capacity',
      name: 'RecvPacket at history capacity',
      inputCount: 3,
      outputCount: 3,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_channel/recv_packet.recv_packet.mint',
        'verifying_proof.verify_proof.mint',
      ],
      redeemers: [
        sized(
          'spend channel RecvPacket',
          await encodeSpendChannelRedeemer(
            {
              RecvPacket: {
                packet: PACKET as never,
                proof_commitment: proofPayload(1536) as never,
                proof_height: HEIGHT,
              },
            },
            Lucid,
          ),
        ),
        sized('verify proof', verifyProofRedeemer(1536)),
        // RecvPacket updates both receipt and acknowledgement paths. Each path
        // carries a 64-level sparse-Merkle witness at the configured boundary.
        dataBytes('host state redeemer', 4_600),
      ],
      datums: [dataBytes('updated host state datum', 1000), dataBytes('updated channel datum', 2_800)],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.recv_packet_succeed',
        'spending_channel/recv_packet.test.succeed_recv_packet',
        'ibc/core/ics_004/channel_datum_test/validate_recv_packet.succeed_at_packet_history_capacity',
        'host_state_stt.test.host_state_handle_packet_recv_succeeds_at_history_capacity',
        'host_state_stt.test.host_state_handle_packet_acknowledgement_succeeds_at_history_capacity',
      ],
    },
    {
      id: 'prune_packet_history_at_capacity',
      name: 'PrunePacketHistory at history capacity',
      // Two spending inputs plus the referenced connection and client UTxOs.
      inputCount: 4,
      outputCount: 2,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_channel/prune_packet_history.prune_packet_history.mint',
        'verifying_proof.verify_proof.mint',
      ],
      redeemers: [
        sized(
          'spend channel PrunePacketHistory',
          await encodeSpendChannelRedeemer(
            {
              PrunePacketHistory: {
                sequence: PACKET.sequence,
                proof_commitment_absence: proofPayload(1536) as never,
                proof_height: HEIGHT,
              },
            },
            Lucid,
          ),
        ),
        dataBytes('prune packet-history marker', 80),
        // The membership-shaped fixture is deliberately at least as large as
        // the corresponding non-membership witness carried by this path.
        sized('verify non-membership proof', verifyProofRedeemer(1536)),
        // Pruning deletes receipt then acknowledgement, so HostState carries
        // two complete 64-level sparse-Merkle witnesses.
        dataBytes('host state HandlePacket redeemer', 4_600),
      ],
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum at history capacity', 2_800),
      ],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.prune_packet_history_succeed',
        'spending_channel/prune_packet_history.test.prune_packet_history_succeeds_at_capacity_boundary',
        'host_state_stt.test.host_state_prune_packet_history_succeeds_at_full_packet_history_capacity',
        'verifying_proof.test.verify_non_membership_succeed',
      ],
    },
    {
      id: 'acknowledge_packet',
      name: 'AcknowledgePacket',
      inputCount: 4,
      outputCount: 3,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_transfer_module.spend_transfer_module.spend',
        'spending_channel/acknowledge_packet.acknowledge_packet.mint',
        'verifying_proof.verify_proof.mint',
      ],
      redeemers: [
        sized(
          'spend channel AcknowledgePacket',
          await encodeSpendChannelRedeemer(
            {
              AcknowledgePacket: {
                packet: PACKET as never,
                acknowledgement: '6f6b',
                proof_acked: proofPayload(1536) as never,
                proof_height: HEIGHT,
              },
            },
            Lucid,
          ),
        ),
        sized('verify proof', verifyProofRedeemer(1536)),
        sized('refund voucher', voucherRedeemer('RefundVoucher')),
        dataBytes('host state redeemer', 512),
      ],
      datums: [dataBytes('updated host state datum', 1000), dataBytes('updated channel datum', 700)],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.acknowledge_packet_succeed',
        'spending_channel/acknowledge_packet.test.succeed_acknowledge_packet',
        'spending_transfer_module.test.on_acknowledgement_packet_result_succeed',
      ],
    },
    {
      id: 'timeout_packet',
      name: 'TimeoutPacket',
      inputCount: 4,
      outputCount: 4,
      mintPolicyCount: 3,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_transfer_module.spend_transfer_module.spend',
        'spending_channel/timeout_packet.timeout_packet.mint',
        'verifying_proof.verify_proof.mint',
        'minting_voucher.mint_voucher.mint',
      ],
      redeemers: [
        sized(
          'spend channel TimeoutPacket',
          await encodeSpendChannelRedeemer(
            {
              TimeoutPacket: {
                packet: PACKET as never,
                proof_unreceived: proofPayload(1536) as never,
                proof_height: HEIGHT,
                next_sequence_recv: 4n,
              },
            },
            Lucid,
          ),
        ),
        sized('verify proof', verifyProofRedeemer(1536)),
        sized('refund voucher', voucherRedeemer('RefundVoucher')),
        dataBytes('host state redeemer', 512),
      ],
      datums: [dataBytes('updated host state datum', 1000), dataBytes('updated channel datum', 700)],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.timeout_packet_succeed',
        'spending_channel/timeout_packet.test.succeed_timeout_unordered_packet',
        'spending_transfer_module.test.on_timeout_packet_mint_voucher_succeed',
      ],
    },
    {
      id: 'trace_registry_append_at_capacity',
      name: 'Trace registry append at bounded worst-case history',
      inputCount: 2,
      outputCount: 1,
      mintPolicyCount: 0,
      referenceScriptTitles: ['trace_registry.spend_trace_registry.spend'],
      redeemers: [
        sized(
          'trace registry InsertTrace',
          encodeTraceRegistryRedeemer(
            {
              InsertTrace: {
                voucher_hash: hexOfBytes(32, '44'),
                full_denom: 'transfer/channel-0/uosmo',
              },
            },
            Lucid,
          ),
        ),
      ],
      datums: [dataBytes('max encoded shard datum', TRACE_REGISTRY_LIMITS.maxShardDatumBytes)],
      largestProofPayloadBytes: 0,
      aikenTests: ['trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit'],
      extraBytes: (1 + TRACE_REGISTRY_LIMITS.maxArchivedShardsPerBucket) * TX_REFERENCE_INPUT_BYTES,
    },
    {
      id: 'trace_registry_rollover',
      name: 'Trace registry rollover',
      inputCount: 3,
      outputCount: 3,
      mintPolicyCount: 1,
      referenceScriptTitles: [
        'trace_registry.spend_trace_registry.spend',
        'minting_identifier.minting_identifier.mint',
      ],
      redeemers: [
        sized(
          'trace registry RolloverInsertTrace',
          encodeTraceRegistryRedeemer(
            {
              RolloverInsertTrace: {
                voucher_hash: hexOfBytes(32, '44'),
                full_denom: 'transfer/channel-0/uosmo',
                new_active_shard_name: hexOfBytes(32, '55'),
              },
            },
            Lucid,
          ),
        ),
        sized(
          'trace directory AdvanceDirectory',
          encodeTraceRegistryRedeemer(
            {
              AdvanceDirectory: {
                bucket_index: 7n,
                voucher_hash: hexOfBytes(32, '44'),
                full_denom: 'transfer/channel-0/uosmo',
                previous_active_shard_name: hexOfBytes(32, '66'),
                new_active_shard_name: hexOfBytes(32, '55'),
              },
            },
            Lucid,
          ),
        ),
        dataBytes('mint identifier redeemer', 64),
      ],
      datums: [
        sized('updated directory datum', traceDirectoryDatum(8)),
        dataBytes('max archived shard datum', TRACE_REGISTRY_LIMITS.maxShardDatumBytes),
        sized('new active shard datum', traceShardDatum(1)),
      ],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'trace_registry_rollover.test.trace_registry_rollover_insert_succeeds_and_preserves_old_shard',
        'trace_registry_rollover.test.trace_registry_advance_directory_succeeds_for_valid_rollover',
        // Conservatively charge a full archive scan to each rollover validator.
        'trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit',
        'trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit',
      ],
      extraBytes: (TRACE_REGISTRY_LIMITS.maxArchivedShardsPerBucket - 1) * TX_REFERENCE_INPUT_BYTES,
    },
    {
      id: 'first_seen_voucher_mint',
      name: 'First-seen voucher mint + CIP-68 metadata',
      inputCount: 3,
      outputCount: 4,
      mintPolicyCount: 2,
      referenceScriptTitles: ['minting_voucher.mint_voucher.mint', 'trace_registry.spend_trace_registry.spend'],
      redeemers: [
        sized('mint voucher', voucherRedeemer('MintVoucher')),
        sized(
          'trace registry InsertTrace',
          encodeTraceRegistryRedeemer(
            {
              InsertTrace: {
                voucher_hash: hexOfBytes(32, '44'),
                full_denom: 'transfer/channel-0/uosmo',
              },
            },
            Lucid,
          ),
        ),
      ],
      datums: [
        dataBytes('max encoded shard datum', TRACE_REGISTRY_LIMITS.maxShardDatumBytes),
        dataBytes('CIP-68 voucher metadata datum', 900),
      ],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'minting_voucher.test.test_mint_voucher',
        // One boundary fixture covers the registry validator; the second is a
        // conservative proxy for the voucher policy's own archive scan.
        'trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit',
        'trace_registry_capacity.test.trace_registry_boundary_append_eight_archives_at_entry_limit',
      ],
      extraBytes: (1 + TRACE_REGISTRY_LIMITS.maxArchivedShardsPerBucket) * TX_REFERENCE_INPUT_BYTES,
    },
  ];

  return scenarios.map((scenario) => {
    const unsignedBytes = estimateUnsignedBytes(validators, scenario);
    return {
      id: scenario.id,
      name: scenario.name,
      unsignedBytes,
      signedBytesEstimate: unsignedBytes + DEFAULT_SIGNED_WITNESS_ESTIMATE_BYTES,
      redeemers: scenario.redeemers,
      datums: scenario.datums,
      largestProofPayloadBytes: scenario.largestProofPayloadBytes,
      scriptReferenceCount: scenario.referenceScriptTitles.length,
      inlineScriptCount: scenario.inlineScriptTitles?.length ?? 0,
      exUnits: sumExUnits(aikenTests, scenario.aikenTests),
    };
  });
}

async function buildCapacityReports(aikenTests: Map<string, ExUnits>) {
  const fixture = loadNormalizedCapacityFixture();
  const hostState = requiredAikenTestUnits(aikenTests, CAPACITY_HOST_STATE_AIKEN_TEST);

  return Promise.all(
    CAPACITY_SCENARIOS.map(async ({ fixtureName, aikenTest }) => {
      const scenario = fixture.scenarios[fixtureName];
      if (!scenario) {
        throw new Error(`Missing normalized Tendermint capacity scenario: ${fixtureName}`);
      }
      const spendClient = requiredAikenTestUnits(aikenTests, aikenTest);
      const artifact = await analyzeCapacityScenario(
        fixtureName,
        scenario,
        {
          hostState: { mem: BigInt(hostState.mem), steps: BigInt(hostState.steps) },
          spendClient: { mem: BigInt(spendClient.mem), steps: BigInt(spendClient.steps) },
        },
        'aiken-unit-tests',
      );
      return artifact.report;
    }),
  );
}

function printReport(reports: ScenarioReport[], maxTxSize: number): void {
  console.log(`Cardano transaction budget report (maxTxSize=${maxTxSize})`);
  for (const report of reports) {
    console.log(`\n${report.name}`);
    console.log(`  unsigned bytes: ${report.unsignedBytes}`);
    console.log(`  signed bytes estimate: ${report.signedBytesEstimate}`);
    console.log(`  size margin: ${maxTxSize - report.signedBytesEstimate}`);
    console.log(`  ex units: mem=${report.exUnits.mem} steps=${report.exUnits.steps}`);
    console.log(`  redeemer sizes: ${formatPayloads(report.redeemers)}`);
    console.log(`  datum sizes: ${formatPayloads(report.datums)}`);
    console.log(`  largest proof payload: ${report.largestProofPayloadBytes}`);
    console.log(
      `  script/reference count: references=${report.scriptReferenceCount} inline=${report.inlineScriptCount}`,
    );
  }
}

function formatPayloads(payloads: SizedPayload[]): string {
  if (payloads.length === 0) {
    return 'none';
  }
  return payloads.map((payload) => `${payload.name}=${payload.bytes}`).join(', ');
}

async function main() {
  const maxTxSize = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_SIZE', DEFAULT_MAX_TX_SIZE);
  const txHeadroomBytes = readIntegerEnv('CARDANO_TX_BUDGET_HEADROOM_BYTES', DEFAULT_TX_HEADROOM_BYTES);
  const maxTxExMem = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_EX_MEM', DEFAULT_MAX_TX_EX_MEM);
  const maxTxExSteps = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_EX_STEPS', DEFAULT_MAX_TX_EX_STEPS);
  const exUnitHeadroomBps = readIntegerEnv('CARDANO_TX_BUDGET_EX_UNIT_HEADROOM_BPS', DEFAULT_EX_UNIT_HEADROOM_BPS);
  const blueprintPath = process.env.CARDANO_TX_BUDGET_BLUEPRINT || path.join(repoRoot, 'cardano/onchain/plutus.json');
  const aikenCheckJsonPath = process.env.CARDANO_TX_BUDGET_AIKEN_CHECK_JSON || path.join(repoRoot, 'aiken-check.json');

  const blueprint = readJson<Blueprint>(blueprintPath);
  const validators = new Map(blueprint.validators.map((validator) => [validator.title, validator]));
  const aikenCheckReport = readJson<AikenCheckReport>(aikenCheckJsonPath);
  const aikenTests = toAikenTestMap(aikenCheckReport);
  const reports = await buildScenarios(validators, aikenTests);
  const capacityReports = await buildCapacityReports(aikenTests);

  printReport(reports, maxTxSize);
  console.log('\nInjective Tendermint UpdateClient capacity report (report-only; not a budget gate)');
  console.log(capacityReports.map((report) => formatCapacityReport(report)).join('\n\n'));

  const { failures, knownViolations } = checkTransactionBudgets(reports, {
    maxTxSize,
    txHeadroomBytes,
    maxTxExMem,
    maxTxExSteps,
    exUnitHeadroomBps,
  });

  if (knownViolations.length > 0) {
    console.log('\nKNOWN EXECUTION-BUDGET VIOLATIONS (regression-ratcheted):');
    for (const violation of knownViolations) {
      console.log(`- ${violation}`);
    }
  }

  if (failures.length > 0) {
    console.error('\nTransaction budget check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `\nTransaction budget ratchet passed: no scenario exceeded its public-limit budget or recorded overrun ceiling.`,
  );
  if (knownViolations.length > 0) {
    console.log(`${knownViolations.length} known execution-limit violations remain and may only decrease.`);
  } else {
    console.log(`All scenarios retain ${txHeadroomBytes} bytes and ${exUnitHeadroomBps / 100}% ex-unit headroom.`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
