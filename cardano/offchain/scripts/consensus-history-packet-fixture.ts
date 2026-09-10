import { assert, assertEquals } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
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
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";

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
  const dummy = "44".repeat(28);
  const apply = (title: string, params: string[] = []) =>
    readValidator(title, lucid, params);
  const [proofScript, proofPolicy] = apply("verifying_proof.verify_proof.mint");
  const [pruneScript, prunePolicy] = apply(
    "spending_channel/prune_packet_history.prune_packet_history.mint",
    [clientPolicy, connectionPolicy, proofPolicy],
  );
  const [channelScript, channelHash, channelAddress] = apply(
    "spending_channel.spend_channel.spend",
    [...Array(8).fill(dummy), prunePolicy, hostPolicy],
  );
  const tokenName = (prefix: string) =>
    generateTokenName(
      { policy_id: hostPolicy, name: hostName },
      fromText(prefix),
      0n,
    );
  const connectionName = await tokenName("connection");
  const channelName = await tokenName("channel");
  const channelToken = new Constr(0, [channelPolicy, channelName]);
  const channelEnd = new Constr(0, [
    new Constr(3, []),
    new Constr(1, []),
    new Constr(0, [fromText("transfer"), fromText("channel-0")]),
    [fromText("connection-0")],
    fromText("ics20-1"),
  ]);
  const initialChannel = new Constr(0, [
    new Constr(0, [
      channelEnd,
      1n,
      1n,
      1n,
      new Map(),
      new Map([[1n, ""]]),
      new Map([[1n, acknowledgement]]),
      h(1n),
      h(1n),
    ]),
    fromText("transfer"),
    channelToken,
  ]);
  const connection = new Constr(0, [
    new Constr(0, [
      fromText("07-tendermint-0"),
      [
        new Constr(0, [fromText("1"), [
          fromText("ORDER_ORDERED"),
          fromText("ORDER_UNORDERED"),
        ]]),
      ],
      new Constr(3, []),
      new Constr(0, [
        fromText("07-tendermint-1"),
        fromText("connection-0"),
        new Constr(0, [fromText("ibc")]),
      ]),
      0n,
    ]),
    new Constr(0, [connectionPolicy, connectionName]),
  ]);
  let channel: UTxO;
  let connectionUtxo: UTxO;
  let references: UTxO[];
  return {
    channelHash,
    root: leafHash(fromText("ibc"), subtreeRoot, "00"),
    seed(seed: Seed, address: string) {
      // Connection and channel setup is seeded. Client creation/update and the
      // final packet operation below execute the deployed production scripts.
      channel = seed(
        channelAddress,
        { [channelPolicy + channelName]: 1n },
        encode(initialChannel),
      );
      connectionUtxo = seed(address, {
        [connectionPolicy + connectionName]: 1n,
      }, encode(connection));
      references = [proofScript, pruneScript, channelScript].map((script) =>
        seed(address, {}, Data.void(), script)
      );
    },
    publicLeaves(tree: DeploymentIbcTree) {
      const datum = Data.from(channel.datum!) as Constr<Data>;
      const state = datum.fields[0] as Constr<Data>;
      const receipts = state.fields[5] as Map<bigint, string>;
      const acknowledgements = state.fields[6] as Map<bigint, string>;
      if (receipts.has(1n)) tree.set(receiptKey, encode(receipts.get(1n)!));
      if (acknowledgements.has(1n)) {
        tree.set(acknowledgementKey, encode(acknowledgements.get(1n)!));
      }
    },
    async assertPruned() {
      const live = await lucid.utxoByUnit(channelPolicy + channelName);
      assert(live.txHash !== channel.txHash);
      const datum = Data.from(live.datum!) as Constr<Data>;
      const state = datum.fields[0] as Constr<Data>;
      assertEquals((state.fields[5] as Map<bigint, string>).size, 0);
      assertEquals((state.fields[6] as Map<bigint, string>).size, 0);
      assertEquals(state.fields[7], h(2n));
      assertEquals(state.fields[8], h(1n));
    },
    async prune(
      client: UTxO,
      host: UTxO,
      hostReference: UTxO,
      tree: DeploymentIbcTree,
      witness: ConsensusHistoryWitness,
      now: number,
    ) {
      const hostDatum = Data.from(host.datum!, HostStateDatum);
      const clientDatum = Data.from(client.datum!) as Constr<Data>;
      const clientState = (clientDatum.fields[0] as Constr<Data>).fields[0];
      const record = recordToConstr(witness.record);
      const proofHeight = record.fields[1];
      const receiptSiblings = await tree.getSiblings(receiptKey);
      tree.set(receiptKey, "");
      const ackSiblings = await tree.getSiblings(acknowledgementKey);
      tree.set(acknowledgementKey, "");
      const nextChannel = new Constr(0, [
        new Constr(0, [
          channelEnd,
          1n,
          1n,
          1n,
          new Map(),
          new Map(),
          new Map(),
          proofHeight,
          h(1n),
        ]),
        fromText("transfer"),
        channelToken,
      ]);
      const nextHost: HostStateDatum = {
        ...hostDatum,
        state: {
          ...hostDatum.state,
          version: hostDatum.state.version + 1n,
          ibc_state_root: await tree.getRoot(),
        },
      };
      const proofRedeemer = new Constr(0, [
        new Constr(1, [
          clientState,
          record.fields[2],
          proofHeight,
          record.fields[3],
          record.fields[4],
          0n,
          0n,
          absenceProof,
          new Constr(0, [[fromText("ibc"), commitmentKey]]),
        ]),
        new Constr(0, [new Constr(0, [record, witness.siblings])]),
      ]);
      const completed = await lucid.newTx().readFrom([
        connectionUtxo,
        client,
        hostReference,
        ...references,
      ])
        .collectFrom(
          [channel],
          encode(new Constr(8, [1n, absenceProof, proofHeight])),
        )
        .collectFrom(
          [host],
          Data.to(
            {
              HandlePacket: {
                channel_siblings: [],
                next_sequence_send_siblings: [],
                next_sequence_recv_siblings: [],
                next_sequence_ack_siblings: [],
                packet_commitment_siblings: [],
                packet_receipt_siblings: receiptSiblings,
                packet_acknowledgement_siblings: ackSiblings,
              },
            },
            HostStateRedeemer,
            { canonical: true },
          ),
        )
        .mintAssets({ [prunePolicy]: 1n }, encode(channelToken))
        .mintAssets({ [proofPolicy]: 1n }, encode(proofRedeemer))
        .pay.ToContract(channelAddress, {
          kind: "inline",
          value: encode(nextChannel),
        }, channel.assets)
        .pay.ToContract(host.address, {
          kind: "inline",
          value: Data.to(nextHost, HostStateDatum, { canonical: true }),
        }, host.assets)
        .validFrom(now).validTo(now + 30_000).complete({ localUPLCEval: true });
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
      return {
        operation: "packet pruning with recovered old consensus state",
        bytes,
        memory: Number(units.mem()),
        steps: Number(units.steps()),
      };
    },
  };
}
