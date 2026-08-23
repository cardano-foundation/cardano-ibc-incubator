import { ConfigService } from '@nestjs/config';
import { QueryBridgeManifestResponse as ProtoQueryBridgeManifestResponse } from '@cardano-ibc/proto-types/build/ibc/cardano/v1/query';
import { credentialToAddress, validatorToAddress, validatorToScriptHash } from '@lucid-evolution/lucid';
import {
  DEFAULT_HANDLER_JSON_PATH,
  bridgeManifestsEqual,
  computeReferenceScriptInventoryRoot,
  loadBridgeConfigFromEnv,
  normalizeBridgeManifestConfig,
  normalizeHandlerJsonDeploymentConfig,
} from './bridge-manifest';
import { BridgeManifestService } from '../query/services/bridge-manifest.service';

function testHex(label: string, byteLength: number): string {
  return Buffer.from(label)
    .toString('hex')
    .padEnd(byteLength * 2, '0')
    .slice(0, byteLength * 2);
}

function buildValidator(name: string) {
  const scriptHash = testHex(`${name}-hash`, 28);
  return {
    title: `${name}.title`,
    script: `${name}.script`,
    scriptHash,
    address:
      name === 'hostStateStt' || name.startsWith('spend')
        ? credentialToAddress('Custom', { type: 'Script', hash: scriptHash })
        : '',
    refUtxo: {
      txHash: testHex(`${name}-tx`, 32),
      outputIndex: 1,
    },
  };
}

function collectReferenceOutRefs(value: unknown): Array<{ txHash: string; outputIndex: number; scriptHash: string }> {
  const references = new Map<string, { txHash: string; outputIndex: number; scriptHash: string }>();
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    const refUtxo = record.refUtxo as { txHash?: unknown; outputIndex?: unknown } | undefined;
    if (
      typeof refUtxo?.txHash === 'string' &&
      typeof refUtxo.outputIndex === 'number' &&
      typeof record.scriptHash === 'string'
    ) {
      references.set(`${refUtxo.txHash}#${refUtxo.outputIndex}`, {
        txHash: refUtxo.txHash,
        outputIndex: refUtxo.outputIndex,
        scriptHash: record.scriptHash,
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...references.values()].sort((left, right) =>
    left.txHash === right.txHash ? left.outputIndex - right.outputIndex : left.txHash.localeCompare(right.txHash),
  );
}

const referenceValidatorScript = { type: 'PlutusV3' as const, script: '590100' };
const hostStateNftScript = {
  type: 'PlutusV3' as const,
  script: '4e4d01000033222220051200120011',
};
const hostStateNftPolicyId = validatorToScriptHash(hostStateNftScript);

function buildReferenceValidator() {
  return {
    script: referenceValidatorScript.script,
    scriptHash: validatorToScriptHash(referenceValidatorScript),
    address: validatorToAddress('Custom', referenceValidatorScript),
  };
}

function buildHandlerJsonDeployment() {
  const validators = {
    hostStateStt: buildValidator('hostStateStt'),
    spendClient: buildValidator('spendClient'),
    spendConnection: buildValidator('spendConnection'),
    spendChannel: {
      ...buildValidator('spendChannel'),
      refValidator: {
        acknowledge_packet: {
          scriptHash: testHex('ack-hash', 28),
          refUtxo: { txHash: testHex('ack-tx', 32), outputIndex: 2 },
        },
        chan_close_confirm: {
          scriptHash: testHex('close-confirm-hash', 28),
          refUtxo: { txHash: testHex('close-confirm-tx', 32), outputIndex: 3 },
        },
        chan_close_init: {
          scriptHash: testHex('close-init-hash', 28),
          refUtxo: { txHash: testHex('close-init-tx', 32), outputIndex: 4 },
        },
        chan_open_ack: {
          scriptHash: testHex('open-ack-hash', 28),
          refUtxo: { txHash: testHex('open-ack-tx', 32), outputIndex: 5 },
        },
        chan_open_confirm: {
          scriptHash: testHex('open-confirm-hash', 28),
          refUtxo: { txHash: testHex('open-confirm-tx', 32), outputIndex: 6 },
        },
        recv_packet: {
          scriptHash: testHex('recv-hash', 28),
          refUtxo: { txHash: testHex('recv-tx', 32), outputIndex: 7 },
        },
        prune_packet_history: {
          scriptHash: testHex('prune-hash', 28),
          refUtxo: { txHash: testHex('prune-tx', 32), outputIndex: 10 },
        },
        send_packet: {
          scriptHash: testHex('send-hash', 28),
          refUtxo: { txHash: testHex('send-tx', 32), outputIndex: 8 },
        },
        timeout_packet: {
          scriptHash: testHex('timeout-hash', 28),
          refUtxo: { txHash: testHex('timeout-tx', 32), outputIndex: 9 },
        },
      },
    },
    spendMockModule: buildValidator('spendMockModule'),
    spendTraceRegistry: buildValidator('spendTraceRegistry'),
    spendTransferModule: buildValidator('spendTransferModule'),
    mintIdentifier: buildValidator('mintIdentifier'),
    verifyProof: buildValidator('verifyProof'),
    mintClientStt: buildValidator('mintClientStt'),
    mintConnectionStt: buildValidator('mintConnectionStt'),
    mintChannelStt: buildValidator('mintChannelStt'),
    mintLifecycleCreationMarker: buildValidator('mintLifecycleCreationMarker'),
    mintLifecycleReclamationMarker: buildValidator('mintLifecycleReclamationMarker'),
    mintLifecycleOperationalMarker: buildValidator('mintLifecycleOperationalMarker'),
    mintLifecyclePacketMarker: buildValidator('mintLifecyclePacketMarker'),
    mintVoucher: buildValidator('mintVoucher'),
    mintTransferEscrowShard: buildValidator('mintTransferEscrowShard'),
    mintPort: buildValidator('mintPort'),
    mintTraceRegistryBenchmarkVoucher: buildValidator('mintTraceRegistryBenchmarkVoucher'),
    voucherMetadata: {
      address: 'voucher-metadata-address',
    },
  };
  const deployment = {
    schemaVersion: 6 as const,
    deployedAt: '2026-04-01T12:34:56.000Z',
    referenceValidator: buildReferenceValidator(),
    hostStateNFT: {
      policyId: hostStateNftPolicyId,
      name: 'host-token',
      script: hostStateNftScript.script,
    },
    validators,
    modules: {
      transfer: {
        identifier: 'transfer-id',
        address: validators.spendTransferModule.address,
      },
      mock: {
        identifier: 'mock-id',
        address: validators.spendMockModule.address,
      },
      icq: {
        identifier: 'icq-id',
        address: validators.spendMockModule.address,
      },
    },
    traceRegistry: {
      address: validators.spendTraceRegistry.address,
      shardPolicyId: 'trace-shard-policy',
      directory: {
        policyId: 'trace-shard-policy',
        name: 'trace-directory',
      },
    },
  };
  const canonicalReferences = collectReferenceOutRefs(deployment.validators);
  const hostReference = canonicalReferences.find(
    (reference) =>
      reference.txHash === deployment.validators.hostStateStt.refUtxo.txHash &&
      reference.outputIndex === deployment.validators.hostStateStt.refUtxo.outputIndex,
  )!;
  const referenceOutRefs = [hostReference, ...canonicalReferences.filter((reference) => reference !== hostReference)];
  return {
    ...deployment,
    referenceOutRefs,
    referenceScriptInventoryRoot: computeReferenceScriptInventoryRoot(referenceOutRefs),
  };
}

describe('bridge manifest normalization', () => {
  it('matches the on-chain reference-script inventory hash vector', () => {
    expect(
      computeReferenceScriptInventoryRoot([
        { txHash: '11'.repeat(32), outputIndex: 0, scriptHash: 'aa'.repeat(28) },
        { txHash: '22'.repeat(32), outputIndex: 7, scriptHash: 'bb'.repeat(28) },
      ]),
    ).toBe('8ab929a509199835bfa494bc353cd86a2b86eac5599e1e24ac4f6aed3690094f');
  });

  it('normalizes handler.json into the public manifest and internal deployment config', () => {
    const loaded = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(loaded.bridgeManifest).toMatchObject({
      schema_version: 6,
      deployment_id: `cardano-devnet:${hostStateNftPolicyId}.host-token`,
      deployed_at: '2026-04-01T12:34:56.000Z',
      cardano: {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      },
      host_state_nft: {
        policy_id: hostStateNftPolicyId,
        token_name: 'host-token',
        script: hostStateNftScript.script,
      },
      reference_script_inventory_root: loaded.deployment.referenceScriptInventoryRoot,
      reference_validator: {
        script: referenceValidatorScript.script,
        script_hash: validatorToScriptHash(referenceValidatorScript),
        address: validatorToAddress('Custom', referenceValidatorScript),
      },
    });
    expect(loaded.deployment.validators.voucherMetadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.voucher_metadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.reference_out_refs).toContainEqual({
      tx_hash: testHex('mintTraceRegistryBenchmarkVoucher-tx', 32),
      output_index: 1,
      script_hash: testHex('mintTraceRegistryBenchmarkVoucher-hash', 28),
    });
    expect(loaded.deployment.referenceOutRefs).toHaveLength(29);

    expect(loaded.deployment.validators.spendChannel.refValidator.chan_open_ack.scriptHash).toBe(
      testHex('open-ack-hash', 28),
    );
    expect(loaded.bridgeManifest.validators.spend_channel.ref_validator.chan_open_ack).toEqual({
      script_hash: testHex('open-ack-hash', 28),
      ref_utxo: {
        tx_hash: testHex('open-ack-tx', 32),
        output_index: 5,
      },
    });
    expect(loaded.bridgeManifest.validators.spend_channel.ref_validator.prune_packet_history).toEqual({
      script_hash: testHex('prune-hash', 28),
      ref_utxo: { tx_hash: testHex('prune-tx', 32), output_index: 10 },
    });
    expect(loaded.bridgeManifest.validators.mint_lifecycle_creation_marker.script_hash).toBe(
      testHex('mintLifecycleCreationMarker-hash', 28),
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_reclamation_marker.script_hash).toBe(
      testHex('mintLifecycleReclamationMarker-hash', 28),
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_operational_marker.script_hash).toBe(
      testHex('mintLifecycleOperationalMarker-hash', 28),
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_packet_marker.script_hash).toBe(
      testHex('mintLifecyclePacketMarker-hash', 28),
    );
    expect(loaded.bridgeManifest.trace_registry).toEqual({
      address: buildValidator('spendTraceRegistry').address,
      shard_policy_id: 'trace-shard-policy',
      directory: {
        policy_id: 'trace-shard-policy',
        token_name: 'trace-directory',
      },
    });
  });

  it('normalizes a public manifest back into the internal deployment config', () => {
    const legacy = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    const manifestLoaded = normalizeBridgeManifestConfig(legacy.bridgeManifest);

    expect(manifestLoaded.deployment).toEqual(legacy.deployment);
    expect(bridgeManifestsEqual(manifestLoaded.bridgeManifest, legacy.bridgeManifest)).toBe(true);
  });

  it('round-trips the complete schema-v6 manifest through protobuf without losing bootstrap fields', () => {
    const source = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const service = new BridgeManifestService({
      get: jest.fn().mockReturnValue(source.bridgeManifest),
    } as unknown as ConfigService);

    const grpcResponse = service.getGrpcBridgeManifestResponse();
    const decoded = ProtoQueryBridgeManifestResponse.decode(
      ProtoQueryBridgeManifestResponse.encode(grpcResponse).finish(),
    );
    const normalized = normalizeBridgeManifestConfig(decoded.manifest);

    expect(normalized.bridgeManifest).toEqual(source.bridgeManifest);
    expect(normalized.deployment).toEqual(source.deployment);
  });

  it('rejects handler.json files without a deployment timestamp', () => {
    const { deployedAt: _deployedAt, ...legacyHandlerJson } = buildHandlerJsonDeployment();

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(legacyHandlerJson, {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      }),
    ).toThrow('Invalid bridge config: "deployedAt" must be a non-empty string');
  });

  it('requires a unique, complete reference-output inventory field', () => {
    const deployment = buildHandlerJsonDeployment();
    const { referenceOutRefs: _referenceOutRefs, ...withoutInventory } = deployment;
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };

    expect(() => normalizeHandlerJsonDeploymentConfig(withoutInventory, cardano)).toThrow(
      'Invalid bridge config: "referenceOutRefs" must be a non-empty array',
    );

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        { ...deployment, referenceOutRefs: [...deployment.referenceOutRefs, deployment.referenceOutRefs[0]] },
        cardano,
      ),
    ).toThrow(/referenceOutRefs.*duplicate output/);

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        { ...deployment, referenceOutRefs: deployment.referenceOutRefs.slice(1) },
        cardano,
      ),
    ).toThrow(/reference inventory does not exactly match.*omitted=/);

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        {
          ...deployment,
          referenceOutRefs: [
            ...deployment.referenceOutRefs,
            {
              txHash: 'ff'.repeat(32),
              outputIndex: 99,
              scriptHash: 'ee'.repeat(28),
            },
          ],
        },
        cardano,
      ),
    ).toThrow(/reference inventory does not exactly match.*unbound=/);

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        {
          ...deployment,
          referenceOutRefs: deployment.referenceOutRefs.map((reference, index) =>
            index === 0 ? { ...reference, scriptHash: 'ee'.repeat(28) } : reference,
          ),
        },
        cardano,
      ),
    ).toThrow(/reference inventory does not exactly match.*script-mismatch=/);

    const missingScriptHash = structuredClone(deployment);
    delete missingScriptHash.referenceOutRefs[0].scriptHash;
    expect(() => normalizeHandlerJsonDeploymentConfig(missingScriptHash, cardano)).toThrow(
      /referenceOutRefs\[0\]\.scriptHash.*non-empty string/,
    );

    const { referenceScriptInventoryRoot: _root, ...withoutRoot } = deployment;
    expect(() => normalizeHandlerJsonDeploymentConfig(withoutRoot, cardano)).toThrow(
      'Invalid bridge config: "referenceScriptInventoryRoot" must be a non-empty string',
    );

    expect(() =>
      normalizeHandlerJsonDeploymentConfig({ ...deployment, referenceScriptInventoryRoot: 'ff'.repeat(32) }, cardano),
    ).toThrow(/referenceScriptInventoryRoot does not match referenceOutRefs/);
  });

  it('requires the HostState reference first and a bounded canonical remainder', () => {
    const deployment = buildHandlerJsonDeployment();
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };

    const hostNotFirst = structuredClone(deployment);
    [hostNotFirst.referenceOutRefs[0], hostNotFirst.referenceOutRefs[1]] = [
      hostNotFirst.referenceOutRefs[1],
      hostNotFirst.referenceOutRefs[0],
    ];
    hostNotFirst.referenceScriptInventoryRoot = computeReferenceScriptInventoryRoot(hostNotFirst.referenceOutRefs);
    expect(() => normalizeHandlerJsonDeploymentConfig(hostNotFirst, cardano)).toThrow(
      /referenceOutRefs\[0\].*HostState reference script/,
    );

    const nonHostOutOfOrder = structuredClone(deployment);
    [nonHostOutOfOrder.referenceOutRefs[1], nonHostOutOfOrder.referenceOutRefs[2]] = [
      nonHostOutOfOrder.referenceOutRefs[2],
      nonHostOutOfOrder.referenceOutRefs[1],
    ];
    nonHostOutOfOrder.referenceScriptInventoryRoot = computeReferenceScriptInventoryRoot(
      nonHostOutOfOrder.referenceOutRefs,
    );
    expect(() => normalizeHandlerJsonDeploymentConfig(nonHostOutOfOrder, cardano)).toThrow(
      /non-HostState.*canonical output-reference order/,
    );

    const oversized = structuredClone(deployment);
    oversized.referenceOutRefs = Array.from({ length: 129 }, (_, index) => ({
      txHash: index.toString(16).padStart(64, '0'),
      outputIndex: 0,
      scriptHash: index.toString(16).padStart(56, '0'),
    }));
    expect(() => normalizeHandlerJsonDeploymentConfig(oversized, cardano)).toThrow(
      /referenceOutRefs.*cannot contain more than 128 outputs/,
    );
  });

  it('requires a self-consistent persisted reference validator artifact', () => {
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };
    const missing = buildHandlerJsonDeployment() as any;
    delete missing.referenceValidator;
    expect(() => normalizeHandlerJsonDeploymentConfig(missing, cardano)).toThrow(
      /referenceValidator.*must be an object/,
    );

    const wrongHash = buildHandlerJsonDeployment();
    wrongHash.referenceValidator.scriptHash = 'ff'.repeat(28);
    expect(() => normalizeHandlerJsonDeploymentConfig(wrongHash, cardano)).toThrow(
      /referenceValidator\.scriptHash.*does not match its script/,
    );

    const wrongAddress = buildHandlerJsonDeployment();
    const otherValidator = { type: 'PlutusV3' as const, script: '4e4d01000033222220051200120011' };
    wrongAddress.referenceValidator.address = validatorToAddress('Custom', otherValidator);
    expect(() => normalizeHandlerJsonDeploymentConfig(wrongAddress, cardano)).toThrow(
      /referenceValidator\.address.*does not match its script hash/,
    );

    const loaded = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), cardano);
    const missingPublicArtifact = structuredClone(loaded.bridgeManifest) as any;
    delete missingPublicArtifact.reference_validator;
    expect(() => normalizeBridgeManifestConfig(missingPublicArtifact)).toThrow(
      /reference_validator.*must be an object/,
    );
  });

  it('binds every non-empty validator address to its script hash while preserving empty mint-policy addresses', () => {
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };
    const emptyHostAddress = buildHandlerJsonDeployment();
    emptyHostAddress.validators.hostStateStt.address = '';
    expect(() => normalizeHandlerJsonDeploymentConfig(emptyHostAddress, cardano)).toThrow(
      /validators\.hostStateStt\.address.*non-empty string/,
    );

    const malformed = buildHandlerJsonDeployment();
    malformed.validators.spendClient.address = 'not-a-cardano-address';
    expect(() => normalizeHandlerJsonDeploymentConfig(malformed, cardano)).toThrow(
      /validators\.spendClient\.address.*valid Cardano address/,
    );

    const handler = buildHandlerJsonDeployment();
    expect(handler.validators.mintVoucher.address).toBe('');
    const loaded = normalizeHandlerJsonDeploymentConfig(handler, cardano);
    const missingSpendAddress = structuredClone(loaded.bridgeManifest) as any;
    delete missingSpendAddress.validators.spend_client.address;
    expect(() => normalizeBridgeManifestConfig(missingSpendAddress)).toThrow(
      /validators\.spend_client\.address.*non-empty string/,
    );

    const mismatched = structuredClone(loaded.bridgeManifest);
    mismatched.validators.spend_client.address = mismatched.validators.spend_connection.address;
    expect(() => normalizeBridgeManifestConfig(mismatched)).toThrow(
      /validators\.spend_client\.address.*does not match its script hash/,
    );
  });

  it('binds module and trace-registry addresses to their declared spending validators', () => {
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };
    const cases: Array<{
      expected: RegExp;
      mutate: (deployment: ReturnType<typeof buildHandlerJsonDeployment>) => void;
    }> = [
      {
        mutate: (deployment) => {
          deployment.modules.transfer.address = deployment.validators.spendClient.address;
        },
        expected: /modules\.transfer\.address.*validators\.spendTransferModule\.address/,
      },
      {
        mutate: (deployment) => {
          deployment.modules.mock.address = deployment.validators.spendClient.address;
        },
        expected: /modules\.mock\.address.*validators\.spendMockModule\.address/,
      },
      {
        mutate: (deployment) => {
          deployment.modules.icq.address = deployment.validators.spendClient.address;
        },
        expected: /modules\.icq\.address.*validators\.spendMockModule\.address/,
      },
      {
        mutate: (deployment) => {
          deployment.traceRegistry.address = deployment.validators.spendClient.address;
        },
        expected: /traceRegistry\.address.*validators\.spendTraceRegistry\.address/,
      },
    ];

    for (const testCase of cases) {
      const deployment = buildHandlerJsonDeployment();
      testCase.mutate(deployment);
      expect(() => normalizeHandlerJsonDeploymentConfig(deployment, cardano)).toThrow(testCase.expected);
    }

    const source = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), cardano);
    const publicManifest = structuredClone(source.bridgeManifest);
    publicManifest.modules.transfer.address = publicManifest.validators.spend_client.address;
    expect(() => normalizeBridgeManifestConfig(publicManifest)).toThrow(
      /modules\.transfer\.address.*validators\.spendTransferModule\.address/,
    );
  });

  it('requires the final-burn HostState policy script to match its policy id', () => {
    const cardano = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };
    const handler = buildHandlerJsonDeployment();
    handler.hostStateNFT.script = referenceValidatorScript.script;
    expect(() => normalizeHandlerJsonDeploymentConfig(handler, cardano)).toThrow(
      /hostStateNFT\.policyId.*does not match its script/,
    );

    const source = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), cardano);
    const manifest = structuredClone(source.bridgeManifest);
    manifest.host_state_nft.script = referenceValidatorScript.script;
    expect(() => normalizeBridgeManifestConfig(manifest)).toThrow(
      /host_state_nft\.policy_id.*does not match its script/,
    );
  });

  it('rejects unversioned and pre-v6 handler.json deployments', () => {
    const { schemaVersion: _schemaVersion, ...unversioned } = buildHandlerJsonDeployment();
    const cardano = {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    };

    expect(() => normalizeHandlerJsonDeploymentConfig(unversioned, cardano)).toThrow(
      'Invalid bridge config: "schemaVersion" must be a non-negative integer',
    );
    expect(() =>
      normalizeHandlerJsonDeploymentConfig({ ...buildHandlerJsonDeployment(), schemaVersion: 5 }, cardano),
    ).toThrow('Invalid bridge config: "schemaVersion" must be 6');
  });

  it('rejects bridge manifests without deployed_at', () => {
    const legacy = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    const { deployed_at: _deployedAt, ...legacyManifest } = legacy.bridgeManifest;

    expect(() => normalizeBridgeManifestConfig(legacyManifest)).toThrow(
      'Invalid bridge config: "deployed_at" must be a non-empty string',
    );
  });

  it('rejects bridge manifests with an old schema version', () => {
    const legacy = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(() =>
      normalizeBridgeManifestConfig({
        ...legacy.bridgeManifest,
        schema_version: 3,
      }),
    ).toThrow('Invalid bridge config: "schema_version" must be 6');
  });

  it('rejects schema-v6 configs that omit either required lifecycle policy', () => {
    const deployment = buildHandlerJsonDeployment();
    const withoutCreation = structuredClone(deployment) as any;
    delete withoutCreation.validators.mintLifecycleCreationMarker;
    expect(() =>
      normalizeHandlerJsonDeploymentConfig(withoutCreation, {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      }),
    ).toThrow(/validators\.mintLifecycleCreationMarker/);

    const loaded = normalizeHandlerJsonDeploymentConfig(deployment, {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const withoutReclamation = structuredClone(loaded.bridgeManifest) as any;
    delete withoutReclamation.validators.mint_lifecycle_reclamation_marker;
    expect(() => normalizeBridgeManifestConfig(withoutReclamation)).toThrow(
      /validators\.mint_lifecycle_reclamation_marker/,
    );

    const withoutOperational = structuredClone(loaded.bridgeManifest) as any;
    delete withoutOperational.validators.mint_lifecycle_operational_marker;
    expect(() => normalizeBridgeManifestConfig(withoutOperational)).toThrow(
      /validators\.mint_lifecycle_operational_marker/,
    );

    const withoutPacket = structuredClone(loaded.bridgeManifest) as any;
    delete withoutPacket.validators.mint_lifecycle_packet_marker;
    expect(() => normalizeBridgeManifestConfig(withoutPacket)).toThrow(/validators\.mint_lifecycle_packet_marker/);
  });

  it('accepts legacy voucher_metadata validator payloads and normalizes them to address-only', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    const legacyManifest = {
      ...current.bridgeManifest,
      schema_version: 6,
      validators: {
        ...current.bridgeManifest.validators,
        voucher_metadata: {
          script_hash: 'legacy-voucher-metadata-hash',
          address: 'voucher-metadata-address',
          ref_utxo: {
            tx_hash: 'legacy-voucher-metadata-tx',
            output_index: 12,
          },
        },
      },
    };

    const loaded = normalizeBridgeManifestConfig(legacyManifest);

    expect(loaded.deployment.validators.voucherMetadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.voucher_metadata).toEqual({
      address: 'voucher-metadata-address',
    });
  });

  it('fails startup resolution if both manifest and handler paths are set', () => {
    const fs = {
      readFileSync: jest.fn(),
    };

    expect(() =>
      loadBridgeConfigFromEnv(
        {
          BRIDGE_MANIFEST_PATH: '/tmp/bridge-manifest.json',
          HANDLER_JSON_PATH: '/tmp/handler.json',
        },
        fs,
      ),
    ).toThrow('BRIDGE_MANIFEST_PATH and HANDLER_JSON_PATH are mutually exclusive');

    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('uses the manifest as the explicit alternative startup source', () => {
    const legacy = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const fs = {
      readFileSync: jest.fn().mockReturnValue(JSON.stringify(legacy.bridgeManifest)),
    };

    const loaded = loadBridgeConfigFromEnv(
      {
        BRIDGE_MANIFEST_PATH: '/tmp/bridge-manifest.json',
      },
      fs,
    );

    expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/bridge-manifest.json', 'utf8');
    expect(loaded.deployment).toEqual(legacy.deployment);
  });

  it('rejects a v6 manifest that omits the final-burn HostState policy script', () => {
    const loaded = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const manifest = structuredClone(loaded.bridgeManifest) as any;
    delete manifest.host_state_nft.script;

    expect(() => normalizeBridgeManifestConfig(manifest)).toThrow(/host_state_nft\.script/);
  });

  it('falls back to the default handler.json path when no explicit startup source is set', () => {
    const handlerJsonDeployment = buildHandlerJsonDeployment();
    const fs = {
      readFileSync: jest.fn().mockReturnValue(JSON.stringify(handlerJsonDeployment)),
    };

    const loaded = loadBridgeConfigFromEnv({}, fs);

    expect(fs.readFileSync).toHaveBeenCalledWith(DEFAULT_HANDLER_JSON_PATH, 'utf8');
    expect(loaded.deployment.hostStateNFT).toEqual(handlerJsonDeployment.hostStateNFT);
  });
});
