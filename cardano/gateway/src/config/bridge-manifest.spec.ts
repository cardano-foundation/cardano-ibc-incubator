import { QueryBridgeManifestResponse } from '@cardano-ibc/proto-types/build/ibc/cardano/v1/query';

import { BridgeManifestService } from '../query/services/bridge-manifest.service';
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
    deployedAt: '2026-04-01T12:34:56.000Z',
    hostStateNFT: {
      policyId: 'host-policy',
      name: 'host-token',
    },
    tendermintClient: {
      protocol: '07-tendermint-sp1',
      scriptHash: 'spendClient-hash',
    },
    validators: {
      hostStateStt: buildValidator('hostStateStt'),
      spendClient: buildValidator('spendClient'),
      tendermintProof: buildValidator('tendermintProof'),
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
      schema_version: 5,
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
      },
      tendermint_client: {
        protocol: '07-tendermint-sp1',
        script_hash: 'spendClient-hash',
      },
    });
    expect(loaded.deployment.validators.voucherMetadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.voucher_metadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.tendermint_proof).toEqual({
      script_hash: 'tendermintProof-hash',
      address: 'tendermintProof-address',
      ref_utxo: { tx_hash: 'tendermintProof-tx', output_index: 1 },
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

  it('preserves the complete SP1 manifest through protobuf encoding', () => {
    const base = buildHandlerJsonDeployment();
    const deployment = {
      ...base,
      validators: {
        ...base.validators,
        spendMockModule: buildValidator('spendMockModule'),
      },
      modules: {
        ...base.modules,
        icq: {
          identifier: 'icq-id',
          address: 'icq-address',
        },
      },
    };
    const current = normalizeHandlerJsonDeploymentConfig(deployment, {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const service = new BridgeManifestService({
      get: jest.fn().mockReturnValue(current.bridgeManifest),
    } as any);

    const encoded = QueryBridgeManifestResponse.encode(service.getGrpcBridgeManifestResponse()).finish();
    const decoded = QueryBridgeManifestResponse.decode(encoded);
    const decodedManifest = JSON.parse(
      JSON.stringify(decoded.manifest, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)),
    );
    const loaded = normalizeBridgeManifestConfig(decodedManifest);

    expect(decoded.manifest?.tendermint_client).toEqual({
      protocol: '07-tendermint-sp1',
      script_hash: 'spendClient-hash',
    });
    expect(decoded.manifest?.validators?.tendermint_proof?.script_hash).toBe('tendermintProof-hash');
    expect(decoded.manifest?.validators?.mint_identifier?.script_hash).toBe('mintIdentifier-hash');
    expect(decoded.manifest?.validators?.mint_transfer_escrow_shard?.script_hash).toBe('mintTransferEscrowShard-hash');
    expect(decoded.manifest?.validators?.mint_port?.script_hash).toBe('mintPort-hash');
    expect(decoded.manifest?.validators?.spend_mock_module?.script_hash).toBe('spendMockModule-hash');
    expect(decoded.manifest?.validators?.spend_trace_registry?.script_hash).toBe('spendTraceRegistry-hash');
    expect(decoded.manifest?.validators?.voucher_metadata?.address).toBe('voucher-metadata-address');
    expect(decoded.manifest?.modules?.icq?.identifier).toBe('icq-id');
    expect(decoded.manifest?.trace_registry?.directory?.token_name).toBe('trace-directory');
    expect(bridgeManifestsEqual(loaded.bridgeManifest, current.bridgeManifest)).toBe(true);
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

  it('loads an existing schema 4 manifest as direct and upgrades it to schema 5', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const { tendermint_client: _tendermintClient, ...manifestWithoutProtocol } = current.bridgeManifest;

    const loaded = normalizeBridgeManifestConfig({
      ...manifestWithoutProtocol,
      schema_version: 4,
    });

    expect(loaded.bridgeManifest.schema_version).toBe(5);
    expect(loaded.bridgeManifest.tendermint_client).toEqual({
      protocol: '07-tendermint-direct',
      script_hash: 'spendClient-hash',
    });
    expect(loaded.deployment.tendermintClient).toEqual({
      protocol: '07-tendermint-direct',
      scriptHash: 'spendClient-hash',
    });
    expect(loaded.deployment.validators.tendermintProof).toBeDefined();
  });

  it('rejects unsupported bridge manifest schema versions', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(() => normalizeBridgeManifestConfig({ ...current.bridgeManifest, schema_version: 3 })).toThrow(
      'Invalid bridge config: "schema_version" must be 4 or 5',
    );
  });

  it('requires explicit Tendermint protocol metadata in public manifests', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const { tendermint_client: _tendermintClient, ...manifestWithoutProtocol } = current.bridgeManifest;

    expect(() => normalizeBridgeManifestConfig(manifestWithoutProtocol)).toThrow(
      'Invalid bridge config: "tendermint_client" must be an object',
    );
  });

  it('binds Tendermint protocol metadata to the deployed spend-client script', () => {
    const deployment = buildHandlerJsonDeployment();
    deployment.tendermintClient.scriptHash = 'different-spend-client-hash';

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(deployment, {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      }),
    ).toThrow('"tendermintClient.scriptHash" must equal "validators.spendClient.scriptHash"');
  });

  it('rejects a public manifest whose Tendermint metadata names a different spend-client script', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(() =>
      normalizeBridgeManifestConfig({
        ...current.bridgeManifest,
        tendermint_client: {
          ...current.bridgeManifest.tendermint_client,
          script_hash: 'different-spend-client-hash',
        },
      }),
    ).toThrow('"tendermintClient.scriptHash" must equal "validators.spendClient.scriptHash"');
  });

  it('requires the proof validator for an SP1 Tendermint deployment', () => {
    const current = buildHandlerJsonDeployment();
    const { tendermintProof: _tendermintProof, ...validatorsWithoutProof } = current.validators;
    const deployment = { ...current, validators: validatorsWithoutProof };

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(deployment, {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      }),
    ).toThrow('"validators.tendermintProof" is required for protocol "07-tendermint-sp1"');
  });

  it('infers direct protocol for existing metadata-free handler.json files', () => {
    const current = buildHandlerJsonDeployment();
    const { tendermintClient: _tendermintClient, ...deployment } = current;

    const loaded = normalizeHandlerJsonDeploymentConfig(deployment, {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(loaded.deployment.tendermintClient).toEqual({
      protocol: '07-tendermint-direct',
      scriptHash: 'spendClient-hash',
    });
    expect(loaded.bridgeManifest.tendermint_client).toEqual({
      protocol: '07-tendermint-direct',
      script_hash: 'spendClient-hash',
    });
    expect(loaded.deployment.validators.tendermintProof).toBeDefined();
  });

  it('accepts legacy voucher_metadata validator payloads and normalizes them to address-only', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    const legacyManifest = {
      ...current.bridgeManifest,
      schema_version: 5,
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
