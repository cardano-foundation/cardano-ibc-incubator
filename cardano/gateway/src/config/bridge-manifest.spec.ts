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
    hostStateNFT: {
      policyId: 'host-policy',
      name: 'host-token',
    },
    handlerAuthToken: {
      policyId: 'handler-policy',
      name: 'handler-token',
    },
    validators: {
      hostStateStt: buildValidator('hostStateStt'),
      spendHandler: buildValidator('spendHandler'),
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
          send_packet: { scriptHash: 'send-hash', refUtxo: { txHash: 'send-tx', outputIndex: 8 } },
          timeout_packet: { scriptHash: 'timeout-hash', refUtxo: { txHash: 'timeout-tx', outputIndex: 9 } },
        },
      },
      spendTransferModule: buildValidator('spendTransferModule'),
      verifyProof: buildValidator('verifyProof'),
      mintClientStt: buildValidator('mintClientStt'),
      mintConnectionStt: buildValidator('mintConnectionStt'),
      mintChannelStt: buildValidator('mintChannelStt'),
      mintVoucher: buildValidator('mintVoucher'),
    },
    modules: {
      handler: {
        identifier: 'handler-id',
        address: 'handler-address',
      },
      transfer: {
        identifier: 'transfer-id',
        address: 'transfer-address',
      },
      mock: {
        identifier: 'mock-id',
        address: 'mock-address',
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
      schema_version: 1,
      deployment_id: 'cardano-devnet:host-policy.host-token',
      cardano: {
        chain_id: 'cardano-devnet',
        network_magic: 42,
        network: 'Custom',
      },
      host_state_nft: {
        policy_id: 'host-policy',
        token_name: 'host-token',
      },
      handler_auth_token: {
        policy_id: 'handler-policy',
        token_name: 'handler-token',
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
