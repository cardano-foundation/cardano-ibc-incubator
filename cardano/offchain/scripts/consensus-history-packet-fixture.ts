import { assert, assertEquals } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  type LucidEvolution,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { DeploymentIbcTree } from "../src/deployment.ts";
import { generateTokenName, readValidator } from "../src/utils.ts";
import {
  type ConsensusHistoryWitness,
  recordToConstr,
} from "../src/consensus_history_commitment.ts";
import {
  buildPacketPrune,
  type PacketLaneDeployment,
  record,
} from "../src/packet-lane-transactions.ts";
import { packetLaneTokenName } from "@cardano-ibc/tx-builder/dist/packet-lanes";

type Seed = (
  address: string,
  assets: Record<string, bigint>,
  datum?: string,
  script?: Script,
) => UTxO;
const encode = (value: Data) => Data.to<Data>(value);
const h = (n: bigint) => new Constr(0, [1n, n]);
const sha = (bytes: string) =>
  createHash("sha256").update(Buffer.from(bytes, "hex")).digest("hex");
const leafHash = (key: string, value: string, prefix: string) =>
  sha(
    prefix + (key.length / 2).toString(16).padStart(2, "0") + key + "20" +
      sha(value),
  );
const receiptKey = "receipts/ports/transfer/channels/channel-0/sequences/1";
const acknowledgementKey = "acks/ports/transfer/channels/channel-0/sequences/1";
const commitmentKey = fromText(
  "commitments/ports/transfer/channels/channel-0/sequences/1",
);
const acknowledgement = fromText("acknowledgement commitment");

// Same genuine two-level ICS-23 absence proof as the Aiken composed packet
// pruning test. It is synthetic data, not a mocked proof-verifier result.
const leaf = (prefix: string) => new Constr(0, [1n, 0n, 1n, 1n, prefix]);
const neighbor = new Constr(0, ["ff", "01", leaf("000202"), []]);
const empty = new Constr(0, ["", "", new Constr(0, [0n, 0n, 0n, 0n, ""]), []]);
const subtreeRoot = leafHash("ff", "01", "000202");
const absenceProof = new Constr(0, [[
  new Constr(0, [
    new Constr(1, [new Constr(0, [commitmentKey, empty, neighbor])]),
  ]),
  new Constr(0, [
    new Constr(0, [
      new Constr(0, [fromText("ibc"), subtreeRoot, leaf("00"), []]),
    ]),
  ]),
]]);

export async function historyPacketFixture(
  lucid: LucidEvolution,
  hostPolicy: string,
  hostName: string,
  clientPolicy: string,
) {
  const connectionPolicy = "66".repeat(28);
  const channelPolicy = "55".repeat(28);
  const channelHash = "44".repeat(28);
  const statePolicy = "77".repeat(28);
  const configPolicy = "88".repeat(28);
  const configName = fromText("ibc_packet_config");
  const configToken = record(configPolicy, configName);
  const [proofScript, proofPolicy] = readValidator(
    "verifying_proof.verify_proof.mint",
    lucid,
    [],
  );
  const [pruneScript, prunePolicy] = readValidator(
    "packet_prune.packet_prune.mint",
    lucid,
    [
      configToken,
      channelPolicy,
      statePolicy,
      clientPolicy,
      connectionPolicy,
      16n,
      channelHash,
      proofPolicy,
    ],
  );
  const [batchScript, batchPolicy, batchAddress] = readValidator(
    "packet_lane_batch.packet_lane_batch.mint",
    lucid,
    [
      channelPolicy,
      record(
        channelHash,
        channelHash,
        channelHash,
        channelHash,
        channelHash,
        prunePolicy,
        channelHash,
        channelHash,
        channelHash,
        channelHash,
      ),
    ],
  );
  const [guardScript, , guardAddress] = readValidator(
    "packet_lane_guard.packet_lane_guard.spend",
    lucid,
    [batchPolicy, statePolicy],
  );
  const tokenName = (prefix: string) =>
    generateTokenName(
      { policy_id: hostPolicy, name: hostName },
      fromText(prefix),
      0n,
    );
  const connectionName = await tokenName("connection");
  const channelName = await tokenName("channel");
  const channelToken = record(channelPolicy, channelName);
  const channelEnd = record(
    new Constr(3, []),
    new Constr(1, []),
    record(fromText("transfer"), fromText("channel-0")),
    [fromText("connection-0")],
    fromText("ics20-1"),
  );
  const initialChannel = record(
    record(
      channelEnd,
      1n,
      1n,
      1n,
      new Map(),
      new Map(),
      new Map(),
      h(0n),
      h(0n),
    ),
    fromText("transfer"),
    channelToken,
  );
  const connection = record(
    record(
      fromText("07-tendermint-0"),
      [record(fromText("1"), [
        fromText("ORDER_ORDERED"),
        fromText("ORDER_UNORDERED"),
      ])],
      new Constr(3, []),
      record(
        fromText("07-tendermint-1"),
        fromText("connection-0"),
        record(fromText("ibc")),
      ),
      0n,
    ),
    record(connectionPolicy, connectionName),
  );
  const laneName = packetLaneTokenName("transfer", "channel-0", 1, 16);
  const laneTree = new DeploymentIbcTree();
  laneTree.set(receiptKey, "01");
  laneTree.set(acknowledgementKey, acknowledgement);
  const initialLane = record(
    fromText("transfer"),
    fromText("channel-0"),
    1n,
    16n,
    0n,
    await laneTree.getRoot(),
    new Map(),
    [1n],
    new Map([[1n, acknowledgement]]),
    h(1n),
    h(1n),
    new Map(),
  );
  let channel: UTxO;
  let lane: UTxO;
  let connectionUtxo: UTxO;
  let configuration: UTxO;
  let references: UTxO[];
  return {
    channelHash,
    connectionPolicy,
    channelPolicy,
    root: leafHash(fromText("ibc"), subtreeRoot, "00"),
    seed(seed: Seed, address: string) {
      // Only connection, channel and retained lane history are assumed. Client
      // creation, update and pruning execute the production validators.
      channel = seed(
        address,
        { [channelPolicy + channelName]: 1n },
        encode(initialChannel),
      );
      lane = seed(
        guardAddress,
        { [statePolicy + laneName]: 1n },
        encode(initialLane),
      );
      connectionUtxo = seed(address, {
        [connectionPolicy + connectionName]: 1n,
      }, encode(connection));
      configuration = seed(
        address,
        { [configPolicy + configName]: 1n },
        encode(
          record(
            statePolicy,
            batchPolicy,
            getAddressDetails(guardAddress).paymentCredential!.hash,
            16n,
            channelHash,
            hostPolicy,
          ),
        ),
      );
      references = [proofScript, pruneScript, batchScript, guardScript].map((
        script,
      ) => seed(address, {}, Data.void(), script));
    },
    publicLeaves(_tree: DeploymentIbcTree) {
      // Packet commitments live in the lane root, outside the HostState tree.
    },
    async assertPruned() {
      const live = await lucid.utxoByUnit(statePolicy + laneName);
      assert(live.txHash !== lane.txHash);
      const state = Data.from(live.datum!) as Constr<Data>;
      assertEquals(state.fields[7], []);
      assertEquals((state.fields[8] as Map<bigint, string>).size, 0);
      assertEquals(state.fields[9], h(2n));
      assertEquals(state.fields[10], h(1n));
      assertEquals(
        (await lucid.utxoByUnit(channelPolicy + channelName)).txHash,
        channel.txHash,
      );
    },
    async prune(
      client: UTxO,
      host: UTxO,
      _hostReference: UTxO,
      _tree: DeploymentIbcTree,
      witness: ConsensusHistoryWitness,
      now: number,
    ) {
      const historical = recordToConstr(witness.record);
      const deployment: PacketLaneDeployment = {
        operations: {
          prune: { policy: prunePolicy, reference: references[1] },
        },
        proofVerifier: { policy: proofPolicy, reference: references[0] },
        batchPolicy,
        batchAddress,
        guardAddress,
        statePolicy,
        laneCount: 16,
        historyWitness: record(historical, witness.siblings),
        channel,
        connection: connectionUtxo,
        client,
        scripts: [configuration, references[2], references[3]],
      };
      const result = await buildPacketPrune(
        lucid,
        deployment,
        1n,
        historical.fields[1] as Constr<Data>,
        absenceProof,
        now,
        now + 30_000,
      );
      const completed = await result.tx.complete({ localUPLCEval: true });
      const signed = await completed.sign.withWallet().complete();
      const units = CML.compute_total_ex_units(
        signed.toTransaction().witness_set().redeemers()!,
      );
      const bytes = signed.toCBOR().length / 2;
      assert(bytes <= 16_384 - 750, `historical packet uses ${bytes} bytes`);
      assert(
        units.mem() <= 15_675_000n,
        `historical packet uses ${units.mem()} memory`,
      );
      assert(
        units.steps() <= 9_500_000_000n,
        `historical packet uses ${units.steps()} steps`,
      );
      assertEquals(await signed.submit(), signed.toHash());
      assertEquals(
        (await lucid.utxoByUnit(hostPolicy + hostName)).txHash,
        host.txHash,
      );
      return {
        operation: "lane pruning with recovered old consensus state",
        bytes,
        memory: Number(units.mem()),
        steps: Number(units.steps()),
      };
    },
  };
}
