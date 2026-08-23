import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ICS23MerkleTree } from "./ics23MerkleTree";
import { committedModulePortIdHex, rebuildTreeFromChain } from "./ibcStateRoot";

function encode(value: unknown): string {
  return Buffer.from(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint"
        ? `${entry.toString()}n`
        : entry instanceof Map
          ? Array.from(entry.entries())
          : entry,
    ),
  ).toString("hex");
}

const FakeLucid = {
  Data: {
    Array: (_schema: unknown) => ({}),
    Boolean: () => ({}),
    Bytes: () => ({}),
    Enum: (_schemas: unknown[]) => ({}),
    Integer: () => ({}),
    Literal: (_name: string) => ({}),
    Map: (_key: unknown, _value: unknown) => ({}),
    Object: (_schema: unknown) => ({}),
    to: (value: unknown) => encode(value),
  },
} as unknown as typeof import("@lucid-evolution/lucid");

function authUnit(
  policyByte: string,
  prefixByte: string,
  sequence: string,
): string {
  return (
    policyByte.repeat(56) +
    prefixByte.repeat(48) +
    Buffer.from(sequence).toString("hex")
  );
}

function hostDatum(expectedRoot: string) {
  return {
    state: {
      ibc_state_root: expectedRoot,
      bound_port: new Map(),
    },
  };
}

function channelDatum() {
  return {
    port: Buffer.from("transfer").toString("hex"),
    lifecycle: "ChannelActive",
    voucher_supply: 0n,
    state: {
      channel: {
        state: "Close",
        ordering: "Ordered",
        counterparty: { port_id: "aa", channel_id: "bb" },
        connection_hops: ["cc"],
        version: "dd",
      },
      next_sequence_send: 9n,
      next_sequence_recv: 10n,
      next_sequence_ack: 11n,
      packet_commitment: new Map(),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
    },
  };
}

function services(args: {
  expectedRoot: string;
  clientUtxos?: any[];
  connectionUtxos?: any[];
  channelUtxos?: any[];
  channelHistory?: any[];
  datums?: Record<string, unknown>;
}) {
  return {
    kupo: {
      queryAllClientUtxos: async () => args.clientUtxos ?? [],
      queryAllConnectionUtxos: async () => args.connectionUtxos ?? [],
      queryAllChannelUtxos: async () => args.channelUtxos ?? [],
      queryLatestChannelUtxosFromHistory: async () => args.channelHistory ?? [],
    },
    lucid: {
      LucidImporter: FakeLucid,
      findUtxoAtHostStateNFT: async () => ({ datum: "host" }),
      decodeDatum: async (datum: string) =>
        datum === "host" ? hostDatum(args.expectedRoot) : args.datums?.[datum],
    },
  };
}

describe("runtime HostState tree reconstruction", () => {
  it("maps a retired module marker back to its committed port", () => {
    const transfer = Buffer.from("transfer").toString("hex");
    assert.equal(committedModulePortIdHex(transfer), transfer);
    assert.equal(committedModulePortIdHex(`00${transfer}`), transfer);
    assert.throws(() => committedModulePortIdHex("00"), /Invalid/);
    assert.throws(() => committedModulePortIdHex("00ff"), /Invalid/);
    assert.throws(
      () => committedModulePortIdHex(Buffer.from("bad!").toString("hex")),
      /Invalid/,
    );
  });

  it("restores a zero live-connection count leaf for every live client", async () => {
    const clientId = "07-tendermint-0";
    const clientState = { chainId: "aa", latestHeight: 1n };
    const expected = new ICS23MerkleTree();
    expected.set(
      `clients/${clientId}/clientState`,
      Buffer.from(encode(clientState), "hex"),
    );
    expected.set(
      `cardano/dependencies/v1/clients/${clientId}/liveConnections`,
      Buffer.from(encode(0n), "hex"),
    );
    const clientUtxo = {
      txHash: "a".repeat(64),
      outputIndex: 0,
      assets: { [authUnit("1", "2", "0")]: 1n },
      datum: "client-0",
    };
    const mock = services({
      expectedRoot: expected.getRoot(),
      clientUtxos: [clientUtxo],
      datums: {
        "client-0": {
          state: { clientState, consensusStates: new Map() },
        },
      },
    });

    const rebuilt = await rebuildTreeFromChain(mock.kupo, mock.lucid);
    assert.equal(rebuilt.root, expected.getRoot());
  });

  it("restores retained Closed-channel leaves after the channel NFT is burned", async () => {
    const datum = channelDatum();
    const expected = new ICS23MerkleTree();
    expected.set(
      "channelEnds/ports/transfer/channels/channel-7",
      Buffer.from(encode(datum.state.channel), "hex"),
    );
    expected.set(
      "nextSequenceRecv/ports/transfer/channels/channel-7",
      Buffer.from(encode(10n), "hex"),
    );
    const historical = {
      txHash: "b".repeat(64),
      outputIndex: 1,
      assets: { lovelace: 2_000_000n },
      datum: "closed-7",
      spentAt: {},
      authToken: { unit: authUnit("3", "4", "7") },
    };
    const mock = services({
      expectedRoot: expected.getRoot(),
      channelHistory: [historical],
      datums: { "closed-7": datum },
    });

    const rebuilt = await rebuildTreeFromChain(mock.kupo, mock.lucid);
    assert.equal(rebuilt.root, expected.getRoot());
  });

  it("fails closed when retained history omits or disagrees with a live channel", async () => {
    const datum = channelDatum();
    const live = {
      txHash: "c".repeat(64),
      outputIndex: 0,
      assets: { [authUnit("5", "6", "2")]: 1n },
      datum: "live-2",
    };
    const missing = services({
      expectedRoot: "00".repeat(32),
      channelUtxos: [live],
      datums: { "live-2": datum },
    });
    await assert.rejects(
      rebuildTreeFromChain(missing.kupo, missing.lucid),
      /history is incomplete for live channels/,
    );

    const misaligned = services({
      expectedRoot: "00".repeat(32),
      channelHistory: [
        {
          ...live,
          txHash: "d".repeat(64),
          spentAt: null,
          authToken: { unit: authUnit("5", "6", "2") },
        },
      ],
      datums: { "live-2": datum },
    });
    await assert.rejects(
      rebuildTreeFromChain(misaligned.kupo, misaligned.lucid),
      /history is not aligned/,
    );
  });
});
