import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import {
  computeReferenceScriptInventoryRoot,
  mapOgmiosProtocolParameters,
  normalizeBridgeManifest,
  ogmiosRequest,
  queryProtocolParametersCompat,
  retryWithBackoff,
  withKupoStringQuantityHeader,
} from './index';
import { credentialToAddress, Lucid, validatorToAddress, validatorToScriptHash } from '@lucid-evolution/lucid';

const referenceValidatorScript = { type: 'PlutusV3' as const, script: '590100' };
const hostStateNftScript = {
  type: 'PlutusV3' as const,
  script: '4e4d01000033222220051200120011',
};

function bridgeManifestV6(): any {
  const validatorAddress = credentialToAddress('Preprod', {
    type: 'Script',
    hash: '11'.repeat(28),
  });
  const validator = {
    script_hash: '11'.repeat(28),
    address: validatorAddress,
    ref_utxo: { tx_hash: '22'.repeat(32), output_index: 0 },
  };
  const mintingValidator = { ...validator, address: '' };
  const channelRefValidator = {
    script_hash: '33'.repeat(28),
    ref_utxo: { tx_hash: '44'.repeat(32), output_index: 0 },
  };

  const referenceOutRefs = [
    { ...validator.ref_utxo, script_hash: validator.script_hash },
    { ...channelRefValidator.ref_utxo, script_hash: channelRefValidator.script_hash },
  ];

  return {
    schema_version: 6,
    deployed_at: '2026-08-21T00:00:00.000Z',
    cardano: { network: 'preprod' },
    host_state_nft: {
      policy_id: validatorToScriptHash(hostStateNftScript),
      token_name: 'aa',
      script: hostStateNftScript.script,
    },
    reference_out_refs: referenceOutRefs,
    reference_script_inventory_root: computeReferenceScriptInventoryRoot(
      referenceOutRefs.map((reference) => ({
        txHash: reference.tx_hash,
        outputIndex: reference.output_index,
        scriptHash: reference.script_hash,
      })),
    ),
    reference_validator: {
      script: referenceValidatorScript.script,
      script_hash: validatorToScriptHash(referenceValidatorScript),
      address: validatorToAddress('Preprod', referenceValidatorScript),
    },
    validators: {
      host_state_stt: validator,
      spend_client: validator,
      spend_connection: validator,
      spend_channel: {
        ...validator,
        ref_validator: {
          acknowledge_packet: channelRefValidator,
          chan_close_confirm: channelRefValidator,
          chan_close_init: channelRefValidator,
          chan_open_ack: channelRefValidator,
          chan_open_confirm: channelRefValidator,
          recv_packet: channelRefValidator,
          prune_packet_history: channelRefValidator,
          send_packet: channelRefValidator,
          timeout_packet: channelRefValidator,
        },
      },
      spend_mock_module: validator,
      spend_trace_registry: validator,
      spend_transfer_module: validator,
      mint_identifier: mintingValidator,
      verify_proof: mintingValidator,
      mint_client_stt: mintingValidator,
      mint_connection_stt: mintingValidator,
      mint_channel_stt: mintingValidator,
      mint_lifecycle_creation_marker: mintingValidator,
      mint_lifecycle_reclamation_marker: mintingValidator,
      mint_lifecycle_operational_marker: mintingValidator,
      mint_lifecycle_packet_marker: mintingValidator,
      mint_voucher: mintingValidator,
      mint_transfer_escrow_shard: mintingValidator,
      mint_port: mintingValidator,
      mint_trace_registry_benchmark_voucher: mintingValidator,
      voucher_metadata: { address: 'addr_test1_voucher_metadata' },
    },
    modules: {
      transfer: {
        identifier: '66'.repeat(28) + 'aa',
        address: validatorAddress,
      },
      mock: { identifier: '77'.repeat(28) + 'aa', address: validatorAddress },
      icq: { identifier: '88'.repeat(28) + 'aa', address: validatorAddress },
    },
    trace_registry: {
      address: validatorAddress,
      shard_policy_id: '99'.repeat(28),
      directory: {
        policy_id: '99'.repeat(28),
        token_name: 'aa',
      },
    },
  };
}

describe('bridge manifest compatibility', () => {
  it('matches the on-chain reference-script inventory hash vector', () => {
    assert.equal(
      computeReferenceScriptInventoryRoot([
        { txHash: '11'.repeat(32), outputIndex: 0, scriptHash: 'aa'.repeat(28) },
        { txHash: '22'.repeat(32), outputIndex: 7, scriptHash: 'bb'.repeat(28) },
      ]),
      '8ab929a509199835bfa494bc353cd86a2b86eac5599e1e24ac4f6aed3690094f',
    );
  });

  it('rejects immutable pre-v6 validator manifests', () => {
    assert.throws(
      () => normalizeBridgeManifest({ schema_version: 5 } as never),
      /schema_version: expected 6/,
    );
  });

  it('requires the parameterized HostState NFT policy for final burn', () => {
    assert.throws(
      () =>
        normalizeBridgeManifest({
          schema_version: 6,
          host_state_nft: {
            policy_id: 'host-policy',
            token_name: 'host-token',
          },
        } as never),
      /host_state_nft\.script is required/,
    );

    const wrongPolicy = bridgeManifestV6();
    wrongPolicy.host_state_nft.policy_id = 'ff'.repeat(28);
    assert.throws(
      () => normalizeBridgeManifest(wrongPolicy),
      /host_state_nft\.policy_id does not match its script/,
    );
  });

  it('requires every lifecycle policy in schema v6', () => {
    const policyNames = [
      'mint_lifecycle_creation_marker',
      'mint_lifecycle_reclamation_marker',
      'mint_lifecycle_operational_marker',
      'mint_lifecycle_packet_marker',
    ] as const;

    for (const policyName of policyNames) {
      const manifest = bridgeManifestV6();
      delete manifest.validators[policyName];

      assert.throws(
        () => normalizeBridgeManifest(manifest),
        new RegExp(`validators\\.${policyName} is required`),
        policyName,
      );
    }
  });

  it('normalizes uint64 reference indices decoded from the protobuf manifest', () => {
    const manifest = bridgeManifestV6();
    const replaceOutputIndices = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'output_index') {
          (value as Record<string, unknown>)[key] = BigInt(child as number);
        } else {
          replaceOutputIndices(child);
        }
      }
    };
    replaceOutputIndices(manifest);

    const normalized = normalizeBridgeManifest(manifest);

    assert.equal(normalized.deployment.validators.hostStateStt.refUtxo.outputIndex, 0);
    assert.equal(
      normalized.deployment.validators.spendChannel.refValidator.timeout_packet.refUtxo.outputIndex,
      0,
    );
    assert.deepEqual(normalized.deployment.referenceOutRefs, [
      { txHash: '22'.repeat(32), outputIndex: 0, scriptHash: '11'.repeat(28) },
      { txHash: '44'.repeat(32), outputIndex: 0, scriptHash: '33'.repeat(28) },
    ]);
    assert.equal(normalized.deployment.referenceScriptInventoryRoot, manifest.reference_script_inventory_root);
    assert.deepEqual(normalized.deployment.referenceValidator, {
      script: referenceValidatorScript.script,
      scriptHash: validatorToScriptHash(referenceValidatorScript),
      address: validatorToAddress('Preprod', referenceValidatorScript),
    });
    assert.equal(normalized.deployment.validators.voucherMetadata?.address, 'addr_test1_voucher_metadata');
    assert.equal(
      normalized.deployment.modules.icq?.address,
      credentialToAddress('Preprod', { type: 'Script', hash: '11'.repeat(28) }),
    );
  });

  it('requires a unique reference-output inventory', () => {
    const missing = bridgeManifestV6();
    delete missing.reference_out_refs;
    assert.throws(() => normalizeBridgeManifest(missing), /reference_out_refs must be a non-empty array/);

    const duplicate = bridgeManifestV6();
    duplicate.reference_out_refs.push(duplicate.reference_out_refs[0]);
    assert.throws(() => normalizeBridgeManifest(duplicate), /reference_out_refs contains duplicate output/);

    const omitted = bridgeManifestV6();
    omitted.reference_out_refs.shift();
    assert.throws(
      () => normalizeBridgeManifest(omitted),
      /reference inventory does not exactly match.*omitted=/,
    );

    const unbound = bridgeManifestV6();
    unbound.reference_out_refs.push({
      tx_hash: '99'.repeat(32),
      output_index: 1,
      script_hash: 'aa'.repeat(28),
    });
    assert.throws(
      () => normalizeBridgeManifest(unbound),
      /reference inventory does not exactly match.*unbound=/,
    );

    const mismatched = bridgeManifestV6();
    mismatched.reference_out_refs[0].script_hash = 'aa'.repeat(28);
    assert.throws(
      () => normalizeBridgeManifest(mismatched),
      /reference inventory does not exactly match.*script-mismatch=/,
    );

    const missingScriptHash = bridgeManifestV6();
    delete missingScriptHash.reference_out_refs[0].script_hash;
    assert.throws(
      () => normalizeBridgeManifest(missingScriptHash),
      /reference_out_refs\[\]\.script_hash is required/,
    );

    const missingRoot = bridgeManifestV6();
    delete missingRoot.reference_script_inventory_root;
    assert.throws(
      () => normalizeBridgeManifest(missingRoot),
      /reference_script_inventory_root must be 32-byte lowercase hex/,
    );

    const wrongRoot = bridgeManifestV6();
    wrongRoot.reference_script_inventory_root = 'aa'.repeat(32);
    assert.throws(
      () => normalizeBridgeManifest(wrongRoot),
      /reference_script_inventory_root does not match reference_out_refs/,
    );
  });

  it('requires the HostState reference first and a bounded canonical remainder', () => {
    const hostNotFirst = bridgeManifestV6();
    [hostNotFirst.reference_out_refs[0], hostNotFirst.reference_out_refs[1]] = [
      hostNotFirst.reference_out_refs[1],
      hostNotFirst.reference_out_refs[0],
    ];
    hostNotFirst.reference_script_inventory_root = computeReferenceScriptInventoryRoot(
      hostNotFirst.reference_out_refs.map((reference: any) => ({
        txHash: reference.tx_hash,
        outputIndex: reference.output_index,
        scriptHash: reference.script_hash,
      })),
    );
    assert.throws(
      () => normalizeBridgeManifest(hostNotFirst),
      /reference_out_refs\[0\] must be the HostState reference script/,
    );

    const nonHostOutOfOrder = bridgeManifestV6();
    const extraValidator = {
      script_hash: '22'.repeat(28),
      address: 'addr_test1_extra_validator',
      ref_utxo: { tx_hash: '33'.repeat(32), output_index: 0 },
    };
    nonHostOutOfOrder.validators.spend_client = extraValidator;
    nonHostOutOfOrder.reference_out_refs.splice(1, 0, {
      ...extraValidator.ref_utxo,
      script_hash: extraValidator.script_hash,
    });
    [nonHostOutOfOrder.reference_out_refs[1], nonHostOutOfOrder.reference_out_refs[2]] = [
      nonHostOutOfOrder.reference_out_refs[2],
      nonHostOutOfOrder.reference_out_refs[1],
    ];
    nonHostOutOfOrder.reference_script_inventory_root = computeReferenceScriptInventoryRoot(
      nonHostOutOfOrder.reference_out_refs.map((reference: any) => ({
        txHash: reference.tx_hash,
        outputIndex: reference.output_index,
        scriptHash: reference.script_hash,
      })),
    );
    assert.throws(
      () => normalizeBridgeManifest(nonHostOutOfOrder),
      /non-HostState reference_out_refs must be in canonical output-reference order/,
    );

    const oversized = bridgeManifestV6();
    oversized.reference_out_refs = Array.from({ length: 129 }, (_, index) => ({
      tx_hash: index.toString(16).padStart(64, '0'),
      output_index: 0,
      script_hash: index.toString(16).padStart(56, '0'),
    }));
    assert.throws(
      () => normalizeBridgeManifest(oversized),
      /reference_out_refs cannot contain more than 128 outputs/,
    );
  });

  it('requires a self-consistent persisted reference validator artifact', () => {
    const missing = bridgeManifestV6();
    delete missing.reference_validator;
    assert.throws(() => normalizeBridgeManifest(missing), /reference_validator is required/);

    const wrongHash = bridgeManifestV6();
    wrongHash.reference_validator.script_hash = 'ff'.repeat(28);
    assert.throws(
      () => normalizeBridgeManifest(wrongHash),
      /reference_validator\.script_hash does not match its script/,
    );

    const wrongAddress = bridgeManifestV6();
    wrongAddress.reference_validator.address = validatorToAddress('Preprod', {
      type: 'PlutusV3',
      script: '4e4d01000033222220051200120011',
    });
    assert.throws(
      () => normalizeBridgeManifest(wrongAddress),
      /reference_validator\.address does not match its script hash/,
    );
  });

  it('binds every non-empty validator address to its script hash while preserving empty mint-policy addresses', () => {
    const emptyHostAddress = bridgeManifestV6();
    emptyHostAddress.validators.host_state_stt = {
      ...emptyHostAddress.validators.host_state_stt,
      address: '',
    };
    assert.throws(
      () => normalizeBridgeManifest(emptyHostAddress),
      /validators\.host_state_stt\.address is required/,
    );

    const missingSpendAddress = bridgeManifestV6();
    missingSpendAddress.validators.spend_client = {
      ...missingSpendAddress.validators.spend_client,
    };
    delete missingSpendAddress.validators.spend_client.address;
    assert.throws(
      () => normalizeBridgeManifest(missingSpendAddress),
      /validators\.spend_client\.address is required/,
    );

    const malformed = bridgeManifestV6();
    malformed.validators.spend_client = {
      ...malformed.validators.spend_client,
      address: 'not-a-cardano-address',
    };
    assert.throws(
      () => normalizeBridgeManifest(malformed),
      /validators\.spend_client\.address must be a valid Cardano address/,
    );

    const mismatched = bridgeManifestV6();
    mismatched.validators.spend_client = {
      ...mismatched.validators.spend_client,
      address: credentialToAddress('Preprod', {
        type: 'Script',
        hash: '55'.repeat(28),
      }),
    };
    assert.throws(
      () => normalizeBridgeManifest(mismatched),
      /validators\.spend_client\.address does not match its script hash/,
    );

    const normalized = normalizeBridgeManifest(bridgeManifestV6());
    assert.equal(normalized.deployment.validators.mintVoucher.address, '');
  });

  it('binds module and trace-registry addresses to their declared spending validators', () => {
    const wrongAddress = credentialToAddress('Preprod', {
      type: 'Script',
      hash: '55'.repeat(28),
    });
    const cases: Array<{ expected: RegExp; mutate: (manifest: any) => void }> = [
      {
        mutate: (manifest) => {
          manifest.modules.transfer.address = wrongAddress;
        },
        expected: /modules\.transfer\.address.*validators\.spend_transfer_module\.address/,
      },
      {
        mutate: (manifest) => {
          manifest.modules.mock.address = wrongAddress;
        },
        expected: /modules\.mock\.address.*validators\.spend_mock_module\.address/,
      },
      {
        mutate: (manifest) => {
          manifest.modules.icq.address = wrongAddress;
        },
        expected: /modules\.icq\.address.*validators\.spend_mock_module\.address/,
      },
      {
        mutate: (manifest) => {
          manifest.trace_registry.address = wrongAddress;
        },
        expected: /trace_registry\.address.*validators\.spend_trace_registry\.address/,
      },
    ];

    for (const testCase of cases) {
      const manifest = bridgeManifestV6();
      testCase.mutate(manifest);
      assert.throws(() => normalizeBridgeManifest(manifest), testCase.expected);
    }

    const missingMockValidator = bridgeManifestV6();
    delete missingMockValidator.validators.spend_mock_module;
    assert.throws(
      () => normalizeBridgeManifest(missingMockValidator),
      /validators\.spend_mock_module is required when modules\.mock is present/,
    );
  });
});

function protocolParameters(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    minFeeCoefficient: 44,
    minFeeConstant: { ada: { lovelace: 155381 } },
    maxTransactionSize: { bytes: 16384 },
    maxValueSize: { bytes: 5000 },
    stakeCredentialDeposit: { ada: { lovelace: 2_000_000 } },
    stakePoolDeposit: { ada: { lovelace: 500_000_000 } },
    delegateRepresentativeDeposit: { ada: { lovelace: 500_000_000 } },
    governanceActionDeposit: { ada: { lovelace: 100_000_000_000 } },
    scriptExecutionPrices: {
      memory: '577/10000',
      cpu: [721, 10_000_000],
    },
    maxExecutionUnitsPerTransaction: {
      memory: 14_000_000,
      cpu: 10_000_000_000,
    },
    collateralPercentage: 150,
    maxCollateralInputs: 3,
    minFeeReferenceScripts: { base: 15 },
    ...overrides,
  };
}

describe('Ogmios protocol parameter compatibility', () => {
  it('maps the legacy UTxO-cost alias without inventing Plutus V3 parameters', () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        utxoCostPerByte: 4310,
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': { 1: '4', 0: '3' },
        },
      }),
    );

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(mapped.costModels, {
      PlutusV1: [1, 2],
      PlutusV2: [3, 4],
      PlutusV3: [],
    });
  });

  it('maps minUtxoDepositCoefficient and preserves a supplied Plutus V3 model', () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        minUtxoDepositCoefficient: '4310',
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': [5, 6],
          'plutus:v3': { 1: '8', 0: '7' },
        },
      }),
    );

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(mapped.costModels, {
      PlutusV1: [1, 2],
      PlutusV2: [5, 6],
      PlutusV3: [7, 8],
    });
  });

  it('produces a cost-model shape accepted by the locked Lucid runtime', async () => {
    const mapped = mapOgmiosProtocolParameters(
      protocolParameters({
        utxoCostPerByte: 4310,
        plutusCostModels: {
          'plutus:v1': [1, 2],
          'plutus:v2': [3, 4],
        },
      }),
    );

    assert.deepEqual(mapped.costModels.PlutusV3, []);
    await assert.doesNotReject(
      Lucid(undefined, 'Preprod', { presetProtocolParameters: mapped }),
    );
  });

  it('rejects malformed protocol parameters', () => {
    assert.throws(
      () => mapOgmiosProtocolParameters(protocolParameters()),
      /missing utxoCostPerByte\/minUtxoDepositCoefficient/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
          }),
        ),
      /missing a non-empty plutus:v1 cost model/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
            plutusCostModels: {
              'plutus:v1': [1, 2],
              'plutus:v2': [],
            },
          }),
        ),
      /missing a non-empty plutus:v2 cost model/,
    );
    assert.throws(
      () =>
        mapOgmiosProtocolParameters(
          protocolParameters({
            utxoCostPerByte: 4310,
            plutusCostModels: { 'plutus:v3': 'not-a-cost-model' },
          }),
        ),
      /invalid plutus:v3 cost model/,
    );
  });

  it('aborts and rejects stalled requests at the configured deadline', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof fetch;

    await assert.rejects(
      queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 10),
      /timed out after 10ms/,
    );
    assert.equal(observedSignal?.aborted, true);
  });

  it('also bounds a response body that never finishes', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => new Promise<string>(() => undefined),
    })) as unknown as typeof fetch;

    await assert.rejects(
      queryProtocolParametersCompat('https://ogmios.test', undefined, fetchImpl, 10),
      /timed out after 10ms/,
    );
  });

  it('retries 429 and temporary 5xx responses', async () => {
    const statuses = [429, 520];
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        const status = statuses[attempts];
        attempts += 1;
        if (status !== undefined) {
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        }
        return 'ready';
      },
      async () => undefined,
    );

    assert.equal(result, 'ready');
    assert.equal(attempts, 3);
  });

  it('does not retry an ordinary client error', async () => {
    let attempts = 0;

    await assert.rejects(
      retryWithBackoff(
        async () => {
          attempts += 1;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        async () => undefined,
      ),
      /bad request/,
    );
    assert.equal(attempts, 1);
  });

  it('honors Retry-After from a 429 response before retrying', async () => {
    const result = protocolParameters({
      utxoCostPerByte: 4310,
      plutusCostModels: {
        'plutus:v1': [1, 2],
        'plutus:v2': [3, 4],
      },
    });
    const responses = [
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
      new Response(JSON.stringify({ result }), { status: 200 }),
    ];
    const fetchImpl = (async () => responses.shift()!) as typeof fetch;
    const waits: number[] = [];

    const mapped = await retryWithBackoff(
      () =>
        queryProtocolParametersCompat(
          'https://ogmios.test',
          undefined,
          fetchImpl,
          50,
        ),
      async (durationMs) => {
        waits.push(durationMs);
      },
    );

    assert.equal(mapped.coinsPerUtxoByte, 4310n);
    assert.deepEqual(waits, [30_000]);
    assert.equal(responses.length, 0);
  });
});

async function closeNetServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.terminate();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function webSocketServerUrl(server: WebSocketServer): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test WebSocket server to have a TCP address');
  }
  return `ws://127.0.0.1:${address.port}`;
}

describe('Ogmios WebSocket request lifecycle', () => {
  it('returns the Ogmios result and closes the one-shot socket', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        socket.once('message', () => {
          socket.send(JSON.stringify({ result: { slot: 42, id: 'abc' } }));
        });
        socket.once('close', resolve);
      });
    });

    try {
      const result = await ogmiosRequest<{ slot: number; id: string }>(
        webSocketServerUrl(server),
        'queryNetwork/tip',
        {},
        undefined,
        1000,
      );
      assert.deepEqual(result, { slot: 42, id: 'abc' });
      await serverSocketClosed;
    } finally {
      await closeWebSocketServer(server);
    }
  });

  it('times out a WebSocket handshake that never completes', async () => {
    const sockets = new Set<Socket>();
    let acceptedConnection = false;
    const server = createServer((socket) => {
      acceptedConnection = true;
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
      await assert.rejects(
        ogmiosRequest(`ws://127.0.0.1:${address.port}`, 'queryNetwork/tip', {}, undefined, 100),
        /timed out after 100ms while opening the WebSocket/,
      );
      assert.equal(acceptedConnection, true, 'the test server should accept the handshake connection');
    } finally {
      await closeNetServer(server, sockets);
    }
  });

  it('times out after opening while waiting for an Ogmios response', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    let serverSocket: WebSocket | undefined;
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        serverSocket = socket;
        socket.once('close', resolve);
      });
    });

    try {
      await assert.rejects(
        ogmiosRequest(webSocketServerUrl(server), 'queryNetwork/tip', {}, undefined, 100),
        /timed out after 100ms while waiting for a response/,
      );
      await serverSocketClosed;
      assert.equal(serverSocket?.readyState, WebSocket.CLOSED);
    } finally {
      await closeWebSocketServer(server);
    }
  });

  it('rejects immediately when Ogmios closes before returning a response', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.once('connection', (socket) => socket.close(1000, 'test close'));

    try {
      await assert.rejects(
        ogmiosRequest(webSocketServerUrl(server), 'queryNetwork/tip', {}, undefined, 1000),
        /WebSocket closed before a response was received \(code 1000: test close\)/,
      );
    } finally {
      await closeWebSocketServer(server);
    }
  });
});

describe('Kupo quantity negotiation', () => {
  it('forces string quantities without discarding authentication', () => {
    const original = {
      kupoHeader: {
        Accept: 'application/json',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    };

    assert.deepEqual(withKupoStringQuantityHeader(original), {
      kupoHeader: {
        accept: 'application/json;asset-quantity=string',
        'dmtr-api-key': 'secret',
      },
      ogmiosHeader: { 'dmtr-api-key': 'ogmios-secret' },
    });
    assert.equal(original.kupoHeader.Accept, 'application/json');
  });
});
