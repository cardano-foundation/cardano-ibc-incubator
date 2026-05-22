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
} from '@shared/types/trace-registry';

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

type ExUnits = {
  mem: number;
  steps: number;
};

type SizedPayload = {
  name: string;
  bytes: number;
};

type ScenarioInput = {
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
const DEFAULT_MAX_TX_EX_MEM = 140_000_000;
const DEFAULT_MAX_TX_EX_STEPS = 100_000_000_000;
const DEFAULT_EX_UNIT_HEADROOM_BPS = 500;

const TX_BASE_BYTES = 360;
const TX_INPUT_BYTES = 44;
const TX_OUTPUT_BYTES = 80;
const TX_MINT_POLICY_BYTES = 45;
const TX_REFERENCE_INPUT_BYTES = 44;
const REFERENCE_SCRIPT_OUTPUT_OVERHEAD_BYTES = 200;

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
  return sized(
    name,
    Lucid.Data.to(hexOfBytes(bytes) as never, Lucid.Data.Bytes(), { canonical: true }),
  );
}

function scriptBytes(validators: Map<string, BlueprintValidator>, title: string): number {
  const validator = validators.get(title);
  if (!validator) {
    throw new Error(`Missing validator in blueprint: ${title}`);
  }
  return byteLength(validator.compiledCode);
}

function requiredAikenTestUnits(
  aikenTests: Map<string, ExUnits>,
  testName: string,
): ExUnits {
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

function estimateUnsignedBytes(
  validators: Map<string, BlueprintValidator>,
  scenario: ScenarioInput,
): number {
  if (scenario.unsignedBytesOverride !== undefined) {
    return scenario.unsignedBytesOverride;
  }

  const inlineScriptBytes = (scenario.inlineScriptTitles ?? [])
    .reduce((sum, title) => sum + scriptBytes(validators, title), 0);
  const redeemerBytes = scenario.redeemers.reduce((sum, payload) => sum + payload.bytes, 0);
  const datumBytes = scenario.datums.reduce((sum, payload) => sum + payload.bytes, 0);

  return TX_BASE_BYTES +
    scenario.inputCount * TX_INPUT_BYTES +
    scenario.outputCount * TX_OUTPUT_BYTES +
    scenario.mintPolicyCount * TX_MINT_POLICY_BYTES +
    scenario.referenceScriptTitles.length * TX_REFERENCE_INPUT_BYTES +
    inlineScriptBytes +
    redeemerBytes +
    datumBytes +
    (scenario.extraBytes ?? 0);
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

function traceShardDatum(entryCount: number): string {
  return encodeTraceRegistryDatum(
    {
      Shard: {
        bucket_index: 7n,
        entries: Array.from({ length: entryCount }, (_, index) => ({
          voucher_hash: hexOfBytes(32, (10 + (index % 80)).toString(16).padStart(2, '0')),
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
        buckets: [
          {
            bucket_index: 7n,
            active_shard_name: hexOfBytes(32, '66'),
            archived_shard_names: Array.from({ length: archivedCount }, (_, index) =>
              hexOfBytes(32, (80 + index).toString(16).padStart(2, '0'))
            ),
          },
        ],
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
    'minting_voucher.mint_voucher.mint',
    'spending_channel.spend_channel.spend',
    'spending_client.spend_client.spend',
    'spending_connection.spend_connection.spend',
    'spending_transfer_module.spend_transfer_module.spend',
    'trace_registry.spend_trace_registry.spend',
    'spending_channel/acknowledge_packet.acknowledge_packet.mint',
    'spending_channel/chan_open_ack.chan_open_ack.mint',
    'spending_channel/recv_packet.recv_packet.mint',
    'spending_channel/send_packet.send_packet.spend',
    'spending_channel/timeout_packet.timeout_packet.mint',
  ]
    .map((title) => ({ title, bytes: scriptBytes(validators, title) }))
    .sort((left, right) => right.bytes - left.bytes)[0];

  const scenarios: ScenarioInput[] = [
    {
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
      unsignedBytesOverride: largestReferenceScript.bytes +
        REFERENCE_SCRIPT_OUTPUT_OVERHEAD_BYTES,
    },
    {
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
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('connection datum', 768),
      ],
      largestProofPayloadBytes: 1024,
      aikenTests: [
        'ibc/core/ics_003_connection_semantics/connection_datum.test.test_is_conn_open_try_valid_succeed',
        'spending_transfer_module.test.on_chan_open_try_succeed',
      ],
    },
    {
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
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('connection datum', 768),
      ],
      largestProofPayloadBytes: 1536,
      aikenTests: ['spending_connection.test.conn_open_ack_succeed'],
    },
    {
      name: 'SendPacket',
      inputCount: 3,
      outputCount: 3,
      mintPolicyCount: 1,
      referenceScriptTitles: [
        'host_state_stt.host_state_stt.spend',
        'spending_channel.spend_channel.spend',
        'spending_transfer_module.spend_transfer_module.spend',
        'spending_channel/send_packet.send_packet.spend',
      ],
      redeemers: [
        sized(
          'spend channel SendPacket',
          await encodeSpendChannelRedeemer({ SendPacket: { packet: PACKET as never } }, Lucid),
        ),
        dataBytes('host state redeemer', 512),
        dataBytes('transfer module redeemer', 384),
      ],
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum', 700),
        dataBytes('transfer escrow shard datum', 360),
      ],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'spending_channel.test.send_packet_succeed',
        'spending_channel/send_packet.test.succeed_send_packet',
      ],
    },
    {
      name: 'RecvPacket',
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
        dataBytes('host state redeemer', 512),
      ],
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum', 700),
      ],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.recv_packet_succeed',
        'spending_channel/recv_packet.test.succeed_recv_packet',
      ],
    },
    {
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
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum', 700),
      ],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.acknowledge_packet_succeed',
        'spending_channel/acknowledge_packet.test.succeed_acknowledge_packet',
        'spending_transfer_module.test.on_acknowledgement_packet_result_succeed',
      ],
    },
    {
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
      datums: [
        dataBytes('updated host state datum', 1000),
        dataBytes('updated channel datum', 700),
      ],
      largestProofPayloadBytes: 1536,
      aikenTests: [
        'spending_channel.test.timeout_packet_succeed',
        'spending_channel/timeout_packet.test.succeed_timeout_unordered_packet',
        'spending_transfer_module.test.on_timeout_packet_mint_voucher_succeed',
      ],
    },
    {
      name: 'Trace registry append',
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
      datums: [sized('updated shard datum', traceShardDatum(72))],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'trace_registry.test.trace_registry_insert_trace_succeeds_with_matching_voucher_mint',
      ],
    },
    {
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
        sized('archived shard datum', traceShardDatum(96)),
        sized('new active shard datum', traceShardDatum(1)),
      ],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'trace_registry_rollover.test.trace_registry_rollover_insert_succeeds_and_preserves_old_shard',
        'trace_registry_rollover.test.trace_registry_advance_directory_succeeds_for_valid_rollover',
      ],
    },
    {
      name: 'First-seen voucher mint + CIP-68 metadata',
      inputCount: 3,
      outputCount: 4,
      mintPolicyCount: 2,
      referenceScriptTitles: [
        'minting_voucher.mint_voucher.mint',
        'trace_registry.spend_trace_registry.spend',
      ],
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
        sized('updated shard datum', traceShardDatum(72)),
        dataBytes('CIP-68 voucher metadata datum', 900),
      ],
      largestProofPayloadBytes: 0,
      aikenTests: [
        'minting_voucher.test.test_mint_voucher',
        'trace_registry.test.trace_registry_insert_trace_succeeds_with_matching_voucher_mint',
      ],
    },
  ];

  return scenarios.map((scenario) => {
    const unsignedBytes = estimateUnsignedBytes(validators, scenario);
    return {
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

function checkBudgets(
  reports: ScenarioReport[],
  maxTxSize: number,
  txHeadroomBytes: number,
  maxTxExMem: number,
  maxTxExSteps: number,
  exUnitHeadroomBps: number,
): string[] {
  const failures: string[] = [];
  const safeTxSize = maxTxSize - txHeadroomBytes;
  const safeMem = Math.floor(maxTxExMem * (10_000 - exUnitHeadroomBps) / 10_000);
  const safeSteps = Math.floor(maxTxExSteps * (10_000 - exUnitHeadroomBps) / 10_000);

  for (const report of reports) {
    if (report.unsignedBytes > safeTxSize) {
      failures.push(
        `${report.name}: unsigned bytes ${report.unsignedBytes} exceed safe budget ${safeTxSize}`,
      );
    }
    if (report.signedBytesEstimate > safeTxSize) {
      failures.push(
        `${report.name}: signed bytes estimate ${report.signedBytesEstimate} exceeds safe budget ${safeTxSize}`,
      );
    }
    if (report.exUnits.mem > safeMem) {
      failures.push(`${report.name}: memory ex units ${report.exUnits.mem} exceed safe budget ${safeMem}`);
    }
    if (report.exUnits.steps > safeSteps) {
      failures.push(`${report.name}: CPU steps ${report.exUnits.steps} exceed safe budget ${safeSteps}`);
    }
  }

  return failures;
}

async function main() {
  const maxTxSize = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_SIZE', DEFAULT_MAX_TX_SIZE);
  const txHeadroomBytes = readIntegerEnv('CARDANO_TX_BUDGET_HEADROOM_BYTES', DEFAULT_TX_HEADROOM_BYTES);
  const maxTxExMem = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_EX_MEM', DEFAULT_MAX_TX_EX_MEM);
  const maxTxExSteps = readIntegerEnv('CARDANO_TX_BUDGET_MAX_TX_EX_STEPS', DEFAULT_MAX_TX_EX_STEPS);
  const exUnitHeadroomBps = readIntegerEnv('CARDANO_TX_BUDGET_EX_UNIT_HEADROOM_BPS', DEFAULT_EX_UNIT_HEADROOM_BPS);
  const blueprintPath = process.env.CARDANO_TX_BUDGET_BLUEPRINT ||
    path.join(repoRoot, 'cardano/onchain/plutus.json');
  const aikenCheckJsonPath = process.env.CARDANO_TX_BUDGET_AIKEN_CHECK_JSON ||
    path.join(repoRoot, 'aiken-check.json');

  const blueprint = readJson<Blueprint>(blueprintPath);
  const validators = new Map(
    blueprint.validators.map((validator) => [validator.title, validator]),
  );
  const aikenCheckReport = readJson<AikenCheckReport>(aikenCheckJsonPath);
  const aikenTests = toAikenTestMap(aikenCheckReport);
  const reports = await buildScenarios(validators, aikenTests);

  printReport(reports, maxTxSize);

  const failures = checkBudgets(
    reports,
    maxTxSize,
    txHeadroomBytes,
    maxTxExMem,
    maxTxExSteps,
    exUnitHeadroomBps,
  );

  if (failures.length > 0) {
    console.error('\nTransaction budget check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `\nTransaction budget check passed with ${txHeadroomBytes} bytes and ${exUnitHeadroomBps / 100}% ex-unit headroom.`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
