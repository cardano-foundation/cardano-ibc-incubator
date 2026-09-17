import {
  DEFAULT_HANDLER_JSON_PATH,
  CONSENSUS_HISTORY_FORMAT,
  ICS20_PACKET_CODEC,
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
    deploymentMode: 'legacy',
    deployedAt: '2026-04-01T12:34:56.000Z',
    consensusHistoryFormat: CONSENSUS_HISTORY_FORMAT,
    ics20PacketCodec: ICS20_PACKET_CODEC.STRICT,
    hostStateNFT: {
      policyId: 'host-policy',
      name: 'host-token',
    },
    validators: {
      hostStateStt: buildValidator('hostStateStt'),
      recoverClient: buildValidator('recoverClient'),
      spendClient: buildValidator('spendClient'),
      spendConnection: buildValidator('spendConnection'),
      spendChannel: {
        ...buildValidator('spendChannel'),
        refValidator: {
          acknowledge_packet: { scriptHash: 'ack-hash', refUtxo: { txHash: 'ack-tx', outputIndex: 2 } },
          chan_close_confirm: { scriptHash: 'close-confirm-hash', refUtxo: { txHash: 'close-confirm-tx', outputIndex: 3 } },
          chan_close_init: { scriptHash: 'close-init-hash', refUtxo: { txHash: 'close-init-tx', outputIndex: 4 } },
          chan_open_ack: { scriptHash: 'open-ack-hash', refUtxo: { txHash: 'open-ack-tx', outputIndex: 5 } },
          chan_open_confirm: { scriptHash: 'open-confirm-hash', refUtxo: { txHash: 'open-confirm-tx', outputIndex: 6 } },
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

function buildStagedHandlerJsonDeployment() {
  const deployment = buildHandlerJsonDeployment();
  return {
    ...deployment,
    validators: {
      ...deployment.validators,
      spendTendermintUpdateSession: buildValidator('spendTendermintUpdateSession'),
      mintTendermintUpdateSession: buildValidator('mintTendermintUpdateSession'),
    },
  };
}

describe('bridge manifest normalization', () => {
  it.each([undefined, null, '', 'archive-nft-v1', 'proof-backed-v2'])('rejects missing or unsupported history format %s before accepting old contracts', (format) => {
    const current = buildHandlerJsonDeployment();
    expect(() => normalizeHandlerJsonDeploymentConfig({ ...current, consensusHistoryFormat: format }, {
      chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom',
    })).toThrow('fresh proof-backed deployment is required');
    const normalized = normalizeHandlerJsonDeploymentConfig(current, {
      chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom',
    });
    expect(() => normalizeBridgeManifestConfig({ ...normalized.bridgeManifest, consensus_history_format: format }))
      .toThrow('fresh proof-backed deployment is required');
  });

  it('requires public manifests and handlers to declare the deployment history boundary', () => {
    const cardano = { chain_id: 'cardano-preview', network_magic: 2, network: 'Preview' };
    expect(() => normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), cardano)).toThrow('history is required');
    const local = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' }).bridgeManifest;
    expect(() => normalizeBridgeManifestConfig({ ...local, cardano })).toThrow('history is required');
    const history = { format: 'cardano-history-v1', start: { slot: 100, block_height: 5, block_hash: 'aa'.repeat(32) }, host_state_nft_mint: { tx_hash: 'bb'.repeat(32), output_index: 0 } };
    const loaded = normalizeHandlerJsonDeploymentConfig({ ...buildHandlerJsonDeployment(), history }, cardano);
    expect(loaded.bridgeManifest).toMatchObject({
      consensus_history_format: CONSENSUS_HISTORY_FORMAT,
      history,
    });
    expect(normalizeBridgeManifestConfig(loaded.bridgeManifest).deployment).toMatchObject({
      consensusHistoryFormat: CONSENSUS_HISTORY_FORMAT,
      history,
    });
  });

  it('normalizes handler.json into the public manifest and internal deployment config', () => {
    const loaded = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(loaded.bridgeManifest).toMatchObject({
      schema_version: 4,
      consensus_history_format: CONSENSUS_HISTORY_FORMAT,
      deployment_id: 'cardano-devnet:host-policy.host-token',
      deployed_at: '2026-04-01T12:34:56.000Z',
      ics20_packet_codec: ICS20_PACKET_CODEC.STRICT,
      cardano: {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      },
      host_state_nft: {
        policy_id: 'host-policy',
        token_name: 'host-token',
      },
    });
    expect(loaded.deployment.validators.voucherMetadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.bridgeManifest.validators.voucher_metadata).toEqual({
      address: 'voucher-metadata-address',
    });
    expect(loaded.deployment.validators.recoverClient).toEqual({
      scriptHash: 'recoverClient-hash',
      address: 'recoverClient-address',
      refUtxo: {
        txHash: 'recoverClient-tx',
        outputIndex: 1,
      },
    });
    expect(loaded.bridgeManifest.validators.recover_client).toEqual({
      script_hash: 'recoverClient-hash',
      address: 'recoverClient-address',
      ref_utxo: {
        tx_hash: 'recoverClient-tx',
        output_index: 1,
      },
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

  it('rejects obsolete archive-NFT deployment fields rather than silently dropping them', () => {
    const current = buildHandlerJsonDeployment();
    const identity = { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' };
    expect(() => normalizeHandlerJsonDeploymentConfig(
      { ...current, validators: { ...current.validators, spendConsensusState: buildValidator('archive') } },
      identity,
    )).toThrow(/fresh proof-backed deployment is required/);
    const normalized = normalizeHandlerJsonDeploymentConfig(
      current,
      { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' },
    );
    expect(() => normalizeBridgeManifestConfig({
      ...normalized.bridgeManifest,
      validators: { ...normalized.bridgeManifest.validators, spend_consensus_state: {} },
    })).toThrow(/fresh proof-backed deployment is required/);
  });

  it('round-trips staged Tendermint session validators', () => {
    const staged = normalizeHandlerJsonDeploymentConfig(buildStagedHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(staged.deployment.validators.spendTendermintUpdateSession).toEqual({
      scriptHash: 'spendTendermintUpdateSession-hash',
      address: 'spendTendermintUpdateSession-address',
      refUtxo: {
        txHash: 'spendTendermintUpdateSession-tx',
        outputIndex: 1,
      },
    });
    expect(staged.bridgeManifest.validators.mint_tendermint_update_session).toEqual({
      script_hash: 'mintTendermintUpdateSession-hash',
      address: 'mintTendermintUpdateSession-address',
      ref_utxo: {
        tx_hash: 'mintTendermintUpdateSession-tx',
        output_index: 1,
      },
    });

    const manifestLoaded = normalizeBridgeManifestConfig(staged.bridgeManifest);
    expect(manifestLoaded.deployment).toEqual(staged.deployment);
    expect(bridgeManifestsEqual(manifestLoaded.bridgeManifest, staged.bridgeManifest)).toBe(true);
  });

  it('accepts legacy deployments without Tendermint session validators', () => {
    const legacy = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(legacy.deployment.validators.spendTendermintUpdateSession).toBeUndefined();
    expect(legacy.deployment.validators.mintTendermintUpdateSession).toBeUndefined();
    expect(legacy.bridgeManifest.validators.spend_tendermint_update_session).toBeUndefined();
    expect(legacy.bridgeManifest.validators.mint_tendermint_update_session).toBeUndefined();
  });

  it('rejects handler files with only one Tendermint session validator', () => {
    const staged = buildStagedHandlerJsonDeployment();
    const { mintTendermintUpdateSession: _mintSession, ...withoutMintSession } = staged.validators;
    const { spendTendermintUpdateSession: _spendSession, ...withoutSpendSession } = staged.validators;

    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        { ...staged, validators: withoutMintSession },
        { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' },
      ),
    ).toThrow('staged Tendermint spend and mint session validators must be configured together');
    expect(() =>
      normalizeHandlerJsonDeploymentConfig(
        { ...staged, validators: withoutSpendSession },
        { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' },
      ),
    ).toThrow('staged Tendermint spend and mint session validators must be configured together');
  });

  it('rejects public manifests with only one Tendermint session validator', () => {
    const staged = normalizeHandlerJsonDeploymentConfig(buildStagedHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    }).bridgeManifest;
    const { mint_tendermint_update_session: _mintSession, ...withoutMintSession } = staged.validators;
    const { spend_tendermint_update_session: _spendSession, ...withoutSpendSession } = staged.validators;

    expect(() => normalizeBridgeManifestConfig({ ...staged, validators: withoutMintSession })).toThrow(
      'staged Tendermint spend and mint session validators must be configured together',
    );
    expect(() => normalizeBridgeManifestConfig({ ...staged, validators: withoutSpendSession })).toThrow(
      'staged Tendermint spend and mint session validators must be configured together',
    );
  });

  it('keeps handler files without a recovery validator loadable', () => {
    const current = buildHandlerJsonDeployment();
    const { recoverClient: _recoverClient, ...legacyValidators } = current.validators;

    const loaded = normalizeHandlerJsonDeploymentConfig(
      { ...current, validators: legacyValidators },
      {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      },
    );

    expect(loaded.deployment.validators.recoverClient).toBeUndefined();
    expect(loaded.bridgeManifest.validators.recover_client).toBeUndefined();
  });

  it('keeps manifests without a recovery validator loadable', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    }).bridgeManifest;
    const { recover_client: _recoverClient, ...legacyValidators } = current.validators;

    const loaded = normalizeBridgeManifestConfig({
      ...current,
      validators: legacyValidators,
    });

    expect(loaded.deployment.validators.recoverClient).toBeUndefined();
    expect(loaded.bridgeManifest.validators.recover_client).toBeUndefined();
  });

  it('defaults a proof-backed handler without a packet codec to legacy packet encoding', () => {
    const { ics20PacketCodec: _codec, ...legacyHandler } = buildHandlerJsonDeployment();

    const loaded = normalizeHandlerJsonDeploymentConfig(legacyHandler, {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(loaded.deployment.ics20PacketCodec).toBe(ICS20_PACKET_CODEC.LEGACY);
    expect(loaded.bridgeManifest.ics20_packet_codec).toBe(ICS20_PACKET_CODEC.LEGACY);
  });

  it('defaults a proof-backed schema-v4 manifest without a packet codec to legacy packet encoding', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });
    const { ics20_packet_codec: _codec, ...legacyManifest } = current.bridgeManifest;

    const loaded = normalizeBridgeManifestConfig(legacyManifest);

    expect(loaded.deployment.ics20PacketCodec).toBe(ICS20_PACKET_CODEC.LEGACY);
    expect(loaded.bridgeManifest.ics20_packet_codec).toBe(ICS20_PACKET_CODEC.LEGACY);
  });

  it('rejects unknown codec capabilities', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    expect(() =>
      normalizeBridgeManifestConfig({
        ...current.bridgeManifest,
        ics20_packet_codec: 'future-codec',
      })
    ).toThrow('Invalid bridge config: "ics20_packet_codec"');
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
    ).toThrow('Invalid bridge config: "schema_version" must be 4');
  });

  it('accepts legacy voucher_metadata validator payloads and normalizes them to address-only', () => {
    const current = normalizeHandlerJsonDeploymentConfig(buildHandlerJsonDeployment(), {
      chain_id: 'cardano-devnet',
      network_magic: 42,
      network: 'Custom',
    });

    const legacyManifest = {
      ...current.bridgeManifest,
      schema_version: 4,
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


describe('migration operational counterparty boundary', () => {
  const matrix = ['handler', 'manifest'].flatMap(source => [false, true].flatMap(migration =>
    ['mithril', 'stake-weighted-stability'].flatMap(mode => [false, true].map(readOnly => [source, migration, mode, readOnly] as const))));
  it.each(matrix)('%s migration=%s mode=%s historical-only=%s', (source, migration, mode, readOnly) => {
    const handler = { ...buildStagedHandlerJsonDeployment(), deploymentMode: migration ? 'upgradeable' : 'legacy', ...(migration ? { migration: {
      profile: 'cardano-ibc-compatible-v1', registryUnit: 'ab'.repeat(28) + '01', registryAddress: 'registry-address',
      generation: '1', compatibility: 'cd'.repeat(32), originalAddresses: ['host', 'client', 'connection', 'channel', 'transfer'],
    } } : {}) };
    const manifest = normalizeHandlerJsonDeploymentConfig(handler, { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' }).bridgeManifest;
    const fs = { readFileSync: jest.fn(() => JSON.stringify(source === 'handler' ? handler : manifest)) };
    const env = { [source === 'handler' ? 'HANDLER_JSON_PATH' : 'BRIDGE_MANIFEST_PATH']: 'fixture.json',
      CARDANO_LIGHT_CLIENT_MODE: mode, GATEWAY_HISTORICAL_READ_ONLY: String(readOnly) };
    if (migration && mode === 'mithril') expect(() => loadBridgeConfigFromEnv(env, fs)).toThrow('historical Mithril certification');
    else expect(loadBridgeConfigFromEnv(env, fs).deployment.migration?.profile).toBe(migration ? 'cardano-ibc-compatible-v1' : undefined);
  });
});


describe('deployment recovery capability selection', () => {
  it('rejects an upgradeable label with missing recovery configuration', () => {
    expect(() => normalizeHandlerJsonDeploymentConfig({...buildHandlerJsonDeployment(), deploymentMode: 'upgradeable'}, {chain_id:'devnet', network_magic:42, network:'Custom'})).toThrow('recovery configuration disagree');
  });
  it('requires explicit legacy selection for old unlabelled manifests at startup', () => {
    const handler = buildHandlerJsonDeployment();
    const {deploymentMode: _mode, ...old} = handler;
    const fs = {readFileSync: () => JSON.stringify(old)};
    expect(() => loadBridgeConfigFromEnv({}, fs)).toThrow('recovery configuration disagree');
    expect(loadBridgeConfigFromEnv({IBC_DEPLOYMENT_MODE:'legacy'}, fs).deployment.migration).toBeUndefined();
  });
});
