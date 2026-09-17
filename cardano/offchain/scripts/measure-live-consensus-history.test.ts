import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertMeasurementFilePins,
  assertMeasurementLimits,
  assertMeasurementManifest,
  loopbackEndpoint,
  measurementConfig,
  measurementDriverMetadata,
  measurementHermesChains,
  performMeasurementUpdate,
  updateArguments,
} from "./measure-live-consensus-history.ts";

const config = () => ({
  hermesCommand: ["/local/hermes", "--config", "/local/operator.toml"],
  hostChainId: "cardano-devnet",
  clientId: "07-tendermint-0",
  counterpartyChainId: "v8-classic-1",
  deployment: {
    clientToken: { policyId: "11".repeat(28), name: "22" },
    stateAddress: "addr_test1client",
  },
  outputDirectory: "/local/results",
});

Deno.test("live measurement rejects missing, invalid or inflated protocol limits", () => {
  const limits = {
    maxTxSize: 16_384,
    maxTxExMem: 16_500_000n,
    maxTxExSteps: 10_000_000_000n,
  };
  assertMeasurementLimits(limits);
  assertMeasurementLimits({ ...limits, maxTxSize: 10_000 });
  for (
    const value of [undefined, null, "16384", NaN, Infinity, 0, -1, 1.5, 16_385]
  ) {
    assertThrows(() =>
      assertMeasurementLimits({ ...limits, maxTxSize: value })
    );
  }
  for (const field of ["maxTxExMem", "maxTxExSteps"] as const) {
    for (
      const value of [undefined, null, "1", 1, 0n, -1n, limits[field] + 1n]
    ) {
      assertThrows(() =>
        assertMeasurementLimits({ ...limits, [field]: value })
      );
    }
  }
});

Deno.test("live measurement defaults to Hermes and labels optional component callbacks explicitly", async () => {
  const request = {
    config: measurementConfig(config()),
    trustedHeight: 10n,
    targetHeight: 11n,
    revisionNumber: 1n,
    expectedClientOutRef: { txHash: "aa".repeat(32), outputIndex: 0 },
    directory: "/local/results",
    signal: new AbortController().signal,
  };
  let hermesCalls = 0;
  let componentCalls = 0;
  const hermes = () => {
    hermesCalls++;
    return Promise.resolve();
  };
  await performMeasurementUpdate(request, hermes);
  assertEquals(hermesCalls, 1);
  assertEquals(measurementDriverMetadata().updateDriverMode, "hermes");
  const driver = {
    label: "public local fixture Gateway component",
    update: (received: typeof request) => {
      assertEquals(received, request);
      componentCalls++;
      return Promise.resolve();
    },
  };
  await performMeasurementUpdate(request, hermes, driver);
  assertEquals(hermesCalls, 1);
  assertEquals(componentCalls, 1);
  assertEquals(
    measurementDriverMetadata(driver).updateDriverMode,
    "local-component",
  );
  assertEquals(
    measurementDriverMetadata(driver).latencyScope.includes("not Hermes"),
    true,
  );
  await assertRejects(() =>
    performMeasurementUpdate(request, hermes, { ...driver, label: " " })
  );
  await assertRejects(() =>
    performMeasurementUpdate(
      { ...request, signal: AbortSignal.abort() },
      hermes,
      driver,
    )
  );
  assertEquals(componentCalls, 1);
  assertEquals(hermesCalls, 1);
});

const localEndpoints = {
  kupo: "http://localhost:1442",
  ogmios: "http://localhost:1337",
  cosmos: "http://localhost:26757",
};

const hermesToml = `
[[chains]]
id = 'cardano-devnet'
type = 'Cardano'
network_id = 0
gateway_url = 'http://127.0.0.1:5001'
signing_utxo_kupo_url = 'http://127.0.0.1:1442'
signing_ogmios_url = 'http://127.0.0.1:1337'
bridge_manifest_path = '/local/pinned-manifest.json'
[chains.packet_filter]
policy = 'allow'
list = [['transfer', '*']]
[[chains]]
id = 'v8-classic-1'
type = 'CosmosSdk'
rpc_addr = 'http://127.0.0.1:26757'
grpc_addr = 'http://127.0.0.1:9100'
event_source = { mode = 'push', url = 'ws://127.0.0.1:26757/websocket' }
`;

const manifest = () => ({
  schema_version: 4,
  consensus_history_format: "proof-backed-v1",
  cardano: { chain_id: "cardano-devnet", network: "local", network_magic: 42 },
  host_state_nft: { policy_id: "aa".repeat(28), token_name: "bb" },
  validators: {
    mint_client_stt: { script_hash: "11".repeat(28) },
    spend_client: { address: "addr_test1client" },
  },
});

const boundConfig = () =>
  measurementConfig({
    ...config(),
    deployment: {
      ...config().deployment,
      clientToken: {
        policyId: "11".repeat(28),
        name: "5b725b3774483e2b6db092fbd7cafece4ae0d686f2c9db6430",
      },
    },
  });

Deno.test("live measurement parses exact Hermes TOML and binds local query/signing endpoints", () => {
  assertEquals(
    measurementHermesChains(boundConfig(), hermesToml, localEndpoints),
    {
      manifestPath: "/local/pinned-manifest.json",
    },
  );
  // Real TOML escaped strings must be decoded before checking endpoint safety.
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace(
        "'http://127.0.0.1:5001'",
        '"https://\\u0065xample.com"',
      ),
      localEndpoints,
    )
  );
  for (
    const endpoint of [
      "http://127.0.0.1:5001",
      "http://127.0.0.1:1442",
      "http://127.0.0.1:1337",
      "http://127.0.0.1:26757",
      "http://127.0.0.1:9100",
      "ws://127.0.0.1:26757/websocket",
    ]
  ) {
    assertThrows(() =>
      measurementHermesChains(
        boundConfig(),
        hermesToml.replace(endpoint, "https://example.com"),
        localEndpoints,
      )
    );
  }
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace("127.0.0.1:1442", "127.0.0.1:1443"),
      localEndpoints,
    )
  );
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace("network_id = 0", "network_id = 1"),
      localEndpoints,
    )
  );
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace("/local/pinned-manifest.json", "relative.json"),
      localEndpoints,
    )
  );
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml + "\n[[chains]]\nid='public-extra'\n",
      localEndpoints,
    )
  );
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace("id = 'v8-classic-1'", "id = 'cardano-devnet'"),
      localEndpoints,
    )
  );
  assertThrows(() =>
    measurementHermesChains(
      boundConfig(),
      hermesToml.replace(
        "type = 'Cardano'",
        "type = 'Cardano'\ntype = 'CosmosSdk'",
      ),
      localEndpoints,
    )
  );
});

Deno.test("live measurement binds client ID, exact NFT policy/name and state address to pinned manifest", () => {
  assertMeasurementManifest(boundConfig(), manifest());
  for (
    const change of [
      { clientId: "07-tendermint-1" },
      { clientId: "07-tendermint-00" },
      { clientId: "07-tendermint-100000000" },
      { hostChainId: "different-cardano" },
      {
        deployment: {
          ...boundConfig().deployment,
          stateAddress: "other-address",
        },
      },
      {
        deployment: {
          ...boundConfig().deployment,
          clientToken: {
            ...boundConfig().deployment.clientToken,
            policyId: "22".repeat(28),
          },
        },
      },
      {
        deployment: {
          ...boundConfig().deployment,
          clientToken: { ...boundConfig().deployment.clientToken, name: "ff" },
        },
      },
    ]
  ) {
    assertThrows(() =>
      assertMeasurementManifest({ ...boundConfig(), ...change }, manifest())
    );
  }
  for (
    const changed of [
      { ...manifest(), consensus_history_format: undefined },
      { ...manifest(), schema_version: 3 },
      { ...manifest(), cardano: { ...manifest().cardano, network_magic: 1 } },
      {
        ...manifest(),
        host_state_nft: {
          ...manifest().host_state_nft,
          policy_id: "cc".repeat(28),
        },
      },
      {
        ...manifest(),
        host_state_nft: { ...manifest().host_state_nft, token_name: "00" },
      },
    ]
  ) assertThrows(() => assertMeasurementManifest(boundConfig(), changed));
});

Deno.test("live measurement rejects config or manifest changes before authorizing another command", () => {
  const pinned = {
    configText: hermesToml,
    manifestText: JSON.stringify(manifest()),
  };
  assertMeasurementFilePins(pinned, { ...pinned });
  for (
    const current of [
      { ...pinned, configText: hermesToml + "\n# changed" },
      { ...pinned, manifestText: "{}" },
    ]
  ) {
    let issued = false;
    assertThrows(() => {
      assertMeasurementFilePins(pinned, current);
      issued = true;
    });
    assertEquals(issued, false);
  }
});

Deno.test("live measurement defaults and defensive configuration copies", () => {
  const input = config();
  const parsed = measurementConfig(input);
  input.hermesCommand.push("unexpected");
  input.deployment.clientToken.name = "ff";
  assertEquals(parsed.samples, [100, 300, 1000]);
  assertEquals(parsed.heightStep, 1);
  assertEquals(parsed.commandTimeoutMs, 180_000);
  assertEquals(parsed.deployment.clientToken.name, "22");
  assertEquals(parsed.hermesCommand.length, 3);
});

Deno.test("live measurement rejects mixed, unsafe and prototype configurations", () => {
  for (const heightStep of [0, -1, 1.5, NaN, Infinity, "2", 1_000_001]) {
    assertThrows(() => measurementConfig({ ...config(), heightStep }));
  }
  for (
    const samples of [[], [100, 100], [300, 100], [1], [2.5], [NaN], [
      Number.MAX_SAFE_INTEGER,
    ]]
  ) {
    assertThrows(() => measurementConfig({ ...config(), samples }));
  }
  assertThrows(() =>
    measurementConfig({ ...config(), hermesCommand: "hermes update client" })
  );
  for (
    const hermesCommand of [
      ["/local/hermes"],
      ["/local/hermes", "--config", "relative.toml"],
      [
        "/local/hermes",
        "--config",
        "/local/config.toml",
        "--config",
        "/other/config.toml",
      ],
    ]
  ) assertThrows(() => measurementConfig({ ...config(), hermesCommand }));
  assertThrows(() =>
    measurementConfig({
      ...config(),
      deployment: { ...config().deployment, layout: "prototype" },
    })
  );
  assertThrows(() => measurementConfig({ ...config(), deployment: {} }));
  assertThrows(() => measurementConfig({ ...config(), commandTimeoutMs: 0 }));
});

Deno.test("live measurement permits only explicit loopback endpoints", () => {
  assertEquals(
    loopbackEndpoint("http://localhost:1337/", "Ogmios", ["http:"]),
    "http://localhost:1337",
  );
  assertEquals(
    loopbackEndpoint("http://[::1]:1442", "Kupo", ["http:"]),
    "http://[::1]:1442",
  );
  for (
    const value of [
      undefined,
      "https://example.com",
      "http://localhost.example.com",
      "http://10.0.0.1",
      "file:///tmp/db",
      "not a URL",
    ]
  ) {
    assertThrows(() =>
      loopbackEndpoint(value, "endpoint", ["http:", "https:"])
    );
  }
  assertThrows(() =>
    loopbackEndpoint("http://localhost:5432", "database", ["postgres:"])
  );
});

Deno.test("live update argv preserves exact adjacent bigint heights without a shell", () => {
  const trusted = 9_007_199_254_740_993n;
  assertEquals(updateArguments(measurementConfig(config()), trusted), [
    "--config",
    "/local/operator.toml",
    "update",
    "client",
    "--host-chain",
    "cardano-devnet",
    "--client",
    "07-tendermint-0",
    "--height",
    "9007199254740994",
    "--trusted-height",
    "9007199254740993",
  ]);
});

Deno.test("live update argv explicitly selects skipped bigint heights", () => {
  const trusted = 9_007_199_254_740_993n;
  const parsed = measurementConfig({ ...config(), heightStep: 2 });
  const args = updateArguments(parsed, trusted);
  assertEquals(parsed.heightStep, 2);
  assertEquals(args[args.indexOf("--height") + 1], "9007199254740995");
  assertEquals(args[args.indexOf("--trusted-height") + 1], trusted.toString());
});
