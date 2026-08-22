import {
  DEFAULT_HANDLER_JSON_PATH,
  bridgeManifestsEqual,
  loadBridgeConfigFromEnv,
  normalizeBridgeManifestConfig,
  normalizeHandlerJsonDeploymentConfig,
} from './bridge-manifest';

function buildValidator(name: string) {
  return {
    title: `${name}.title`,
    script: `${name}.script`,
    scriptHash: `${name}-hash`,
    address: `${name}-address`,
    refUtxo: {
      txHash: `${name}-tx`,
      outputIndex: 1,
    },
  };
}

function buildHandlerJsonDeployment() {
  return {
    schemaVersion: 6 as const,
    deployedAt: '2026-04-01T12:34:56.000Z',
    hostStateNFT: {
      policyId: 'host-policy',
      name: 'host-token',
      script: 'host-policy-script',
    },
    validators: {
      hostStateStt: buildValidator('hostStateStt'),
      spendClient: buildValidator('spendClient'),
      spendConnection: buildValidator('spendConnection'),
      spendChannel: {
        ...buildValidator('spendChannel'),
        refValidator: {
          acknowledge_packet: { scriptHash: 'ack-hash', refUtxo: { txHash: 'ack-tx', outputIndex: 2 } },
          chan_close_confirm: {
            scriptHash: 'close-confirm-hash',
            refUtxo: { txHash: 'close-confirm-tx', outputIndex: 3 },
          },
          chan_close_init: { scriptHash: 'close-init-hash', refUtxo: { txHash: 'close-init-tx', outputIndex: 4 } },
          chan_open_ack: { scriptHash: 'open-ack-hash', refUtxo: { txHash: 'open-ack-tx', outputIndex: 5 } },
          chan_open_confirm: {
            scriptHash: 'open-confirm-hash',
            refUtxo: { txHash: 'open-confirm-tx', outputIndex: 6 },
          },
          recv_packet: { scriptHash: 'recv-hash', refUtxo: { txHash: 'recv-tx', outputIndex: 7 } },
          prune_packet_history: { scriptHash: 'prune-hash', refUtxo: { txHash: 'prune-tx', outputIndex: 10 } },
          send_packet: { scriptHash: 'send-hash', refUtxo: { txHash: 'send-tx', outputIndex: 8 } },
          timeout_packet: { scriptHash: 'timeout-hash', refUtxo: { txHash: 'timeout-tx', outputIndex: 9 } },
        },
      },
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
      voucherMetadata: {
        address: 'voucher-metadata-address',
      },
    },
    modules: {
      transfer: {
        identifier: 'transfer-id',
        address: 'transfer-address',
      },
      mock: {
        identifier: 'mock-id',
        address: 'mock-address',
      },
    },
    traceRegistry: {
      address: 'trace-registry-address',
      shardPolicyId: 'trace-shard-policy',
      directory: {
        policyId: 'trace-shard-policy',
        name: 'trace-directory',
      },
    },
  };
}

describe('bridge manifest normalization', () => {
  it('normalizes handler.json into the public manifest and internal deployment config', () => {
    const loaded = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(loaded.bridgeManifest).toMatchObject({
      schema_version: 6,
      deployment_id: 'cardano-devnet:host-policy.host-token',
      deployed_at: '2026-04-01T12:34:56.000Z',
      cardano: {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      },
      host_state_nft: {
        policy_id: 'host-policy',
        token_name: 'host-token',
        script: 'host-policy-script',
      },
    });
    expect(loaded.deployment.validators.voucherMetadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.voucher_metadata).toEqual({
      address: 'voucher-metadata-address',
    });

    expect(loaded.deployment.validators.spendChannel.refValidator.chan_open_ack.scriptHash).toBe('open-ack-hash');
    expect(loaded.bridgeManifest.validators.spend_channel.ref_validator.chan_open_ack).toEqual({
      script_hash: 'open-ack-hash',
      ref_utxo: {
        tx_hash: 'open-ack-tx',
        output_index: 5,
      },
    });
    expect(loaded.bridgeManifest.validators.spend_channel.ref_validator.prune_packet_history).toEqual({
      script_hash: 'prune-hash',
      ref_utxo: { tx_hash: 'prune-tx', output_index: 10 },
    });
    expect(loaded.bridgeManifest.validators.mint_lifecycle_creation_marker.script_hash).toBe(
      'mintLifecycleCreationMarker-hash',
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_reclamation_marker.script_hash).toBe(
      'mintLifecycleReclamationMarker-hash',
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_operational_marker.script_hash).toBe(
      'mintLifecycleOperationalMarker-hash',
    );
    expect(loaded.bridgeManifest.validators.mint_lifecycle_packet_marker.script_hash).toBe(
      'mintLifecyclePacketMarker-hash',
    );
    expect(loaded.bridgeManifest.trace_registry).toEqual({
      address: 'trace-registry-address',
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
