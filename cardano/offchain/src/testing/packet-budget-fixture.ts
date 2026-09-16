import { Constr, Data, fromHex, fromText, toHex } from "@lucid-evolution/lucid";
import { DeploymentIbcTree } from "../deployment.ts";
import { HostStateDatum, HostStateRedeemer } from "../../types/index.ts";
import {
  channelActions,
  channelFixture,
  defaultChannelParameters,
  membershipProof,
} from "./channel-fixture.ts";

const record = (...fields: Data[]) => new Constr(0, fields);
const variant = (index: number, ...fields: Data[]) => new Constr(index, fields);
const encode = (value: Data) => Data.to(value);
const HEIGHT = record(1n, 10n);

// The source tree has a single key immediately after the absent packet key.
// Its membership proof also proves that there is no smaller key in that tree.
export async function absenceProof(key: string) {
  const membership = await membershipProof(key + "30", fromText("resolved"));
  const proofs = membership.proof.fields[0] as Constr<Data>[];
  const right = (proofs[0].fields[0] as Constr<Data>).fields[0];
  const empty = record("", "", record(0n, 0n, 0n, 0n, ""), []);
  return {
    root: membership.root,
    proof: record([
      record(variant(1, record(key, empty, right))),
      proofs[1],
    ]),
  };
}

export async function prunePacketFixture(ordered: boolean) {
  const fixture = await channelFixture(channelActions[2], {
    ...defaultChannelParameters,
    ordered,
  });
  const {
    lucid,
    emulator,
    seed,
    reference,
    channelScripts,
    channelToken,
    packetContext: context,
  } = fixture;
  const sequence = ordered ? 64n : 32n;
  const acknowledgement = "ab".repeat(32);
  const inputDatum = context.channelDatum(3);
  const state = inputDatum.fields[0] as Constr<Data>;
  state.fields[2] = sequence + 1n;
  const receipts = new Map<Data, Data>();
  const acknowledgements = new Map<Data, Data>();
  const tree = new DeploymentIbcTree();
  tree.set(
    "channelEnds/ports/mock/channels/channel-0",
    encode(state.fields[0]),
  );
  for (let n = 1n; n <= sequence; n++) {
    if (!ordered) {
      receipts.set(n, "");
      tree.set(
        `receipts/ports/mock/channels/channel-0/sequences/${n}`,
        encode(""),
      );
    }
    acknowledgements.set(n, acknowledgement);
    tree.set(
      `acks/ports/mock/channels/channel-0/sequences/${n}`,
      encode(acknowledgement),
    );
  }
  state.fields[5] = receipts;
  state.fields[6] = acknowledgements;
  const oldRoot = await tree.getRoot();
  const receiptKey =
    `receipts/ports/mock/channels/channel-0/sequences/${sequence}`;
  const ackKey = `acks/ports/mock/channels/channel-0/sequences/${sequence}`;
  const receiptSiblings = ordered ? [] : await tree.getSiblings(receiptKey);
  if (!ordered) tree.set(receiptKey, "");
  const ackSiblings = await tree.getSiblings(ackKey);
  tree.set(ackKey, "");
  const outputDatum = Data.from(encode(inputDatum)) as Constr<Data>;
  const outputState = outputDatum.fields[0] as Constr<Data>;
  (outputState.fields[5] as Map<Data, Data>).delete(sequence);
  (outputState.fields[6] as Map<Data, Data>).delete(sequence);
  outputState.fields[7] = HEIGHT;

  const remoteKey = fromText(
    `commitments/ports/remote/channels/channel-7/sequences/${sequence}`,
  );
  const proof = await absenceProof(remoteKey);
  context.consensus.fields[2] = record(proof.root);
  context.client.datum = encode(context.clientDatum);
  const hostDatum: HostStateDatum = {
    ...context.hostDatum,
    state: { ...context.hostDatum.state, ibc_state_root: oldRoot },
  };
  context.host.datum = Data.to(hostDatum, HostStateDatum);
  const newHostDatum: HostStateDatum = {
    ...hostDatum,
    state: {
      ...hostDatum.state,
      version: hostDatum.state.version + 1n,
      ibc_state_root: await tree.getRoot(),
    },
  };
  const hostRedeemer: HostStateRedeemer = {
    HandlePacket: {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: receiptSiblings,
      packet_acknowledgement_siblings: ackSiblings,
    },
  };
  const channel = seed(channelScripts.base.address, {
    lovelace: 20_000_000n,
    [String(channelToken.fields[0]) + String(channelToken.fields[1])]: 1n,
  }, encode(inputDatum));
  const operation = channelScripts.referredScripts.prune_packet_history;
  const tx = lucid.newTx()
    .readFrom([
      context.connection,
      context.client,
      reference(context.hostScript),
      reference(channelScripts.base.script),
      reference(operation.script),
      reference(context.verifyScript),
    ])
    .collectFrom([context.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([channel], encode(variant(8, sequence, proof.proof, HEIGHT)))
    .mintAssets({ [operation.hash]: 1n }, encode(channelToken))
    .mintAssets(
      { [context.verifyPolicy]: 1n },
      encode(
        record(
          variant(
            1,
            context.clientState,
            context.consensus,
            HEIGHT,
            0n,
            0n,
            0n,
            0n,
            proof.proof,
            record([fromText("ibc"), remoteKey]),
          ),
          variant(1),
        ),
      ),
    )
    .pay.ToContract(context.hostAddress, {
      kind: "inline",
      value: Data.to(newHostDatum, HostStateDatum),
    }, context.host.assets)
    .pay.ToContract(channelScripts.base.address, {
      kind: "inline",
      value: encode(outputDatum),
    }, channel.assets)
    .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
  return { ...fixture, tx };
}

// This measures the channel/HostState receive path with the repository's generic
// application. Transfer voucher minting is a separate, additional script path.
export async function receivePacketFixture(ordered: boolean) {
  const fixture = await channelFixture(channelActions[2], {
    ...defaultChannelParameters,
    ordered,
  });
  const {
    lucid,
    emulator,
    seed,
    reference,
    channelScripts,
    channelToken,
    packetContext: context,
  } = fixture;
  const sequence = ordered ? 64n : 1n;
  const inputDatum = context.channelDatum(3);
  const state = inputDatum.fields[0] as Constr<Data>;
  if (ordered) state.fields[2] = sequence;
  const receipts = state.fields[5] as Map<Data, Data>;
  const acknowledgements = state.fields[6] as Map<Data, Data>;
  const tree = new DeploymentIbcTree();
  tree.set(
    "channelEnds/ports/mock/channels/channel-0",
    encode(state.fields[0]),
  );
  tree.set(
    "nextSequenceRecv/ports/mock/channels/channel-0",
    encode(state.fields[2]),
  );
  for (let n = ordered ? 1n : 2n; n <= (ordered ? 63n : 32n); n++) {
    if (!ordered) {
      receipts.set(n, "");
      tree.set(
        `receipts/ports/mock/channels/channel-0/sequences/${n}`,
        encode(""),
      );
    }
    acknowledgements.set(n, "ab".repeat(32));
    tree.set(
      `acks/ports/mock/channels/channel-0/sequences/${n}`,
      encode("ab".repeat(32)),
    );
  }
  const oldRoot = await tree.getRoot();
  const sha256 = async (hex: string) =>
    toHex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
      ),
    );
  const payload = fromText("packet budget fixture");
  const timeout = BigInt(emulator.now() + 120_000) * 1_000_000n;
  const commitment = await sha256(
    timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
      await sha256(payload),
  );
  const packet = record(
    sequence,
    fromText("remote"),
    fromText("channel-7"),
    fromText("mock"),
    fromText("channel-0"),
    payload,
    record(0n, 0n),
    timeout,
  );
  const remoteKey = fromText(
    `commitments/ports/remote/channels/channel-7/sequences/${sequence}`,
  );
  const proof = await membershipProof(remoteKey, commitment);
  context.consensus.fields[2] = record(proof.root);
  context.client.datum = encode(context.clientDatum);
  const outputDatum = Data.from(encode(inputDatum)) as Constr<Data>;
  const outputState = outputDatum.fields[0] as Constr<Data>;
  const ack = await sha256(fromText('{"result":"AQ=="}'));
  let receiptSiblings: string[] = [];
  let recvSiblings: string[] = [];
  if (ordered) {
    const key = "nextSequenceRecv/ports/mock/channels/channel-0";
    recvSiblings = await tree.getSiblings(key);
    outputState.fields[2] = sequence + 1n;
    tree.set(key, encode(sequence + 1n));
  } else {
    const key = `receipts/ports/mock/channels/channel-0/sequences/${sequence}`;
    receiptSiblings = await tree.getSiblings(key);
    outputState.fields[5] = new Map([[sequence, ""], ...receipts]);
    tree.set(key, encode(""));
  }
  const ackKey = `acks/ports/mock/channels/channel-0/sequences/${sequence}`;
  const ackSiblings = await tree.getSiblings(ackKey);
  tree.set(ackKey, encode(ack));
  outputState.fields[6] = new Map([...acknowledgements, [sequence, ack]]);
  outputState.fields[8] = HEIGHT;
  const hostDatum: HostStateDatum = {
    ...context.hostDatum,
    state: { ...context.hostDatum.state, ibc_state_root: oldRoot },
  };
  context.host.datum = Data.to(hostDatum, HostStateDatum);
  const newHostDatum: HostStateDatum = {
    ...hostDatum,
    state: {
      ...hostDatum.state,
      version: hostDatum.state.version + 1n,
      ibc_state_root: await tree.getRoot(),
    },
  };
  const hostRedeemer: HostStateRedeemer = {
    HandlePacket: {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: recvSiblings,
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: receiptSiblings,
      packet_acknowledgement_siblings: ackSiblings,
    },
  };
  const channel = seed(channelScripts.base.address, {
    lovelace: 20_000_000n,
    [String(channelToken.fields[0]) + String(channelToken.fields[1])]: 1n,
  }, encode(inputDatum));
  const operation = channelScripts.referredScripts.recv_packet;
  const tx = lucid.newTx()
    .readFrom([
      context.connection,
      context.client,
      reference(context.hostScript),
      reference(context.moduleScript),
      reference(channelScripts.base.script),
      reference(operation.script),
      reference(context.verifyScript),
    ])
    .collectFrom([context.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([channel], encode(variant(2, packet, proof.proof, HEIGHT)))
    .collectFrom(
      [context.module],
      encode(
        variant(
          0,
          variant(
            6,
            fromText("channel-0"),
            payload,
            record(variant(0, fromText("AQ=="))),
            variant(1),
          ),
        ),
      ),
    )
    .mintAssets({ [operation.hash]: 1n }, encode(channelToken))
    .mintAssets(
      { [context.verifyPolicy]: 1n },
      encode(
        record(
          variant(
            0,
            context.clientState,
            context.consensus,
            HEIGHT,
            0n,
            0n,
            0n,
            0n,
            proof.proof,
            record([fromText("ibc"), remoteKey]),
            commitment,
          ),
          variant(1),
        ),
      ),
    )
    .pay.ToContract(context.hostAddress, {
      kind: "inline",
      value: Data.to(newHostDatum, HostStateDatum),
    }, context.host.assets)
    .pay.ToContract(channelScripts.base.address, {
      kind: "inline",
      value: encode(outputDatum),
    }, channel.assets)
    .pay.ToContract(context.moduleAddress, {
      kind: "inline",
      value: context.module.datum!,
    }, context.module.assets)
    .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
  return { ...fixture, tx };
}
